//! Portable validation of the private native worker's shareable observations.
use super::{Operation, Request, WorkerResult, WorkerStatus};
use serde_json::{json, Value};

const LIMITATION: &str = "Interruption during final receipt/guard/root deletion can leave incomplete ownership/admission evidence or an empty root. Missing evidence requires operator intervention; workers never recreate a missing admission guard.";
const READ: u32 = 0x8000_0000;
const WRITE: u32 = 0x4000_0000;
const DELETE: u32 = 0x0001_0000;
const REPARSE: u32 = 0x0020_0000;
const BACKUP: u32 = 0x0200_0000;
const THROUGH: u32 = 0x8000_0000;
const INVALID: &str = "invalid worker result schema";
type Check = Result<(), &'static str>;

fn require(ok: bool) -> Check {
    if ok {
        Ok(())
    } else {
        Err(INVALID)
    }
}

fn keys(value: &Value, expected: &[&str]) -> Check {
    let object = value.as_object().ok_or(INVALID)?;
    require(object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key)))
}

// Bound traversal before cloning or serializing any untrusted subtree.
fn bounded(value: &Value, depth: usize, budget: &mut usize) -> Check {
    require(depth <= 8 && *budget > 0)?;
    *budget -= 1;
    match value {
        Value::String(text) => require(text.len() <= 2048),
        Value::Array(items) => {
            require(items.len() <= 32)?;
            for item in items {
                bounded(item, depth + 1, budget)?;
            }
            Ok(())
        }
        Value::Object(fields) => {
            require(fields.len() <= 16)?;
            for (key, item) in fields {
                require(key.len() <= 64)?;
                bounded(item, depth + 1, budget)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn code(value: &Value) -> bool {
    value.is_null() || value.as_u64().is_some_and(|n| n <= u32::MAX as u64)
}

pub(super) fn validate_result(request: &Request, result: &WorkerResult) -> Check {
    super::validate_request(request)?;
    bounded(&result.details, 0, &mut 1024)?;
    require(
        serde_json::to_vec(&result.details)
            .map_err(|_| INVALID)?
            .len()
            <= 32 * 1024,
    )?;
    let details = &result.details;
    keys(
        details,
        &[
            "result",
            "calls",
            "elapsed_ms",
            "qualified",
            "runtime_publication_enabled",
            "physical_power_loss_tested",
            "cleanup_crash_atomic",
            "cleanup_interruption_limitation",
        ],
    )?;
    for key in [
        "qualified",
        "runtime_publication_enabled",
        "physical_power_loss_tested",
        "cleanup_crash_atomic",
    ] {
        require(details[key] == false)?;
    }
    require(details["elapsed_ms"].as_u64().is_some())?;
    require(details["cleanup_interruption_limitation"] == LIMITATION)?;
    let calls = details["calls"].as_array().ok_or(INVALID)?;
    let completed = result.status == WorkerStatus::Completed;
    let observation = &details["result"];
    match request.operation {
        Operation::Preflight => {
            require(calls.is_empty())?;
            if completed {
                keys(observation, &["environment", "ownership_recorded"])?;
                require(observation["ownership_recorded"] == true)?;
                environment(&observation["environment"])?;
            }
        }
        Operation::Cleanup => {
            require(calls.is_empty())?;
            if completed {
                keys(
                    observation,
                    &["cleanup_complete", "operator_intervention_required"],
                )?;
                require(
                    observation["cleanup_complete"] == true
                        && observation["operator_intervention_required"] == false,
                )?;
            }
        }
        Operation::Case { index } => {
            sequence(index, calls, completed)?;
            if completed {
                require(*observation == case_result(index))?;
            }
        }
    }
    if !completed {
        failure(observation)?;
    }
    Ok(())
}

fn environment(value: &Value) -> Check {
    keys(
        value,
        &[
            "architecture",
            "non_elevated",
            "storage_privileges_disabled",
            "filesystem",
            "drive_type",
            "physical_locality_and_cache_honesty_verified",
            "windows_version_source",
            "windows_registry",
        ],
    )?;
    require(matches!(
        value["architecture"].as_str(),
        Some("x86" | "x86_64" | "aarch64" | "arm")
    ))?;
    require(
        value["non_elevated"] == true
            && value["storage_privileges_disabled"] == true
            && value["filesystem"] == "NTFS"
            && value["drive_type"] == "fixed"
            && value["physical_locality_and_cache_honesty_verified"] == false
            && value["windows_version_source"] == "registry-reported",
    )?;
    let registry = &value["windows_registry"];
    keys(
        registry,
        &["ProductName", "DisplayVersion", "CurrentBuildNumber", "UBR"],
    )?;
    for name in ["ProductName", "DisplayVersion", "CurrentBuildNumber", "UBR"] {
        let field = &registry[name];
        if field["available"] == true {
            keys(field, &["available", "value"])?;
            if name == "UBR" {
                require(
                    field["value"]
                        .as_u64()
                        .is_some_and(|n| n <= u32::MAX as u64),
                )?;
            } else {
                let text = field["value"].as_str().ok_or(INVALID)?;
                require(text.encode_utf16().count() <= 511 && !text.chars().any(char::is_control))?;
            }
        } else {
            require(field["available"] == false)?;
            if field.get("native_code").is_some() {
                keys(field, &["available", "native_code"])?;
                require(
                    field["native_code"]
                        .as_u64()
                        .is_some_and(|n| n > 0 && n <= u32::MAX as u64),
                )?;
            } else {
                keys(field, &["available", "reason"])?;
                require(matches!(
                    field["reason"].as_str(),
                    Some("invalid bounded string" | "unexpected type or size")
                ))?;
            }
        }
    }
    Ok(())
}

fn case_result(index: u8) -> Value {
    json!({"case_index": index,
        "selector_checks": if matches!(index, 3 | 4 | 7 | 8) { "not_applicable" } else { "exact_bytes_and_codec_passed" },
        "payload_readback": if matches!(index, 3 | 4) { "exact_bytes_passed" } else { "not_applicable" }})
}

struct Evidence<'a> {
    calls: &'a [Value],
    position: usize,
    completed: bool,
}
impl Evidence<'_> {
    // Failed workers may stop at any point, including after a successful native
    // call whose subsequent identity/receipt/readback check failed.
    fn call(
        &mut self,
        api: &str,
        parameters: Value,
        required: Option<bool>,
    ) -> Result<bool, &'static str> {
        let Some(call) = self.calls.get(self.position) else {
            require(!self.completed)?;
            return Ok(true);
        };
        self.position += 1;
        keys(
            call,
            &["api", "attempted", "succeeded", "native_code", "parameters"],
        )?;
        let succeeded = call["succeeded"].as_bool().ok_or(INVALID)?;
        require(
            call["api"] == api && call["attempted"] == true && call["parameters"] == parameters,
        )?;
        require(code(&call["native_code"]) && (call["native_code"].is_null() == succeeded))?;
        if self.completed {
            if let Some(expected) = required {
                require(succeeded == expected)?;
            }
        }
        Ok(succeeded)
    }
    #[allow(clippy::too_many_arguments)]
    fn open(
        &mut self,
        object: &str,
        stage: &str,
        access: u32,
        share: u32,
        flags: u32,
        disposition: u32,
        required: Option<bool>,
    ) -> Result<bool, &'static str> {
        self.call(
            "CreateFileW",
            json!({"object":object,"stage":stage,"access":access,"share":share,
            "flags":flags | REPARSE,"disposition":disposition}),
            required,
        )
    }
    fn create(&mut self, object: &str, access: u32, flags: u32, stage: &str) -> Check {
        self.open(
            object,
            "case payload creation",
            access,
            7,
            flags,
            1,
            Some(true),
        )?;
        self.call("FlushFileBuffers", json!({"stage":stage}), Some(true))?;
        Ok(())
    }
    fn read(&mut self, object: &str) -> Check {
        self.open(object, "selector readback", READ, 7, 0, 3, Some(true))?;
        Ok(())
    }
}

