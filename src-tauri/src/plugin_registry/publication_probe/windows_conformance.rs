//! Bounded, opt-in Win32 conformance observations, never qualification.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::fs::{self, OpenOptions};

#[path = "windows_conformance/schema.rs"]
mod schema;

#[cfg(not(windows))]
#[path = "windows_conformance/cleanup_protocol.rs"]
mod cleanup_protocol;
#[cfg(windows)]
#[path = "windows_conformance/native.rs"]
mod native;

const PREFIX: &str = "WIDE_WINDOWS_CONFORMANCE ";
const OPT_IN: &str = "WIDE_WINDOWS_CONFORMANCE_OPT_IN";
const ACTION: &str = "WIDE_WINDOWS_CONFORMANCE_ACTION";
const RUN_ID: &str = "WIDE_WINDOWS_CONFORMANCE_RUN_ID";
const WORKER: &str = "WIDE_WINDOWS_CONFORMANCE_WORKER";
const WORKER_ENTRY: &str = "plugin_registry::publication_probe::windows_conformance::worker_entry";
const MAX_OUTPUT: usize = 32 * 1024;
const MAX_REPORT: usize = 1024 * 1024;
const MAX_REQUEST: usize = 1024;
const WORKER_TIME: Duration = Duration::from_secs(10);
const RUN_TIME: Duration = Duration::from_secs(300);
const REAP_TIME: Duration = Duration::from_secs(2);
const CASES: [&str; 20] = [
    "file-buffered",
    "file-write-through",
    "file-read-only",
    "generation-directory-read",
    "generation-directory-write",
    "root-directory-read",
    "root-directory-write",
    "stable-parent-read",
    "stable-parent-write",
    "move-exclusive-absent",
    "move-exclusive-existing",
    "move-replace",
    "handle-exclusive-absent",
    "handle-exclusive-existing",
    "handle-replace",
    "move-blocked-reader",
    "move-shared-reader",
    "handle-blocked-reader",
    "handle-shared-reader",
    "handle-write-through-replace",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum Operation {
    Preflight,
    Case { index: u8 },
    Cleanup,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Request {
    pub run_id: String,
    pub operation: Operation,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum WorkerStatus {
    Completed,
    Refused,
    InvariantFailure,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WorkerResult {
    pub status: WorkerStatus,
    pub details: Value,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Wire {
    request: Request,
    result: WorkerResult,
}

fn valid_id(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate_request(request: &Request) -> Result<(), &'static str> {
    if !valid_id(&request.run_id) {
        return Err("invalid run ID");
    }
    if matches!(request.operation, Operation::Case { index } if usize::from(index) >= CASES.len()) {
        return Err("invalid case index");
    }
    Ok(())
}
fn admission(
    opt_in: Option<&str>,
    action: Option<&str>,
    id: Option<&str>,
) -> Result<bool, &'static str> {
    if opt_in != Some("1") {
        return Err("explicit conformance opt-in required");
    }
    match action.unwrap_or("execute") {
        "execute" if id.is_none() => Ok(false),
        "cleanup" if id.is_some_and(valid_id) => Ok(true),
        _ => Err("execute accepts no run ID; cleanup requires one valid run ID"),
    }
}
fn new_id() -> Result<String, &'static str> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| "run ID allocation failed")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

struct Capture {
    stdout: Vec<u8>,
    success: bool,
}
enum PipeEvent {
    Data { stdout: bool, bytes: Vec<u8> },
    End,
    Failed,
    Overflow,
}
fn drain(
    mut input: impl Read + Send + 'static,
    stdout: bool,
    total: Arc<AtomicUsize>,
    tx: mpsc::Sender<PipeEvent>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let mut buffer = [0u8; 1024];
        loop {
            match input.read(&mut buffer) {
                Ok(0) => {
                    let _ = tx.send(PipeEvent::End);
                    return;
                }
                Ok(count) => {
                    // Each of the two readers stops at its first over-budget chunk.
                    // The counter therefore cannot overflow, even after refusal.
                    let previous = total.fetch_add(count, Ordering::Relaxed);
                    if previous > MAX_OUTPUT - count {
                        let _ = tx.send(PipeEvent::Overflow);
                        return;
                    }
                    if tx
                        .send(PipeEvent::Data {
                            stdout,
                            bytes: buffer[..count].to_vec(),
                        })
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Err(_) => {
                    let _ = tx.send(PipeEvent::Failed);
                    return;
                }
            }
        }
    })
}

struct ChildGuard(Child);
impl ChildGuard {
    fn terminate(&mut self, deadline: Instant) -> bool {
        if self.0.try_wait().ok().flatten().is_some() {
            return true;
        }
        let _ = self.0.kill();
        loop {
            match self.0.try_wait() {
                Ok(Some(_)) => return true,
                Err(_) => return false,
                Ok(None) => {}
            }
            if Instant::now() >= deadline {
                return false;
            }
            thread::sleep(Duration::from_millis(2));
        }
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        // Never let unwinding introduce an unbounded Child::wait().
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
    }
}

fn capture(
    command: &mut Command,
    input: Option<&[u8]>,
    deadline: Instant,
) -> Result<Capture, &'static str> {
    if input.is_some_and(|bytes| bytes.len() > MAX_REQUEST) {
        return Err("worker request bound");
    }
    if Instant::now() >= deadline {
        return Err("deadline before spawn");
    }
    command
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = ChildGuard(command.spawn().map_err(|_| "worker spawn failed")?);
    let stdout = child.0.stdout.take().ok_or("missing stdout pipe")?;
    let stderr = child.0.stderr.take().ok_or("missing stderr pipe")?;
    let (tx, rx) = mpsc::channel();
    let total = Arc::new(AtomicUsize::new(0));
    let readers = [
        drain(stdout, true, total.clone(), tx.clone()),
        drain(stderr, false, total, tx.clone()),
    ];
    drop(tx);
    if let Some(bytes) = input {
        let write = child
            .0
            .stdin
            .take()
            .ok_or("missing request pipe")?
            .write_all(bytes);
        if write.is_err() {
            let reaped = child.terminate(Instant::now() + REAP_TIME);
            return Err(if reaped {
                "request write failed"
            } else {
                "request failed; child unresolved"
            });
        }
    }
    let mut bytes = Vec::new();
    let mut ends = 0;
    let mut status = None;
    let outcome = loop {
        match rx.recv_timeout(Duration::from_millis(2)) {
            Ok(PipeEvent::Data {
                stdout,
                bytes: part,
            }) => {
                if stdout {
                    bytes.extend(part);
                }
            }
            Ok(PipeEvent::End) => ends += 1,
            Ok(PipeEvent::Failed) => break Err("worker pipe read failed"),
            Ok(PipeEvent::Overflow) => break Err("worker output bound"),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) if ends != 2 => {
                break Err("worker pipe incomplete");
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {}
        }
        if status.is_none() {
            match child.0.try_wait() {
                Ok(value) => status = value,
                Err(_) => break Err("worker wait failed"),
            }
        }
        if let Some(status) = status {
            if ends == 2 {
                break Ok(Capture {
                    stdout: bytes,
                    success: status.success(),
                });
            }
        }
        if Instant::now() >= deadline {
            break Err("worker deadline");
        }
    };
    let result = match outcome {
        Ok(value) => Ok(value),
        Err(error) => {
            if child.terminate(Instant::now() + REAP_TIME) {
                Err(error)
            } else {
                Err("worker incomplete; child unresolved; cleanup forbidden")
            }
        }
    };
    // A descendant or OS I/O can keep a pipe open. Do not block on reader joins.
    for reader in readers {
        if reader.is_finished() {
            let _ = reader.join();
        }
    }
    result
}

fn sanitized(value: &Value, depth: usize) -> bool {
    if depth > 16 {
        return false;
    }
    match value {
        Value::Array(values) => {
            values.len() <= 256 && values.iter().all(|v| sanitized(v, depth + 1))
        }
        Value::Object(values) => {
            values.len() <= 64
                && values.iter().all(|(key, value)| {
                    !matches!(
                        key.as_str(),
                        "sid" | "user" | "path" | "root_path" | "volume_serial" | "volume_id"
                    ) && key.len() <= 128
                        && sanitized(value, depth + 1)
                })
        }
        Value::String(text) => {
            text.len() <= 1024
                && !text.chars().any(char::is_control)
                && !text.contains('\\')
                && !text.contains(":/")
                && !text.contains("S-1-")
                && !text.starts_with('/')
        }
        _ => true,
    }
}
fn parse_wire(bytes: &[u8], request: &Request) -> Result<WorkerResult, &'static str> {
    if bytes.len() > MAX_OUTPUT {
        return Err("worker output bound");
    }
    let positions: Vec<_> = bytes
        .windows(PREFIX.len())
        .enumerate()
        .filter_map(|(index, part)| (part == PREFIX.as_bytes()).then_some(index))
        .collect();
    if positions.len() != 1 {
        return Err("expected exactly one worker record");
    }
    let tail = &bytes[positions[0] + PREFIX.len()..];
    let end = tail
        .iter()
        .position(|byte| *byte == b'\n')
        .ok_or("unterminated worker record")?;
    let wire: Wire = serde_json::from_slice(&tail[..end]).map_err(|_| "invalid worker record")?;
    if &wire.request != request {
        return Err("foreign worker record");
    }
    if !sanitized(&wire.result.details, 0) {
        return Err("unsafe worker report fields");
    }
    for flag in [
        "qualified",
        "runtime_publication_enabled",
        "physical_power_loss_tested",
    ] {
        if wire.result.details.get(flag).and_then(Value::as_bool) != Some(false) {
            return Err("worker qualification flag mismatch");
        }
    }
    schema::validate_result(request, &wire.result)?;
    Ok(wire.result)
}
fn invoke(request: &Request, run_deadline: Instant) -> Result<WorkerResult, &'static str> {
    validate_request(request)?;
    let deadline = run_deadline.min(Instant::now() + WORKER_TIME);
    let input = serde_json::to_vec(request).map_err(|_| "request encoding failed")?;
    let mut command =
        Command::new(std::env::current_exe().map_err(|_| "test executable unavailable")?);
    command
        .args(["--ignored", "--exact", WORKER_ENTRY, "--nocapture"])
        .env(OPT_IN, "1")
        .env(WORKER, "1");
    let output = capture(&mut command, Some(&input), deadline)?;
    if !output.success {
        return Err("worker process failed");
    }
    parse_wire(&output.stdout, request)
}

