//! Ordinary-user Win32 observations only. This is not a durability test.
//!
//! Handle bounds are structural: one exclusive admission handle is retained
//! throughout admitted work. At most a source, a target reader, a checked
//! directory, its enumeration iterator, and one identity-query handle coexist
//! with it (six handles). Loading retains a receipt reader instead of the two
//! case handles. Receipt writes occur outside enumeration; final recovery holds
//! only the guard and restored receipt. Token checks finish before filesystem
//! work. No collection owns handles; loops release each iteration's handles.
//!
//! Finalization retires admission with owned-handle deletion before releasing
//! the guard. No subsequent worker creates a missing guard. Interruption in the
//! final receipt/guard/root deletion interval can leave incomplete ownership
//! evidence or an empty root; that requires operator intervention, not adoption.
#![cfg(all(test, windows))]

use std::{
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    mem::{offset_of, size_of},
    os::windows::{
        ffi::OsStrExt,
        io::{AsRawHandle, FromRawHandle},
    },
    path::Path,
    ptr::{null, null_mut},
    time::Instant,
};

use serde_json::{json, Value};
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, GetLastError, GENERIC_READ, GENERIC_WRITE, HANDLE, INVALID_HANDLE_VALUE, LUID,
    },
    Security::{
        GetLengthSid, GetTokenInformation, IsValidSid, LookupPrivilegeValueW, TokenElevation,
        TokenPrivileges, TokenUser, LUID_AND_ATTRIBUTES, SE_PRIVILEGE_ENABLED, TOKEN_ELEVATION,
        TOKEN_INFORMATION_CLASS, TOKEN_PRIVILEGES, TOKEN_QUERY, TOKEN_USER,
    },
    Storage::FileSystem::*,
    System::{
        Registry::*,
        Threading::{GetCurrentProcess, OpenProcessToken},
    },
};

use super::{Operation, Request, WorkerResult, WorkerStatus};
use crate::plugin_registry::selector::{decode, encode, GenerationId};

#[path = "cleanup_protocol.rs"]
mod cleanup_protocol;
#[path = "ownership.rs"]
mod ownership;
use ownership::Run;

const SHARE: u32 = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
const MAX_PATH_UNITS: usize = 4096;
const MAX_RECEIPT: usize = 64 * 1024;
const MAX_PAYLOAD: u64 = 1024 * 1024;
const MAX_OBJECTS: usize = 256;
type Result<T> = std::result::Result<T, Failure>;

struct Failure {
    invariant: bool,
    context: &'static str,
    code: Option<u32>,
}

fn refuse(context: &'static str) -> Failure {
    Failure {
        invariant: false,
        context,
        code: None,
    }
}
fn invariant(context: &'static str) -> Failure {
    Failure {
        invariant: true,
        context,
        code: None,
    }
}
fn native_error(context: &'static str) -> Failure {
    // Must be the first native call after a failed BOOL/handle operation.
    let code = unsafe { GetLastError() };
    Failure {
        invariant: false,
        context,
        code: Some(code),
    }
}
fn io_error(context: &'static str, error: std::io::Error) -> Failure {
    Failure {
        invariant: false,
        context,
        code: error.raw_os_error().map(|code| code as u32),
    }
}

struct Token(HANDLE);
impl Drop for Token {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}

// u64 storage provides alignment for all token records used here. No probing
// retry is needed: an unexpectedly large token observation is a refusal.
fn token_info(token: &Token, class: TOKEN_INFORMATION_CLASS) -> Result<(Vec<u64>, usize)> {
    let mut buffer = vec![0u64; 2048];
    let mut length = 0;
    let ok = unsafe {
        GetTokenInformation(
            token.0,
            class,
            buffer.as_mut_ptr().cast(),
            (buffer.len() * size_of::<u64>()) as u32,
            &mut length,
        )
    };
    if ok == 0 {
        return Err(native_error("token information"));
    }
    if length as usize > buffer.len() * size_of::<u64>() {
        return Err(refuse("token information bounds"));
    }
    Ok((buffer, length as usize))
}