fn sequence(index: u8, calls: &[Value], completed: bool) -> Check {
    require(calls.len() <= 16)?;
    let mut e = Evidence {
        calls,
        position: 0,
        completed,
    };
    let case = format!("case{index:02}");
    if index <= 2 {
        let object = format!("{case}/control");
        e.create(
            &object,
            READ | WRITE,
            if index == 1 { THROUGH } else { 0 },
            "prepared writable control",
        )?;
        if index == 2 {
            e.open(
                &object,
                "read-only control reopen",
                READ,
                7,
                0,
                3,
                Some(true),
            )?;
            e.call(
                "FlushFileBuffers",
                json!({"stage":"read-only negative control","access":READ,
                "share":7,"flags":REPARSE,"disposition":3}),
                Some(false),
            )?;
        }
    } else if index <= 8 {
        let stable = format!("{case}/stable");
        let root = format!("{stable}/root");
        let generation = format!("{root}/generation");
        let role = (index - 3) / 2;
        let target = match role {
            0 => {
                e.create(
                    &format!("{generation}/payload.bin"),
                    READ | WRITE,
                    0,
                    "generation payload preparation",
                )?;
                &generation
            }
            1 => {
                e.create(
                    &format!("{root}/source"),
                    READ | WRITE,
                    0,
                    "root selector preparation",
                )?;
                e.call(
                    "MoveFileExW",
                    json!({"stage":"directory preparation","flags":8}),
                    Some(true),
                )?;
                e.read(&format!("{root}/active"))?;
                &root
            }
            _ => &stable,
        };
        let opened = e.open(
            target,
            "directory flush observation",
            READ | if index.is_multiple_of(2) { WRITE } else { 0 },
            7,
            BACKUP,
            3,
            None,
        )?;
        if opened {
            e.call("FlushFileBuffers", json!({"role":role}), None)?;
        } else if let Some(call) = calls.get(e.position) {
            require(*call == json!({"api":"FlushFileBuffers","attempted":false}))?;
            e.position += 1;
        } else {
            require(!completed)?;
        }
    } else {
        let source = format!("{case}/source");
        let active = format!("{case}/active");
        let handle = matches!(index, 12..=14 | 17..=19);
        let absent = matches!(index, 9 | 12);
        let reject = matches!(index, 10 | 13 | 15 | 17);
        let sharing = (15..=18).contains(&index);
        let replace = !matches!(index, 9 | 10 | 12 | 13);
        let access = READ | WRITE | if handle { DELETE } else { 0 };
        let flags = if index == 19 { THROUGH } else { 0 };
        e.create(&source, access, flags, "source preparation")?;
        if !absent {
            e.create(&active, READ | WRITE, 0, "target preparation")?;
        }
        if sharing {
            e.open(
                &active,
                "target sharing reader",
                READ,
                if reject { 3 } else { 7 },
                0,
                3,
                Some(true),
            )?;
        }
        let required = if reject {
            Some(false)
        } else if sharing {
            None
        } else {
            Some(true)
        };
        let success = if handle {
            e.call(
                "SetFileInformationByHandle(FileRenameInfo)",
                json!({"replace_if_exists":replace,
                "root_directory_null":true,"destination":"active","source_access":access,
                "source_share":7,"source_flags":flags | REPARSE}),
                required,
            )?
        } else {
            e.call(
                "MoveFileExW",
                json!({"flags":8 | if replace { 1 } else { 0 }}),
                required,
            )?
        };
        if success {
            if handle {
                e.call(
                    "FlushFileBuffers",
                    json!({"stage":"post-rename diagnostic"}),
                    None,
                )?;
            }
            e.read(&active)?;
        } else {
            // A forbidden success stops before readback, but failures inspect the
            // source even when a required successful rename was rejected.
            e.read(&source)?;
            if reject || sharing {
                e.read(&active)?;
            }
        }
    }
    require(e.position == calls.len())
}