#[derive(Serialize)]
struct Report {
    schema: &'static str,
    run_id: String,
    action: &'static str,
    status: &'static str,
    build: Value,
    results: Vec<Value>,
    cleanup: Value,
    qualified: bool,
    runtime_publication_enabled: bool,
    physical_power_loss_tested: bool,
}
impl Report {
    fn new(run_id: String, cleanup_only: bool) -> Self {
        Self {
            schema: "writers-ide.registry-windows-conformance/1",
            run_id,
            action: if cleanup_only { "cleanup" } else { "execute" },
            status: "incomplete",
            build: json!({"available": false}),
            results: Vec::new(),
            cleanup: json!({"attempted": false}),
            qualified: false,
            runtime_publication_enabled: false,
            physical_power_loss_tested: false,
        }
    }
    fn bytes(&self) -> Result<Vec<u8>, &'static str> {
        let bytes = serde_json::to_vec_pretty(self).map_err(|_| "report encoding failed")?;
        if bytes.len() > MAX_REPORT {
            return Err("report byte bound");
        }
        Ok(bytes)
    }
}
fn checkpoint(file: &mut File, report: &Report) -> Result<(), &'static str> {
    use std::io::{Seek, SeekFrom};
    let bytes = report.bytes()?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| "report seek failed")?;
    file.write_all(&bytes).map_err(|_| "report write failed")?;
    file.set_len(bytes.len() as u64)
        .map_err(|_| "report truncate failed")?;
    file.flush().map_err(|_| "report flush failed")
}
fn drive(
    report: &mut Report,
    mut worker: impl FnMut(&Request) -> Result<WorkerResult, &'static str>,
    mut save: impl FnMut(&Report) -> Result<(), &'static str>,
) -> Result<(), &'static str> {
    let mut operations = if report.action == "cleanup" {
        vec![Operation::Cleanup]
    } else {
        let mut values = vec![Operation::Preflight];
        values.extend((0..CASES.len()).map(|index| Operation::Case { index: index as u8 }));
        values.push(Operation::Cleanup);
        values
    };
    for operation in operations.drain(..) {
        let request = Request {
            run_id: report.run_id.clone(),
            operation,
        };
        if operation == Operation::Cleanup {
            report.cleanup = json!({"attempted": true, "dispatch_attempted": true,
                "completion_confirmed": false, "partial_deletion_possible": true});
        }
        let result = match worker(&request).and_then(|result| {
            schema::validate_result(&request, &result)?;
            Ok(result)
        }) {
            Ok(result) => result,
            Err(error) => {
                report.status = "incomplete";
                if operation == Operation::Cleanup {
                    report.cleanup["transport_error"] = json!(error);
                    report.cleanup["worker_quiescence_confirmed"] =
                        json!(!error.contains("child unresolved"));
                }
                report
                    .results
                    .push(json!({"operation": operation, "transport_error": error}));
                save(report)?;
                return Err(error);
            }
        };
        let status = result.status;
        if operation == Operation::Cleanup {
            report.cleanup = json!({"attempted": true, "dispatch_attempted": true,
                            "completion_confirmed": status == WorkerStatus::Completed, "result": result});
        } else {
            report
                .results
                .push(json!({"operation": operation, "case_id": match operation {
                Operation::Case { index } => Some(CASES[usize::from(index)]), _ => None,
            }, "result": result}));
        }
        if status != WorkerStatus::Completed {
            report.status = match status {
                WorkerStatus::Refused => "refused",
                WorkerStatus::InvariantFailure => "invariant_failure",
                WorkerStatus::Completed => unreachable!(),
            };
            save(report)?;
            return Err("conformance stopped; retained evidence; no automatic cleanup");
        }
        if operation == Operation::Cleanup
            && report
                .cleanup
                .pointer("/result/details/result/cleanup_complete")
                .and_then(Value::as_bool)
                != Some(true)
        {
            report.status = "incomplete";
            save(report)?;
            return Err("cleanup completion unconfirmed");
        }
        save(report)?;
    }
    report.status = "completed_observations_not_qualified";
    save(report)
}