fn checked_user() -> Result<Vec<u8>> {
    let mut raw = null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
        return Err(native_error("open process token"));
    }
    let token = Token(raw);
    let (elevation, length) = token_info(&token, TokenElevation)?;
    if length != size_of::<TOKEN_ELEVATION>() {
        return Err(refuse("token elevation bounds"));
    }
    if unsafe { (*(elevation.as_ptr().cast::<TOKEN_ELEVATION>())).TokenIsElevated } != 0 {
        return Err(refuse("elevated token"));
    }
    let (privileges, length) = token_info(&token, TokenPrivileges)?;
    let start = offset_of!(TOKEN_PRIVILEGES, Privileges);
    if length < start {
        return Err(refuse("token privileges bounds"));
    }
    let count =
        unsafe { (*privileges.as_ptr().cast::<TOKEN_PRIVILEGES>()).PrivilegeCount } as usize;
    if count > (length - start) / size_of::<LUID_AND_ATTRIBUTES>() {
        return Err(refuse("token privileges bounds"));
    }
    for name in [
        "SeBackupPrivilege",
        "SeRestorePrivilege",
        "SeManageVolumePrivilege",
    ] {
        let name = wide_text(name);
        let mut luid = LUID::default();
        if unsafe { LookupPrivilegeValueW(null(), name.as_ptr(), &mut luid) } == 0 {
            return Err(native_error("privilege lookup"));
        }
        for index in 0..count {
            let entry = unsafe {
                &*(privileges
                    .as_ptr()
                    .cast::<u8>()
                    .add(start)
                    .cast::<LUID_AND_ATTRIBUTES>()
                    .add(index))
            };
            if entry.Luid.LowPart == luid.LowPart
                && entry.Luid.HighPart == luid.HighPart
                && entry.Attributes & SE_PRIVILEGE_ENABLED != 0
            {
                return Err(refuse("enabled storage privilege"));
            }
        }
    }
    let (user, length) = token_info(&token, TokenUser)?;
    if length < size_of::<TOKEN_USER>() {
        return Err(refuse("token user bounds"));
    }
    let sid = unsafe { (*user.as_ptr().cast::<TOKEN_USER>()).User.Sid };
    let begin = user.as_ptr() as usize;
    let address = sid as usize;
    // Validate the SID header and its full extent before asking the SID APIs.
    if address < begin
        || address
            .checked_add(8)
            .is_none_or(|end| end > begin + length)
    {
        return Err(refuse("token SID bounds"));
    }
    let count = unsafe { *sid.cast::<u8>().add(1) } as usize;
    let sid_length = 8 + 4 * count;
    if count > 15
        || address
            .checked_add(sid_length)
            .is_none_or(|end| end > begin + length)
    {
        return Err(refuse("token SID bounds"));
    }
    if unsafe { IsValidSid(sid) } == 0 || unsafe { GetLengthSid(sid) } as usize != sid_length {
        return Err(refuse("token SID invalid"));
    }
    Ok(unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), sid_length) }.to_vec())
}

pub(super) fn check_token() -> std::result::Result<(), String> {
    checked_user()
        .map(|_| ())
        .map_err(|error| match error.code {
            Some(code) => format!("{}: native code {code}", error.context),
            None => error.context.to_owned(),
        })
}

pub(super) fn execute(request: &Request) -> WorkerResult {
    let started = Instant::now();
    let mut observations = Vec::new();
    let outcome = (|| {
        if !valid_run_id(&request.run_id) {
            return Err(refuse("invalid run ID"));
        }
        if matches!(request.operation, Operation::Case { index } if index >= 20) {
            return Err(refuse("invalid case index"));
        }
        let user = checked_user()?;
        match request.operation {
            Operation::Preflight => {
                let environment = environment()?;
                let _run = Run::create(&request.run_id, user)?;
                Ok(json!({"environment": environment, "ownership_recorded": true}))
            }
            Operation::Case { index } => {
                let mut run = Run::load(&request.run_id, user)?;
                run.begin_case(index)?;
                run_case(&mut run, index, &mut observations)?;
                run.verify()?;
                Ok(json!({"case_index": index,
                    "selector_checks": if matches!(index, 3 | 4 | 7 | 8) {
                        "not_applicable"
                    } else { "exact_bytes_and_codec_passed" },
                    "payload_readback": if matches!(index, 3 | 4) {
                        "exact_bytes_passed"
                    } else { "not_applicable" }}))
            }
            Operation::Cleanup => {
                let run = Run::load_cleanup(&request.run_id, user)?;
                run.cleanup()?;
                Ok(json!({"cleanup_complete": true, "operator_intervention_required": false}))
            }
        }
    })();
    let (status, result) = match outcome {
        Ok(value) => (WorkerStatus::Completed, value),
        Err(error) => (
            if error.invariant {
                WorkerStatus::InvariantFailure
            } else {
                WorkerStatus::Refused
            },
            json!({"context": error.context, "native_code": error.code,
                "scratch_may_be_retained": true, "automatic_cleanup_attempted": false,
                "cleanup_complete": false,
                                "operator_intervention_required": error.context.starts_with("operator intervention required:")}),
        ),
    };
    WorkerResult {
        status,
        details: json!({
            "result": result, "calls": observations,
            "elapsed_ms": started.elapsed().as_millis().min(u64::MAX as u128) as u64,
            "qualified": false, "runtime_publication_enabled": false,
            "physical_power_loss_tested": false,
            "cleanup_crash_atomic": false,
            "cleanup_interruption_limitation": "Interruption during final receipt/guard/root deletion can leave incomplete ownership/admission evidence or an empty root. Missing evidence requires operator intervention; workers never recreate a missing admission guard.",
        }),
    }
}