fn failure(value: &Value) -> Check {
    keys(
        value,
        &[
            "context",
            "native_code",
            "scratch_may_be_retained",
            "automatic_cleanup_attempted",
            "cleanup_complete",
            "operator_intervention_required",
        ],
    )?;
    let context = value["context"].as_str().ok_or(INVALID)?;
    require(FAILURE_CONTEXTS.contains(&context))?;
    require(
        code(&value["native_code"])
            && value["scratch_may_be_retained"] == true
            && value["automatic_cleanup_attempted"] == false
            && value["cleanup_complete"] == false
            && value["operator_intervention_required"]
                == context.starts_with("operator intervention required:"),
    )
}

/// Synthetic observations for portable controller tests. Never executes native APIs.
#[cfg(test)]
pub(super) fn example(request: &Request) -> WorkerResult {
    let mut calls = Vec::new();
    let result = match request.operation {
        Operation::Preflight => json!({"ownership_recorded":true,"environment":{
            "architecture":"x86_64","non_elevated":true,"storage_privileges_disabled":true,
            "filesystem":"NTFS","drive_type":"fixed","physical_locality_and_cache_honesty_verified":false,
            "windows_version_source":"registry-reported","windows_registry":{
                "ProductName":{"available":true,"value":"Windows test fixture"},
                "DisplayVersion":{"available":false,"native_code":2},
                "CurrentBuildNumber":{"available":true,"value":"26100"},
                "UBR":{"available":true,"value":1}}}}),
        Operation::Cleanup => {
            json!({"cleanup_complete":true,"operator_intervention_required":false})
        }
        Operation::Case { index } => {
            tests::example_calls(index, &mut calls);
            case_result(index)
        }
    };
    WorkerResult {
        status: WorkerStatus::Completed,
        details: json!({
            "result":result,"calls":calls,"elapsed_ms":0,"qualified":false,
            "runtime_publication_enabled":false,"physical_power_loss_tested":false,
            "cleanup_crash_atomic":false,"cleanup_interruption_limitation":LIMITATION
        }),
    }
}