fn tool_output(command: &mut Command, deadline: Instant) -> Result<String, &'static str> {
    let output = capture(command, None, deadline.min(Instant::now() + WORKER_TIME))?;
    if !output.success {
        return Err("build identity command failed");
    }
    String::from_utf8(output.stdout).map_err(|_| "build identity encoding failed")
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct BuildRecord {
    schema: String,
    source_revision: String,
    source_dirty: bool,
    source_tree_sha256: String,
    rustc: std::collections::BTreeMap<String, String>,
    executable_sha256: String,
}
fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn compiler_field(key: &str, value: &str) -> bool {
    if value.is_empty() || value.len() > 128 {
        return false;
    }
    match key {
        "commit-hash" => lower_hex(value, 40),
        "host" => {
            value.contains("-windows-")
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
        }
        "release" | "LLVM version" => value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b".+_-".contains(&byte)),
        _ => false,
    }
}
fn parse_build_record(bytes: &[u8], executable_hash: &str) -> Result<BuildRecord, &'static str> {
    if bytes.len() > 16 * 1024 {
        return Err("build record bound");
    }
    let record: BuildRecord = serde_json::from_slice(bytes).map_err(|_| "invalid build record")?;
    let keys = ["release", "commit-hash", "host", "LLVM version"];
    if record.schema != "writers-ide.registry-windows-conformance-build/1"
        || !lower_hex(&record.source_revision, 40)
        || !lower_hex(&record.source_tree_sha256, 64)
        || !lower_hex(executable_hash, 64)
        || record.executable_sha256 != executable_hash
        || record.rustc.len() != keys.len()
        || !keys.iter().all(|key| {
            record
                .rustc
                .get(*key)
                .is_some_and(|value| compiler_field(key, value))
        })
        || !lower_hex(&record.rustc["commit-hash"], 40)
    {
        return Err("build record attribution mismatch");
    }
    Ok(record)
}
fn build_identity(deadline: Instant) -> Result<Value, &'static str> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let revision = tool_output(
        Command::new("git")
            .args(["--no-optional-locks", "--no-pager", "rev-parse", "HEAD"])
            .current_dir(dir),
        deadline,
    )?;
    let revision = revision.trim();
    if revision.len() != 40 || !revision.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("source revision unavailable");
    }
    let status = tool_output(
        Command::new("git")
            .args([
                "--no-optional-locks",
                "--no-pager",
                "status",
                "--porcelain",
                "--untracked-files=normal",
            ])
            .current_dir(dir),
        deadline,
    )?;
    let compiler = tool_output(Command::new("rustc").arg("-Vv"), deadline)?;
    let mut fields = serde_json::Map::new();
    for line in compiler.lines() {
        if let Some((key, value)) = line.split_once(": ") {
            if matches!(key, "release" | "commit-hash" | "host" | "LLVM version") {
                if !compiler_field(key, value) {
                    return Err("compiler identity bounds");
                }
                fields.insert(key.into(), Value::String(value.into()));
            }
        }
    }
    if !["release", "commit-hash", "host"]
        .iter()
        .all(|key| fields.contains_key(*key))
    {
        return Err("compiler identity unavailable");
    }
    let mut file =
        File::open(std::env::current_exe().map_err(|_| "executable identity unavailable")?)
            .map_err(|_| "executable identity unavailable")?;
    let mut digest = Sha256::new();
    let mut chunk = [0u8; 65536];
    loop {
        if Instant::now() >= deadline {
            return Err("build identity deadline");
        }
        let count = file
            .read(&mut chunk)
            .map_err(|_| "executable hash read failed")?;
        if count == 0 {
            break;
        }
        digest.update(&chunk[..count]);
    }
    let hash = format!("{:x}", digest.finalize());
    let path = dir
        .join("target/registry-windows-conformance")
        .join(format!("build-{hash}.json"));
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|_| "missing build record; run the build-only PowerShell helper")?
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "build record read failed")?;
    let record = parse_build_record(&bytes, &hash)?;
    Ok(json!({"available": true, "build_record": record,
        "invocation_observations": {"source_revision": revision,
            "source_dirty": !status.trim().is_empty(), "rustc": fields},
        "attribution": "recorded build invocation bound to this executable hash; not independent binary reproduction"}))
}