fn valid_run_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn wide_text(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(Some(0)).collect()
}
fn wide_path(path: &Path) -> Result<Vec<u16>> {
    let mut units: Vec<u16> = path.as_os_str().encode_wide().collect();
    if units.is_empty() || units.len() >= MAX_PATH_UNITS || units.contains(&0) {
        return Err(refuse("path bounds"));
    }
    units.push(0);
    Ok(units)
}
fn raw(file: &File) -> HANDLE {
    file.as_raw_handle()
}

fn open(path: &Path, access: u32, share: u32, disposition: u32, flags: u32) -> Result<File> {
    open_observed(path, access, share, disposition, flags, None)
}

// Only the actual native call emits an attempted case-open observation. Later
// identity, receipt, or payload failures must not change that call's outcome.
fn open_observed(
    path: &Path,
    access: u32,
    share: u32,
    disposition: u32,
    flags: u32,
    observation: Option<(&mut Vec<Value>, &str, &'static str)>,
) -> Result<File> {
    let path = wide_path(path)?;
    let handle = unsafe {
        CreateFileW(
            path.as_ptr(),
            access,
            share,
            null(),
            disposition,
            flags | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    let failure = if handle == INVALID_HANDLE_VALUE {
        Some(native_error(if observation.is_some() {
            "case CreateFileW"
        } else {
            "private ownership CreateFileW"
        }))
    } else {
        None
    };
    // Take ownership before allocating the JSON record as well.
    let file = if failure.is_none() {
        Some(unsafe { File::from_raw_handle(handle) })
    } else {
        None
    };
    if let Some((calls, object, stage)) = observation {
        let outcome = match &failure {
            Some(error) => Err(error.code.unwrap_or(0)),
            None => Ok(()),
        };
        record_call(
            calls,
            "CreateFileW",
            &outcome,
            json!({
                "object": object, "stage": stage, "access": access, "share": share,
                "flags": flags | FILE_FLAG_OPEN_REPARSE_POINT, "disposition": disposition,
            }),
        );
    }
    match (file, failure) {
        (Some(file), None) => Ok(file),
        (_, Some(error)) => Err(error),
        _ => Err(invariant("native open ownership state")),
    }
}
fn flush(file: &File) -> std::result::Result<(), u32> {
    if unsafe { FlushFileBuffers(raw(file)) } == 0 {
        return Err(unsafe { GetLastError() });
    }
    Ok(())
}
fn record_call(
    calls: &mut Vec<Value>,
    api: &'static str,
    result: &std::result::Result<(), u32>,
    extra: Value,
) {
    calls.push(
        json!({"api": api, "attempted": true, "succeeded": result.is_ok(),
        "native_code": result.as_ref().err(), "parameters": extra}),
    );
}
fn required_flush(file: &File, calls: &mut Vec<Value>, stage: &'static str) -> Result<()> {
    let result = flush(file);
    record_call(calls, "FlushFileBuffers", &result, json!({"stage": stage}));
    result.map_err(|code| Failure {
        invariant: true,
        context: "writable flush control",
        code: Some(code),
    })
}
fn records() -> ([u8; 64], [u8; 64]) {
    (
        encode(GenerationId::from_bytes([0x11; 16])),
        encode(GenerationId::from_bytes([0x22; 16])),
    )
}
fn check_record(file: &mut File, expected: &[u8; 64]) -> Result<()> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| io_error("readback seek", error))?;
    let mut bytes = Vec::with_capacity(65);
    file.take(65)
        .read_to_end(&mut bytes)
        .map_err(|error| io_error("readback read", error))?;
    if bytes != expected || decode(&bytes).ok() != decode(expected).ok() || decode(&bytes).is_err()
    {
        return Err(invariant("selector byte or codec mismatch"));
    }
    Ok(())
}

fn run_case(run: &mut Run, index: u8, calls: &mut Vec<Value>) -> Result<()> {
    let case = format!("case{index:02}");
    let (old, new) = records();
    if index <= 2 {
        let name = format!("{case}/control");
        let flags = if index == 1 {
            FILE_FLAG_WRITE_THROUGH
        } else {
            0
        };
        let mut file = run.file(&name, &new, flags, GENERIC_READ | GENERIC_WRITE, calls)?;
        required_flush(&file, calls, "prepared writable control")?;
        check_record(&mut file, &new)?;
        if index == 2 {
            drop(file);
            let mut reader = run.open_case_owned(
                &name,
                GENERIC_READ,
                SHARE,
                0,
                calls,
                "read-only control reopen",
            )?;
            let result = flush(&reader);
            record_call(
                calls,
                "FlushFileBuffers",
                &result,
                json!({"stage": "read-only negative control", "access": GENERIC_READ,
                    "share": SHARE, "flags": FILE_FLAG_OPEN_REPARSE_POINT,
                    "disposition": OPEN_EXISTING}),
            );
            if result.is_ok() {
                return Err(invariant("read-only flush unexpectedly accepted"));
            }
            check_record(&mut reader, &new)?;
        }
        return Ok(());
    }
    if index <= 8 {
        return directory_case(run, index, calls);
    }
    rename_case(run, index, calls, &case, &old, &new)
}

fn directory_case(run: &mut Run, index: u8, calls: &mut Vec<Value>) -> Result<()> {
    let case = format!("case{index:02}");
    let stable = format!("{case}/stable");
    let root = format!("{stable}/root");
    let generation = format!("{root}/generation");
    run.directory(&stable)?;
    run.directory(&root)?;
    let role = (index - 3) / 2;
    let target = match role {
        0 => {
            run.directory(&generation)?;
            let mut file = run.file(
                &format!("{generation}/payload.bin"),
                b"bounded payload\n",
                0,
                GENERIC_READ | GENERIC_WRITE,
                calls,
            )?;
            required_flush(&file, calls, "generation payload preparation")?;
            file.seek(SeekFrom::Start(0))
                .map_err(|error| io_error("payload readback seek", error))?;
            let mut bytes = Vec::new();
            (&mut file)
                .take(65)
                .read_to_end(&mut bytes)
                .map_err(|error| io_error("payload readback read", error))?;
            if bytes != b"bounded payload\n" {
                return Err(invariant("payload byte mismatch"));
            }
            generation
        }
        1 => {
            let (_, new) = records();
            let source = format!("{root}/source");
            let active = format!("{root}/active");
            let file = run.file(&source, &new, 0, GENERIC_READ | GENERIC_WRITE, calls)?;
            required_flush(&file, calls, "root selector preparation")?;
            drop(file);
            let result = move_selector(run, &source, &active, false);
            record_call(
                calls,
                "MoveFileExW",
                &result,
                json!({"stage": "directory preparation",
                "flags": MOVEFILE_WRITE_THROUGH}),
            );
            if let Err(code) = result {
                return Err(Failure {
                    invariant: true,
                    context: "directory selector preparation",
                    code: Some(code),
                });
            }
            run.renamed(&source, &active)?;
            run.check(&active, &new, calls)?;
            run.absent(&source)?;
            root
        }
        _ => stable,
    };
    run.verify()?;
    let writable = (index - 3) % 2 == 1;
    let access = GENERIC_READ | if writable { GENERIC_WRITE } else { 0 };
    let opened = run.open_case_owned(
        &target,
        access,
        SHARE,
        FILE_FLAG_BACKUP_SEMANTICS,
        calls,
        "directory flush observation",
    );
    match opened {
        Ok(file) => {
            let result = flush(&file);
            record_call(calls, "FlushFileBuffers", &result, json!({"role": role}));
        }
        Err(error) if error.context == "case CreateFileW" && error.code.is_some() => {
            calls.push(json!({"api": "FlushFileBuffers", "attempted": false}));
        }
        Err(error) => return Err(error),
    }
    Ok(())
}

fn move_selector(
    run: &Run,
    source: &str,
    active: &str,
    replace: bool,
) -> std::result::Result<(), u32> {
    super::super::platform::replace_selector(&run.path(source), &run.path(active), replace)
        .map_err(|error| error.raw_os_error().map(|code| code as u32).unwrap_or(0))
}

fn rename_handle(
    file: &File,
    destination: &Path,
    replace: bool,
) -> Result<std::result::Result<(), u32>> {
    if !destination.is_absolute() {
        return Err(refuse("rename destination not absolute"));
    }
    let mut name = wide_path(destination)?;
    name.pop();
    let offset = offset_of!(FILE_RENAME_INFO, FileName);
    let length = offset + name.len() * size_of::<u16>();
    // Aligned, zeroed storage includes the flexible UTF-16 tail and any ABI padding.
    let buffer_length = length.max(size_of::<FILE_RENAME_INFO>());
    let mut storage = vec![0u64; buffer_length.div_ceil(8)];
    unsafe {
        let info = storage.as_mut_ptr().cast::<FILE_RENAME_INFO>();
        (*info).Anonymous.ReplaceIfExists = replace;
        (*info).RootDirectory = null_mut();
        (*info).FileNameLength = (name.len() * 2) as u32;
        std::ptr::copy_nonoverlapping(
            name.as_ptr(),
            storage.as_mut_ptr().cast::<u8>().add(offset).cast::<u16>(),
            name.len(),
        );
        if SetFileInformationByHandle(raw(file), FileRenameInfo, info.cast(), buffer_length as u32)
            == 0
        {
            return Ok(Err(GetLastError()));
        }
    }
    Ok(Ok(()))
}

fn rename_case(
    run: &mut Run,
    index: u8,
    calls: &mut Vec<Value>,
    case: &str,
    old: &[u8; 64],
    new: &[u8; 64],
) -> Result<()> {
    let source = format!("{case}/source");
    let active = format!("{case}/active");
    let handle_api = matches!(index, 12..=14 | 17..=19);
    let absent = matches!(index, 9 | 12);
    let exclusive_existing = matches!(index, 10 | 13);
    let replace = !absent && !exclusive_existing;
    let sharing = (15..=18).contains(&index);
    let blocking = matches!(index, 15 | 17);
    let flags = if index == 19 {
        FILE_FLAG_WRITE_THROUGH
    } else {
        0
    };
    let access = GENERIC_READ | GENERIC_WRITE | if handle_api { DELETE } else { 0 };
    let mut source_file = run.file(&source, new, flags, access, calls)?;
    required_flush(&source_file, calls, "source preparation")?;
    check_record(&mut source_file, new)?;
    if !absent {
        let mut target = run.file(&active, old, 0, GENERIC_READ | GENERIC_WRITE, calls)?;
        required_flush(&target, calls, "target preparation")?;
        check_record(&mut target, old)?;
    }
    let reader_share = if blocking {
        FILE_SHARE_READ | FILE_SHARE_WRITE
    } else {
        SHARE
    };
    let mut reader = if sharing {
        let file = run.open_case_owned(
            &active,
            GENERIC_READ,
            reader_share,
            0,
            calls,
            "target sharing reader",
        )?;
        Some(file)
    } else {
        None
    };
    run.verify()?;
    let outcome = if handle_api {
        rename_handle(&source_file, &run.path(&active), replace)?
    } else {
        drop(source_file);
        let outcome = move_selector(run, &source, &active, replace);
        // No source reopen, API retry or access-right fallback after the attempt.
        return finish_move(
            run,
            calls,
            outcome,
            reader,
            blocking,
            exclusive_existing,
            sharing,
            replace,
            &source,
            &active,
            old,
            new,
        );
    };
    record_call(
        calls,
        "SetFileInformationByHandle(FileRenameInfo)",
        &outcome,
        json!({"replace_if_exists": replace, "root_directory_null": true,
            "destination": "active", "source_access": access, "source_share": SHARE,
            "source_flags": flags | FILE_FLAG_OPEN_REPARSE_POINT}),
    );
    if outcome.is_ok() {
        let diagnostic = flush(&source_file);
        record_call(
            calls,
            "FlushFileBuffers",
            &diagnostic,
            json!({"stage": "post-rename diagnostic"}),
        );
    }
    if outcome.is_ok() && (blocking || exclusive_existing) {
        return Err(invariant("rename accepted forbidden replacement"));
    }
    if let Some(file) = reader.as_mut() {
        check_record(file, old)?;
    }
    drop(reader);
    drop(source_file);
    finish_rename(
        run,
        calls,
        outcome,
        sharing,
        blocking || exclusive_existing,
        &source,
        &active,
        old,
        new,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_move(
    run: &mut Run,
    calls: &mut Vec<Value>,
    outcome: std::result::Result<(), u32>,
    mut reader: Option<File>,
    blocking: bool,
    exclusive_existing: bool,
    sharing: bool,
    replace: bool,
    source: &str,
    active: &str,
    old: &[u8; 64],
    new: &[u8; 64],
) -> Result<()> {
    record_call(
        calls,
        "MoveFileExW",
        &outcome,
        json!({"flags": MOVEFILE_WRITE_THROUGH
        | if replace { MOVEFILE_REPLACE_EXISTING } else { 0 }}),
    );
    if outcome.is_ok() && (blocking || exclusive_existing) {
        return Err(invariant("rename accepted forbidden replacement"));
    }
    if let Some(file) = reader.as_mut() {
        check_record(file, old)?;
    }
    drop(reader);
    finish_rename(
        run,
        calls,
        outcome,
        sharing,
        blocking || exclusive_existing,
        source,
        active,
        old,
        new,
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_rename(
    run: &mut Run,
    calls: &mut Vec<Value>,
    outcome: std::result::Result<(), u32>,
    sharing: bool,
    must_reject: bool,
    source: &str,
    active: &str,
    old: &[u8; 64],
    new: &[u8; 64],
) -> Result<()> {
    match outcome {
        Ok(()) => {
            run.renamed(source, active)?;
            run.check(active, new, calls)?;
            run.absent(source)?;
        }
        Err(code) => {
            run.check(source, new, calls)?;
            // All permitted refusals in this matrix have an existing old target.
            if must_reject || sharing {
                run.check(active, old, calls)?;
            } else {
                return Err(Failure {
                    invariant: true,
                    context: "required rename rejected",
                    code: Some(code),
                });
            }
        }
    }
    Ok(())
}

fn environment() -> Result<Value> {
    let subkey = wide_text("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion");
    let mut fields = serde_json::Map::new();
    // RegGetValueW is read-only. Only these literal fields are queried. Its return
    // value is the native status; GetLastError is not relevant to this API.
    for name in ["ProductName", "DisplayVersion", "CurrentBuildNumber", "UBR"] {
        let wide_name = wide_text(name);
        let mut buffer = [0u32; 256];
        let mut length = (buffer.len() * 4) as u32;
        let mut kind = 0;
        let flags = if name == "UBR" {
            RRF_RT_REG_DWORD
        } else {
            RRF_RT_REG_SZ
        } | RRF_SUBKEY_WOW6464KEY;
        let code = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                subkey.as_ptr(),
                wide_name.as_ptr(),
                flags,
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut length,
            )
        };
        let value = if code != 0 {
            json!({"available": false, "native_code": code})
        } else if name == "UBR" && kind == REG_DWORD && length == 4 {
            json!({"available": true, "value": buffer[0]})
        } else if name != "UBR"
            && kind == REG_SZ
            && (2..=1024).contains(&length)
            && length.is_multiple_of(2)
        {
            let units = unsafe {
                std::slice::from_raw_parts(buffer.as_ptr().cast::<u16>(), length as usize / 2)
            };
            if units.last() != Some(&0) || units[..units.len() - 1].contains(&0) {
                json!({"available": false, "reason": "invalid bounded string"})
            } else {
                match String::from_utf16(&units[..units.len() - 1]) {
                    Ok(text) if text.chars().all(|character| !character.is_control()) => {
                        json!({"available": true, "value": text})
                    }
                    _ => json!({"available": false, "reason": "invalid bounded string"}),
                }
            }
        } else {
            json!({"available": false, "reason": "unexpected type or size"})
        };
        fields.insert(name.to_owned(), value);
    }
    Ok(
        json!({"architecture": std::env::consts::ARCH, "non_elevated": true,
        "storage_privileges_disabled": true, "filesystem": "NTFS", "drive_type": "fixed",
        "physical_locality_and_cache_honesty_verified": false,
        "windows_version_source": "registry-reported", "windows_registry": fields}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_ids_are_fixed_lowercase_hex() {
        assert!(valid_run_id("0123456789abcdef0123456789abcdef"));
        for bad in [
            "",
            "../escape",
            "0123456789ABCDEF0123456789ABCDEF",
            "0123456789abcdef0123456789abcdef0",
        ] {
            assert!(!valid_run_id(bad));
        }
    }

    #[test]
    fn records_use_production_codec() {
        let (old, new) = records();
        assert_ne!(old, new);
        assert_eq!(decode(&old).unwrap(), GenerationId::from_bytes([0x11; 16]));
        assert_eq!(decode(&new).unwrap(), GenerationId::from_bytes([0x22; 16]));
    }
}