// Native errors contain static context only, never formatted OS diagnostics.
const FAILURE_CONTEXTS: &[&str] = &[
    "case CreateFileW",
    "private ownership CreateFileW",
    "private receipt CreateFileW",
    "run admission guard unavailable",
    "operator intervention required: run admission guard missing",
    "operator intervention required: ownership receipt missing",
    "operator intervention required: final cleanup ownership recovery failed",
    "writable flush control",
    "directory selector preparation",
    "required rename rejected",
    "receipt flush",
    "final receipt restoration flush",
    "case already attempted or invalid",
    "case open cannot access private ownership objects",
    "case open identity changed",
    "cleanup ancestor identity changed",
    "cleanup cannot remove ownership evidence",
    "cleanup object identity changed",
    "cleanup parent syntax",
    "created directory type",
    "created file type",
    "default temp drive syntax",
    "default temp is not a directory",
    "default temp is not a local drive path",
    "default temp resolution",
    "elevated token",
    "enabled storage privilege",
    "exclusive fixture directory creation",
    "exclusive guard must use held handle",
    "exclusive guard retirement",
    "exclusive run directory creation",
    "final ownership changed during restoration",
    "final receipt memory bound",
    "final receipt restoration write",
    "final root identity changed",
    "final root identity changed during restoration",
    "final root removal failed; ownership receipt restored",
    "fixture changed during enumeration",
    "fixture creation bounds",
    "fixture entry enumeration",
    "fixture file size bound",
    "fixture identity changed",
    "fixture identity query",
    "fixture link count",
    "fixture parent type",
    "fixture payload size",
    "fixture payload write",
    "fixture size query",
    "fixture volume changed",
    "guard identity changed before retirement",
    "guard size query",
    "invalid case index",
    "invalid private receipt",
    "invalid receipt case",
    "invalid receipt object set",
    "invalid run ID",
    "native open ownership state",
    "open process token",
    "owned fixture deletion",
    "path bounds",
    "payload bound",
    "payload byte mismatch",
    "payload readback read",
    "payload readback seek",
    "private receipt sharing parameters",
    "privilege lookup",
    "read-only flush unexpectedly accepted",
    "readback read",
    "readback seek",
    "receipt encoding",
    "receipt is not a file",
    "receipt or payload bound",
    "receipt ownership mismatch",
    "receipt read",
    "receipt resource bounds",
    "receipt seek",
    "receipt size bound",
    "receipt size query",
    "receipt write",
    "rename accepted forbidden replacement",
    "rename destination not absolute",
    "renamed selector identity mismatch",
    "reparse or non-disk fixture object",
    "restoration guard not held",
    "restored guard volume changed",
    "restored receipt encoding",
    "restored receipt identity",
    "restored receipt size bound",
    "run admission guard identity or size changed",
    "run admission guard not held",
    "run admission guard type",
    "run cleanup already started",
    "run root identity or volume",
    "saved final receipt encoding",
    "saved final receipt missing guard",
    "saved final receipt missing identity",
    "saved final root identity mismatch",
    "selector byte or codec mismatch",
    "short final receipt restoration write",
    "short fixture payload write",
    "short receipt write",
    "source name remains after rename",
    "temporary filesystem is not NTFS",
    "temporary filesystem query",
    "temporary volume bounds",
    "temporary volume is not fixed",
    "temporary volume path query",
    "token SID bounds",
    "token SID invalid",
    "token elevation bounds",
    "token information",
    "token information bounds",
    "token privileges bounds",
    "token user bounds",
    "unattempted receipt case",
    "unavailable fixture identity",
    "unexpected fixture entry",
    "unrecorded fixture object",
];