#[cfg(windows)]
#[test]
#[ignore = "explicit ordinary-user Windows conformance opt-in required; never qualification"]
fn run_fixture() {
    let opt_in = std::env::var(OPT_IN).ok();
    let action = std::env::var(ACTION).ok();
    let requested_id = std::env::var(RUN_ID).ok();
    let cleanup_only = admission(
        opt_in.as_deref(),
        action.as_deref(),
        requested_id.as_deref(),
    )
    .expect("conformance admission refused");
    let deadline = Instant::now() + RUN_TIME;
    let run_id = if cleanup_only {
        requested_id.unwrap()
    } else {
        new_id().expect("run ID allocation")
    };
    let mut report = Report::new(run_id.clone(), cleanup_only);
    let output = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/registry-windows-conformance");
    fs::create_dir_all(&output).expect("create conformance report directory");
    let report_id = new_id().expect("report ID allocation");
    let path = output.join(format!("{}-{run_id}-{report_id}.json", report.action));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .expect("exclusive conformance report");
    checkpoint(&mut file, &report).expect("initial report checkpoint");
    let result = (|| -> Result<(), &'static str> {
        if native::check_token().is_err() {
            report.status = "refused";
            report
                .results
                .push(json!({"preflight": "ordinary-user token check refused"}));
            checkpoint(&mut file, &report)?;
            return Err("ordinary-user token required");
        }
        report.build = build_identity(deadline)?;
        checkpoint(&mut file, &report)?;
        drive(
            &mut report,
            |request| invoke(request, deadline),
            |report| checkpoint(&mut file, report),
        )
    })();
    if let Err(reason) = result {
        eprintln!("Conformance report retained at {}", path.display());
        eprintln!(
            "Scratch locator (may not exist): {}",
            std::env::temp_dir()
                .join(format!("writers-ide-windows-conformance-{run_id}"))
                .display()
        );
        panic!("Windows conformance incomplete/refused: {reason}; no platform is qualified");
    }
    eprintln!(
        "Conformance observations retained at {}; no platform is qualified",
        path.display()
    );
}