#[cfg(test)]
mod tests {
    use super::*;

    fn request(operation: Operation) -> Request {
        Request {
            run_id: "0123456789abcdef0123456789abcdef".into(),
            operation,
        }
    }
    fn call(calls: &mut Vec<Value>, api: &str, parameters: Value, success: bool) {
        calls.push(json!({"api":api,"attempted":true,"succeeded":success,
            "native_code":if success { None } else { Some(5u32) },"parameters":parameters}));
    }
    fn open(
        calls: &mut Vec<Value>,
        object: &str,
        stage: &str,
        access: u32,
        share: u32,
        flags: u32,
        disposition: u32,
    ) {
        call(
            calls,
            "CreateFileW",
            json!({"object":object,"stage":stage,"access":access,
            "share":share,"flags":flags | REPARSE,"disposition":disposition}),
            true,
        );
    }
    fn create(calls: &mut Vec<Value>, object: &str, access: u32, flags: u32, stage: &str) {
        open(calls, object, "case payload creation", access, 7, flags, 1);
        call(calls, "FlushFileBuffers", json!({"stage":stage}), true);
    }
    fn read(calls: &mut Vec<Value>, object: &str) {
        open(calls, object, "selector readback", READ, 7, 0, 3);
    }
    pub(super) fn example_calls(index: u8, calls: &mut Vec<Value>) {
        assert!(index < 20);
        let case = format!("case{index:02}");
        if index <= 2 {
            let object = format!("{case}/control");
            create(
                calls,
                &object,
                READ | WRITE,
                if index == 1 { THROUGH } else { 0 },
                "prepared writable control",
            );
            if index == 2 {
                open(calls, &object, "read-only control reopen", READ, 7, 0, 3);
                call(
                    calls,
                    "FlushFileBuffers",
                    json!({"stage":"read-only negative control",
                    "access":READ,"share":7,"flags":REPARSE,"disposition":3}),
                    false,
                );
            }
        } else if index <= 8 {
            let stable = format!("{case}/stable");
            let root = format!("{stable}/root");
            let generation = format!("{root}/generation");
            let role = (index - 3) / 2;
            let target = match role {
                0 => {
                    create(
                        calls,
                        &format!("{generation}/payload.bin"),
                        READ | WRITE,
                        0,
                        "generation payload preparation",
                    );
                    &generation
                }
                1 => {
                    create(
                        calls,
                        &format!("{root}/source"),
                        READ | WRITE,
                        0,
                        "root selector preparation",
                    );
                    call(
                        calls,
                        "MoveFileExW",
                        json!({"stage":"directory preparation","flags":8}),
                        true,
                    );
                    read(calls, &format!("{root}/active"));
                    &root
                }
                _ => &stable,
            };
            open(
                calls,
                target,
                "directory flush observation",
                READ | if index.is_multiple_of(2) { WRITE } else { 0 },
                7,
                BACKUP,
                3,
            );
            call(calls, "FlushFileBuffers", json!({"role":role}), false);
        } else {
            let source = format!("{case}/source");
            let active = format!("{case}/active");
            let handle = matches!(index, 12..=14 | 17..=19);
            let reject = matches!(index, 10 | 13 | 15 | 17);
            let replace = !matches!(index, 9 | 10 | 12 | 13);
            let access = READ | WRITE | if handle { DELETE } else { 0 };
            let flags = if index == 19 { THROUGH } else { 0 };
            create(calls, &source, access, flags, "source preparation");
            if !matches!(index, 9 | 12) {
                create(calls, &active, READ | WRITE, 0, "target preparation");
            }
            if (15..=18).contains(&index) {
                open(
                    calls,
                    &active,
                    "target sharing reader",
                    READ,
                    if reject { 3 } else { 7 },
                    0,
                    3,
                );
            }
            if handle {
                call(
                    calls,
                    "SetFileInformationByHandle(FileRenameInfo)",
                    json!({"replace_if_exists":replace,
                    "root_directory_null":true,"destination":"active","source_access":access,
                    "source_share":7,"source_flags":flags | REPARSE}),
                    !reject,
                );
                if !reject {
                    call(
                        calls,
                        "FlushFileBuffers",
                        json!({"stage":"post-rename diagnostic"}),
                        false,
                    );
                }
            } else {
                call(
                    calls,
                    "MoveFileExW",
                    json!({"flags":8 | if replace { 1 } else { 0 }}),
                    !reject,
                );
            }
            if reject {
                read(calls, &source);
            }
            read(calls, &active);
        }
    }

    #[test]
    fn native_shaped_completed_operations_and_required_evidence() {
        let operations = [Operation::Preflight, Operation::Cleanup]
            .into_iter()
            .chain((0..20).map(|index| Operation::Case { index }));
        for operation in operations {
            let request = request(operation);
            let valid = example(&request);
            assert_eq!(validate_result(&request, &valid), Ok(()), "{operation:?}");
            for key in [
                "result",
                "calls",
                "elapsed_ms",
                "cleanup_interruption_limitation",
                "qualified",
            ] {
                let mut bad = valid.clone();
                bad.details.as_object_mut().unwrap().remove(key);
                assert!(
                    validate_result(&request, &bad).is_err(),
                    "{operation:?} {key}"
                );
            }
            let calls = valid.details["calls"].as_array().unwrap();
            for position in 0..calls.len() {
                let mut bad = valid.clone();
                bad.details["calls"]
                    .as_array_mut()
                    .unwrap()
                    .remove(position);
                assert!(
                    validate_result(&request, &bad).is_err(),
                    "{operation:?} call {position}"
                );
            }
            for key in [
                "qualified",
                "runtime_publication_enabled",
                "physical_power_loss_tested",
                "cleanup_crash_atomic",
            ] {
                let mut bad = valid.clone();
                bad.details[key] = json!(true);
                assert!(validate_result(&request, &bad).is_err());
            }
        }
    }

    // Visit every schema object, not just known privacy-key locations.
    fn object_paths(value: &Value, path: Vec<String>, paths: &mut Vec<Vec<String>>) {
        match value {
            Value::Object(fields) => {
                paths.push(path.clone());
                for (key, child) in fields {
                    let mut next = path.clone();
                    next.push(key.clone());
                    object_paths(child, next, paths);
                }
            }
            Value::Array(items) => {
                for (i, child) in items.iter().enumerate() {
                    let mut next = path.clone();
                    next.push(i.to_string());
                    object_paths(child, next, paths);
                }
            }
            _ => {}
        }
    }
    #[test]
    fn unknown_fields_are_rejected_at_every_object_level() {
        for operation in [
            Operation::Preflight,
            Operation::Cleanup,
            Operation::Case { index: 18 },
        ] {
            let request = request(operation);
            let valid = example(&request);
            let mut paths = Vec::new();
            object_paths(&valid.details, Vec::new(), &mut paths);
            for path in paths {
                for key in [
                    "username",
                    "SID",
                    "path",
                    "volume_serial",
                    "new_private_field",
                ] {
                    let mut bad = valid.clone();
                    let mut target = &mut bad.details;
                    for segment in &path {
                        target = if target.is_array() {
                            &mut target[segment.parse::<usize>().unwrap()]
                        } else {
                            &mut target[segment.as_str()]
                        };
                    }
                    target
                        .as_object_mut()
                        .unwrap()
                        .insert(key.into(), json!("private"));
                    assert!(validate_result(&request, &bad).is_err(), "{path:?} {key}");
                }
            }
        }
    }

    #[test]
    fn foreign_cases_and_malformed_parameters_are_rejected() {
        for index in 0..20 {
            let request = request(Operation::Case { index });
            let valid = example(&request);
            for (key, value) in [
                ("case_index", json!((index + 1) % 20)),
                ("selector_checks", json!("passed")),
                ("payload_readback", json!("passed")),
            ] {
                let mut bad = valid.clone();
                bad.details["result"][key] = value;
                assert!(validate_result(&request, &bad).is_err());
            }
            for (key, value) in [
                ("object", json!("case99/source")),
                ("object", json!("C:\\Users\\private")),
                ("access", json!(true)),
                ("stage", json!("unknown")),
                ("share", json!(-1)),
            ] {
                let mut bad = valid.clone();
                bad.details["calls"][0]["parameters"][key] = value;
                assert!(validate_result(&request, &bad).is_err());
            }
            let mut bad = valid.clone();
            bad.details["calls"][0]["api"] = json!("NtFlushBuffersFile");
            assert!(validate_result(&request, &bad).is_err());
            let mut bad = valid.clone();
            bad.details["calls"][0]["native_code"] = json!(5);
            assert!(validate_result(&request, &bad).is_err());
        }
    }