#[cfg(windows)]
#[test]
#[ignore = "internal single-case worker; controller supplies bounded input"]
fn worker_entry() {
    assert_eq!(
        std::env::var(OPT_IN).as_deref(),
        Ok("1"),
        "worker opt-in required"
    );
    assert_eq!(
        std::env::var(WORKER).as_deref(),
        Ok("1"),
        "controller worker marker required"
    );
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((MAX_REQUEST + 1) as u64)
        .read_to_end(&mut bytes)
        .expect("worker request read");
    assert!(bytes.len() <= MAX_REQUEST, "worker request bound");
    let request: Request = serde_json::from_slice(&bytes).expect("worker request encoding");
    validate_request(&request).expect("worker request refused");
    let result = native::execute(&request);
    let wire = serde_json::to_string(&Wire { request, result }).expect("worker result encoding");
    assert!(
        wire.len() + PREFIX.len() < MAX_OUTPUT,
        "worker result bound"
    );
    println!("{PREFIX}{wire}");
}

#[cfg(test)]
mod tests {
    use super::*;
    const FAKE_MODE: &str = "WIDE_WINDOWS_CONFORMANCE_FAKE_MODE";
    const FAKE_ENTRY: &str =
        "plugin_registry::publication_probe::windows_conformance::tests::fake_worker";
    fn request(operation: Operation) -> Request {
        Request {
            run_id: "ab".repeat(16),
            operation,
        }
    }
    fn completed(request: &Request) -> WorkerResult {
        schema::example(request)
    }
    fn refused(request: &Request) -> WorkerResult {
        let mut value = completed(request);
        value.status = WorkerStatus::Refused;
        value.details["calls"] = json!([]);
        value.details["result"] = json!({"context": "elevated token", "native_code": null,
            "scratch_may_be_retained": true, "automatic_cleanup_attempted": false,
            "cleanup_complete": false, "operator_intervention_required": false});
        value
    }
    fn fake(mode: &str, duration: Duration) -> Result<Capture, &'static str> {
        capture(
            Command::new(std::env::current_exe().unwrap())
                .args(["--exact", FAKE_ENTRY, "--nocapture"])
                .env(FAKE_MODE, mode),
            None,
            Instant::now() + duration,
        )
    }
    #[test]
    fn fake_worker() {
        let Ok(mode) = std::env::var(FAKE_MODE) else {
            return;
        };
        match mode.as_str() {
            "timeout" => thread::sleep(Duration::from_secs(10)),
            "overflow" => {
                std::io::stderr()
                    .write_all(&vec![b'x'; MAX_OUTPUT + 1024])
                    .unwrap();
            }
            "valid" => println!(
                "{PREFIX}{}",
                serde_json::to_string(&Wire {
                    request: request(Operation::Preflight),
                    result: completed(&request(Operation::Preflight))
                })
                .unwrap()
            ),
            "failure" => panic!("fake worker failure"),
            _ => panic!("unknown fake mode"),
        }
    }
    #[test]
    fn exact_matrix_and_admission_are_bounded() {
        assert_eq!(CASES.len(), 20);
        assert_eq!(
            CASES
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len(),
            20
        );
        assert!(admission(None, None, None).is_err());
        assert_eq!(admission(Some("1"), None, None), Ok(false));
        assert!(admission(Some("1"), Some("execute"), Some(&"ab".repeat(16))).is_err());
        assert_eq!(
            admission(Some("1"), Some("cleanup"), Some(&"ab".repeat(16))),
            Ok(true)
        );
        for id in ["", "../root", "C:\\root", &"AB".repeat(16), &"a".repeat(33)] {
            assert!(!valid_id(id));
        }
        assert!(validate_request(&request(Operation::Case { index: 20 })).is_err());
        assert!(validate_request(&request(Operation::Case { index: 19 })).is_ok());
    }
    #[test]
    fn report_protocol_rejects_foreign_duplicate_unsafe_and_qualifying_results() {
        let req = request(Operation::Preflight);
        let wire = serde_json::to_string(&Wire {
            request: req.clone(),
            result: completed(&req),
        })
        .unwrap();
        let valid = format!("test banner ... {PREFIX}{wire}\nok\n");
        assert!(parse_wire(valid.as_bytes(), &req).is_ok());
        assert!(parse_wire(valid.as_bytes(), &request(Operation::Cleanup)).is_err());
        assert!(parse_wire(format!("{valid}{valid}").as_bytes(), &req).is_err());
        assert!(parse_wire(format!("{PREFIX}{wire}").as_bytes(), &req).is_err());
        for details in [
            json!({"path": "private"}),
            json!({"context": "C:\\private"}),
            json!({"context": "/private"}),
            json!({"context": "S-1-5-private"}),
        ] {
            assert!(!sanitized(&details, 0));
        }
        let mut result = completed(&req);
        result.details["qualified"] = json!(true);
        let wire = format!(
            "{PREFIX}{}\n",
            serde_json::to_string(&Wire {
                request: req.clone(),
                result
            })
            .unwrap()
        );
        assert!(parse_wire(wire.as_bytes(), &req).is_err());
        assert!(parse_wire(&vec![b'x'; MAX_OUTPUT + 1], &req).is_err());
        let mut report = Report::new(req.run_id, false);
        report.build = json!({"oversized": "x".repeat(MAX_REPORT)});
        assert!(report.bytes().is_err());
    }
    #[test]
    fn only_a_complete_matrix_schedules_cleanup() {
        for failure in [None, Some(0), Some(7), Some(20)] {
            let mut report = Report::new("ab".repeat(16), false);
            let mut scheduled = Vec::new();
            let result = drive(
                &mut report,
                |req| {
                    let ordinal = scheduled.len();
                    scheduled.push(req.operation);
                    if failure == Some(ordinal) {
                        return Ok(refused(req));
                    }
                    Ok(completed(req))
                },
                |_| Ok(()),
            );
            if failure.is_none() {
                assert!(result.is_ok());
                assert_eq!(scheduled.len(), 22);
                assert_eq!(scheduled.last(), Some(&Operation::Cleanup));
                assert_eq!(report.status, "completed_observations_not_qualified");
            } else {
                assert!(result.is_err());
                assert!(!scheduled.contains(&Operation::Cleanup));
                assert_eq!(report.status, "refused");
            }
        }
    }
    #[test]
    fn transport_checkpoint_and_cleanup_failures_never_schedule_more_work() {
        let mut report = Report::new("ab".repeat(16), false);
        let mut count = 0;
        assert!(drive(
            &mut report,
            |_| {
                count += 1;
                Err("fake timeout; child unresolved")
            },
            |_| Ok(())
        )
        .is_err());
        assert_eq!(count, 1);
        assert_eq!(report.cleanup["attempted"], false);
        let mut report = Report::new("ab".repeat(16), false);
        let mut count = 0;
        assert!(drive(
            &mut report,
            |request| {
                count += 1;
                Ok(completed(request))
            },
            |_| Err("fake checkpoint failure")
        )
        .is_err());
        assert_eq!(count, 1);
        let mut report = Report::new("ab".repeat(16), true);
        let mut operations = Vec::new();
        assert!(drive(
            &mut report,
            |req| {
                operations.push(req.operation);
                Ok(WorkerResult {
                    status: WorkerStatus::Completed,
                    details: json!({"result": {"cleanup_complete": false}}),
                })
            },
            |_| Ok(())
        )
        .is_err());
        assert_eq!(operations, [Operation::Cleanup]);
        assert_eq!(report.status, "incomplete");
    }
    #[test]
    fn build_provenance_is_required_and_bound_to_the_executable() {
        let hash = "cd".repeat(32);
        let record = json!({"schema": "writers-ide.registry-windows-conformance-build/1",
            "source_revision": "ab".repeat(20), "source_dirty": true,
            "source_tree_sha256": "ef".repeat(32), "executable_sha256": hash,
            "rustc": {"release": "1.90.0", "commit-hash": "ab".repeat(20),
                "host": "x86_64-pc-windows-msvc", "LLVM version": "20.1.8"}});
        let bytes = serde_json::to_vec(&record).unwrap();
        assert!(parse_build_record(&bytes, &hash).is_ok());
        assert!(parse_build_record(&bytes, &"ee".repeat(32)).is_err());
        assert!(parse_build_record(b"{}", &hash).is_err());
        assert!(parse_build_record(&vec![b' '; 16 * 1024 + 1], &hash).is_err());
        let mut private = record.clone();
        private["username"] = json!("private");
        assert!(parse_build_record(&serde_json::to_vec(&private).unwrap(), &hash).is_err());
        for (key, value) in [
            ("release", "C:\\Users\\private"),
            ("host", "x86_64-pc-windows-msvc/private"),
            ("commit-hash", "unknown"),
            ("LLVM version", "version 23"),
            ("host", "aarch64-apple-darwin"),
        ] {
            let mut invalid = record.clone();
            invalid["rustc"][key] = json!(value);
            assert!(parse_build_record(&serde_json::to_vec(&invalid).unwrap(), &hash).is_err());
        }
        let mut missing = record;
        missing["rustc"]
            .as_object_mut()
            .unwrap()
            .remove("commit-hash");
        assert!(parse_build_record(&serde_json::to_vec(&missing).unwrap(), &hash).is_err());
    }
    #[test]
    fn cleanup_transport_failure_records_dispatch_and_unknown_completion() {
        let mut report = Report::new("ab".repeat(16), true);
        assert!(drive(
            &mut report,
            |_| Err("worker incomplete; child unresolved; cleanup forbidden"),
            |_| Ok(())
        )
        .is_err());
        assert_eq!(report.cleanup["attempted"], true);
        assert_eq!(report.cleanup["dispatch_attempted"], true);
        assert_eq!(report.cleanup["completion_confirmed"], false);
        assert_eq!(report.cleanup["partial_deletion_possible"], true);
        assert_eq!(report.cleanup["worker_quiescence_confirmed"], false);
    }
    #[test]
    fn malformed_completion_cannot_authorize_following_cases_or_cleanup() {
        let mut report = Report::new("ab".repeat(16), false);
        let mut scheduled = Vec::new();
        assert!(drive(
            &mut report,
            |request| {
                scheduled.push(request.operation);
                let mut result = completed(request);
                result.details.as_object_mut().unwrap().remove("calls");
                Ok(result)
            },
            |_| Ok(())
        )
        .is_err());
        assert_eq!(scheduled, [Operation::Preflight]);
        assert_eq!(report.status, "incomplete");
        assert_eq!(report.cleanup["attempted"], false);
    }
    #[test]
    fn subprocess_draining_timeout_and_exit_checks_are_bounded() {
        let result = fake("valid", Duration::from_secs(5)).unwrap();
        assert!(result.success);
        assert!(parse_wire(&result.stdout, &request(Operation::Preflight)).is_ok());
        assert!(fake("overflow", Duration::from_secs(5)).is_err());
        let start = Instant::now();
        assert!(fake("timeout", Duration::from_millis(50)).is_err());
        assert!(start.elapsed() < Duration::from_secs(4));
        assert!(!fake("failure", Duration::from_secs(5)).unwrap().success);
        assert!(fake("valid", Duration::ZERO).is_err());
    }
}