    #[test]
    fn directory_open_refusal_and_compatible_sharing_refusal_are_observations() {
        for index in 3..=8 {
            let request = request(Operation::Case { index });
            let mut valid = example(&request);
            let calls = valid.details["calls"].as_array_mut().unwrap();
            let length = calls.len();
            calls[length - 2]["succeeded"] = json!(false);
            calls[length - 2]["native_code"] = json!(5);
            calls[length - 1] = json!({"api":"FlushFileBuffers","attempted":false});
            assert_eq!(validate_result(&request, &valid), Ok(()));
            valid.details["calls"][length - 1]["succeeded"] = json!(false);
            assert!(validate_result(&request, &valid).is_err());
        }
        for index in [16, 18] {
            let request = request(Operation::Case { index });
            let mut valid = example(&request);
            let calls = valid.details["calls"].as_array_mut().unwrap();
            let rename = calls
                .iter()
                .position(|call| {
                    call["api"] == "MoveFileExW"
                        || call["api"] == "SetFileInformationByHandle(FileRenameInfo)"
                })
                .unwrap();
            calls[rename]["succeeded"] = json!(false);
            calls[rename]["native_code"] = json!(5);
            calls.truncate(rename + 1);
            read(calls, &format!("case{index:02}/source"));
            read(calls, &format!("case{index:02}/active"));
            assert_eq!(validate_result(&request, &valid), Ok(()));
        }
    }

    fn failed(request: &Request, status: WorkerStatus, context: &str) -> WorkerResult {
        let mut result = example(request);
        result.status = status;
        result.details["calls"] = json!([]);
        result.details["result"] = json!({"context":context,"native_code":null,
            "scratch_may_be_retained":true,"automatic_cleanup_attempted":false,"cleanup_complete":false,
            "operator_intervention_required":context.starts_with("operator intervention required:")});
        result
    }
    #[test]
    fn active_or_unresolved_worker_guard_refusal_is_not_completed_cleanup() {
        for operation in [Operation::Cleanup]
            .into_iter()
            .chain((0..20).map(|index| Operation::Case { index }))
        {
            let request = request(operation);
            let mut refusal = failed(
                &request,
                WorkerStatus::Refused,
                "run admission guard unavailable",
            );
            // ERROR_SHARING_VIOLATION from opening the exclusively held guard.
            refusal.details["result"]["native_code"] = json!(32);
            assert_eq!(validate_result(&request, &refusal), Ok(()));

            let mut bad = refusal.clone();
            bad.status = WorkerStatus::Completed;
            assert!(validate_result(&request, &bad).is_err());
            for key in [
                "cleanup_complete",
                "automatic_cleanup_attempted",
                "operator_intervention_required",
            ] {
                let mut bad = refusal.clone();
                bad.details["result"][key] = json!(true);
                assert!(validate_result(&request, &bad).is_err());
            }
            let mut bad = refusal.clone();
            bad.details["result"]["context"] =
                json!("run admission guard unavailable: C:\\Users\\private\\admission.lock");
            assert!(validate_result(&request, &bad).is_err());
            let mut bad = refusal.clone();
            bad.details["result"]["guard_path"] = json!("C:\\Users\\private\\admission.lock");
            assert!(validate_result(&request, &bad).is_err());
        }
    }

    #[test]
    fn failures_are_bounded_static_and_cannot_claim_cleanup() {
        for operation in [
            Operation::Preflight,
            Operation::Cleanup,
            Operation::Case { index: 14 },
        ] {
            let request = request(operation);
            for status in [WorkerStatus::Refused, WorkerStatus::InvariantFailure] {
                for context in FAILURE_CONTEXTS {
                    let valid = failed(&request, status, context);
                    assert_eq!(validate_result(&request, &valid), Ok(()));
                }
                let valid = failed(&request, status, "selector byte or codec mismatch");
                for context in [
                    "C:\\Users\\private",
                    "S-1-5-21-123",
                    "username: private",
                    "unknown static context",
                ] {
                    let mut bad = valid.clone();
                    bad.details["result"]["context"] = json!(context);
                    assert!(validate_result(&request, &bad).is_err());
                }
                for key in [
                    "cleanup_complete",
                    "automatic_cleanup_attempted",
                    "operator_intervention_required",
                ] {
                    let mut bad = valid.clone();
                    bad.details["result"][key] = json!(true);
                    assert!(validate_result(&request, &bad).is_err());
                }
                for value in [
                    json!(-1),
                    json!(4294967296u64),
                    json!("5"),
                    json!(true),
                    json!(1.5),
                ] {
                    let mut bad = valid.clone();
                    bad.details["result"]["native_code"] = value;
                    assert!(validate_result(&request, &bad).is_err());
                }
            }
        }
    }

    #[test]
    fn preflight_requires_all_safety_and_registry_evidence() {
        let request = request(Operation::Preflight);
        let valid = example(&request);
        for key in [
            "non_elevated",
            "storage_privileges_disabled",
            "physical_locality_and_cache_honesty_verified",
        ] {
            let mut bad = valid.clone();
            bad.details["result"]["environment"][key] =
                json!(key == "physical_locality_and_cache_honesty_verified");
            assert!(validate_result(&request, &bad).is_err());
        }
        for key in ["ProductName", "DisplayVersion", "CurrentBuildNumber", "UBR"] {
            let mut bad = valid.clone();
            bad.details["result"]["environment"]["windows_registry"]
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(validate_result(&request, &bad).is_err());
        }
        let mut bad = valid.clone();
        bad.details["result"]["ownership_recorded"] = json!(false);
        assert!(validate_result(&request, &bad).is_err());
        let mut bad = valid.clone();
        bad.details["result"]["environment"]["filesystem"] = json!("ReFS");
        assert!(validate_result(&request, &bad).is_err());
        let mut bad = valid.clone();
        bad.details["result"]["environment"]["drive_type"] = json!("remote");
        assert!(validate_result(&request, &bad).is_err());
        let mut bad = valid.clone();
        bad.details["result"]["environment"]["windows_registry"]["UBR"]["value"] = json!("1");
        assert!(validate_result(&request, &bad).is_err());
    }

    #[test]
    fn controls_cannot_complete_with_the_wrong_outcome() {
        for index in [0, 1, 2, 5, 9, 10, 12, 13, 15, 17, 19] {
            let request = request(Operation::Case { index });
            let valid = example(&request);
            for (position, original) in valid.details["calls"]
                .as_array()
                .unwrap()
                .iter()
                .enumerate()
            {
                let api = original["api"].as_str().unwrap();
                let stage = original["parameters"]["stage"].as_str();
                if api == "CreateFileW"
                    || stage == Some("post-rename diagnostic")
                    || original["parameters"].get("role").is_some()
                {
                    continue;
                }
                let mut bad = valid.clone();
                let call = &mut bad.details["calls"][position];
                let success = !original["succeeded"].as_bool().unwrap();
                call["succeeded"] = json!(success);
                call["native_code"] = if success { Value::Null } else { json!(5) };
                assert!(
                    validate_result(&request, &bad).is_err(),
                    "case {index} call {position}"
                );
            }
        }
    }

    #[test]
    fn failed_workers_can_retain_bounded_partial_case_evidence() {
        for index in 0..20 {
            let request = request(Operation::Case { index });
            let completed = example(&request);
            let calls = completed.details["calls"].as_array().unwrap();
            for length in 0..=calls.len() {
                for status in [WorkerStatus::Refused, WorkerStatus::InvariantFailure] {
                    let mut partial = failed(&request, status, "selector byte or codec mismatch");
                    partial.details["calls"] = json!(&calls[..length]);
                    assert_eq!(
                        validate_result(&request, &partial),
                        Ok(()),
                        "case {index} prefix {length}"
                    );
                    partial.details["result"]["private_identity"] = json!("S-1-5-21-123");
                    assert!(validate_result(&request, &partial).is_err());
                }
            }
        }
    }

    #[test]
    fn resource_bounds_apply_before_schema_traversal() {
        let request = request(Operation::Case { index: 0 });
        let valid = example(&request);
        let mut bad = valid.clone();
        bad.details["calls"] = json!(vec![valid.details["calls"][0].clone(); 33]);
        assert!(validate_result(&request, &bad).is_err());
        let mut bad = valid.clone();
        bad.details["result"]["selector_checks"] = json!("x".repeat(2049));
        assert!(validate_result(&request, &bad).is_err());
        let mut nested = json!(null);
        for _ in 0..10 {
            nested = json!({"nested":nested});
        }
        let mut bad = valid.clone();
        bad.details["result"] = nested;
        assert!(validate_result(&request, &bad).is_err());
        for value in [json!(-1), json!(true), json!(1.5)] {
            let mut bad = valid.clone();
            bad.details["elapsed_ms"] = value;
            assert!(validate_result(&request, &bad).is_err());
        }
    }
}
