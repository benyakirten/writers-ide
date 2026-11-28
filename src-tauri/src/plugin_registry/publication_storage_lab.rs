//! Opt-in native storage workload. The Linux controller owns privileged I/O.
//! Ordinary tests only use temporary directories and an in-memory mark transport.
use super::*;
use crate::plugin_integrity::IntegrityLimits;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};

const PREFIX: &str = "WIDE_REGISTRY_LAB ";
const MAX_EVENTS: usize = 96;
const OLD: u8 = 1;
const NEW: u8 = 2;

struct Trace<R, W> {
    input: R,
    output: W,
    count: usize,
}

impl<R: BufRead, W: Write> Trace<R, W> {
    fn event(&mut self, value: Value) -> io::Result<()> {
        if self.count >= MAX_EVENTS {
            return Err(io::Error::other("storage lab event limit"));
        }
        self.count += 1;
        writeln!(self.output, "{PREFIX}{value}")?;
        self.output.flush()?;
        // Read a bounded reply. The controller persists evidence and completes
        // a requested log mark before allowing the workload to continue.
        let mut reply = String::new();
        std::io::Read::take(&mut self.input, 16).read_line(&mut reply)?;
        if reply != "ok\n" {
            return Err(io::Error::other("storage lab controller refused event"));
        }
        Ok(())
    }

    fn mark(&mut self, label: &str) -> io::Result<()> {
        self.event(json!({"event": "mark", "label": label}))
    }
}

struct TracedNative<'a, R, W> {
    trace: &'a mut Trace<R, W>,
    phase: Phase,
    omit: Option<Phase>,
}

impl<R: BufRead, W: Write> Adapter for TracedNative<'_, R, W> {
    fn at(&mut self, phase: Phase) -> io::Result<()> {
        self.phase = phase;
        self.trace.mark(&format!("before-{phase:?}"))
    }

    fn sync_directory(&mut self, path: &Path) -> io::Result<()> {
        if self.omit != Some(self.phase) {
            NativeCandidate.sync_directory(path)?;
        }
        self.trace.mark(&format!("after-{:?}", self.phase))
    }

    fn write_record(&mut self, file: &mut File, record: &[u8]) -> io::Result<()> {
        file.write_all(record)?;
        self.trace.mark("after-SelectorWrite")
    }

    fn sync_file(&mut self, file: &File) -> io::Result<()> {
        if self.omit != Some(Phase::SelectorFileSync) {
            NativeCandidate.sync_file(file)?;
        }
        self.trace.mark("after-SelectorFileSync")
    }

    fn select(&mut self, temporary: &Path, active: &Path, replace: bool) -> io::Result<()> {
        NativeCandidate.select(temporary, active, replace)?;
        self.trace.mark("after-native-selection")
    }
}

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: IntegrityLimits {
            max_files: 64,
            max_file_bytes: 65536,
            max_total_bytes: 262144,
            max_path_bytes: 256,
            max_depth: 8,
        },
        max_rows: 512,
        max_snapshot_bytes: 1048576,
        max_text_bytes: 4096,
        max_location_bytes: 1024,
        max_review_items: 32,
    }
}

fn id(byte: u8) -> GenerationId {
    GenerationId::from_bytes([byte; 16])
}

fn prepare(lease: &LocationLease, byte: u8) -> SealedGeneration {
    PreparedGeneration::create_id(lease, id(byte), limits())
        .expect("prepare bounded lab generation")
        .seal()
        .expect("seal lab generation")
}

fn baseline<R: BufRead, W: Write>(mount: &Path, replace: bool, trace: &mut Trace<R, W>) {
    let stable = mount.join("lab");
    fs::create_dir(&stable).expect("exclusive lab stable parent");
    NativeCandidate
        .sync_directory(&stable)
        .expect("persist stable directory");
    NativeCandidate
        .sync_directory(mount)
        .expect("persist stable parent entry");
    if replace {
        let lease = LocationLease::acquire(&stable.join("registry")).unwrap();
        let initial = InitialRoot::claim_for_test(&lease).unwrap();
        let old = prepare(&lease, OLD);
        let published = publish_with(old, PublicationMode::First(initial), &mut NativeCandidate)
            .expect("durable old-generation baseline");
        drop(published);
    }
    trace.mark("baseline-ready").unwrap();
}

fn capture<R: BufRead, W: Write>(
    mount: &Path,
    replace: bool,
    omit: Option<Phase>,
    trace: &mut Trace<R, W>,
) {
    let stable = mount.join("lab");
    assert!(fs::symlink_metadata(&stable).unwrap().is_dir());
    let lease = LocationLease::acquire(&stable.join("registry")).unwrap();
    let mode = if replace {
        assert_eq!(selector::read(&lease).unwrap(), id(OLD));
        PublicationMode::Replace { expected: id(OLD) }
    } else {
        PublicationMode::First(InitialRoot::claim_for_test(&lease).unwrap())
    };
    trace.mark("before-preparation").unwrap();
    let sealed = prepare(&lease, NEW);
    trace.mark("after-sealing").unwrap();
    let mut adapter = TracedNative {
        trace,
        phase: Phase::GenerationDirectory,
        omit,
    };
    let published = publish_with(sealed, mode, &mut adapter).expect("native lab publication");
    assert_eq!(published.id(), id(NEW));
    // The controller synchronizes this event outside the tested filesystem
    // before it records the acknowledged-success cut. No live reopen follows.
    trace
        .event(json!({"event": "acknowledged", "generation": id(NEW).name()}))
        .unwrap();
    trace.mark("acknowledged-success").unwrap();
    drop(published);
}

fn validation(mount: &Path) -> Value {
    let stable = mount.join("lab");
    let stable_exists = fs::symlink_metadata(&stable).is_ok_and(|metadata| metadata.is_dir());
    let result = (|| -> Result<GenerationId> {
        if !fs::symlink_metadata(&stable)?.is_dir() {
            return Err(RegistryError::RecoveryRequired(
                "missing stable directory".into(),
            ));
        }
        let lease = LocationLease::acquire(&stable.join("registry"))?;
        let selected = selector::read(&lease)?;
        let database = selector::validate_generation(&lease, selected)?;
        let store = Store::open(&database, limits())?;
        drop(store);
        Ok(selected)
    })();
    let mut value = match result {
        Ok(selected) if selected == id(OLD) => json!({"event": "validated", "state": "old"}),
        Ok(selected) if selected == id(NEW) => json!({"event": "validated", "state": "new"}),
        Ok(_) => json!({"event": "validated", "state": "unexpected-generation"}),
        Err(error) => {
            json!({"event": "validated", "state": "recovery", "reason": format!("{error:?}").chars().take(512).collect::<String>()})
        }
    };
    value["stable_parent"] = json!(stable_exists);
    value
}

fn omission(value: &str) -> Option<Phase> {
    match value {
        "none" => None,
        "generation" => Some(Phase::GenerationDirectory),
        "parent" => Some(Phase::StableParent),
        "selector" => Some(Phase::SelectorFileSync),
        "final" => Some(Phase::FinalDirectorySync),
        _ => panic!("unknown storage lab omission"),
    }
}

#[test]
#[ignore = "Linux scratch-device experiment; only the explicit lab controller may invoke this"]
fn native_storage_lab_entry() {
    let platform = std::env::consts::OS;
    assert_eq!(platform, "linux", "Linux lab only");
    // SAFETY: geteuid has no preconditions or side effects.
    assert_ne!(
        unsafe { libc::geteuid() },
        0,
        "never run the Rust workload as root"
    );
    assert_eq!(
        std::env::var("WIDE_REGISTRY_LAB_OPT_IN").unwrap(),
        "scratch-only-v1"
    );
    let mount = PathBuf::from(std::env::var_os("WIDE_REGISTRY_LAB_MOUNT").unwrap());
    assert!(mount.is_absolute());
    assert_eq!(mount.canonicalize().unwrap(), mount);
    assert!(fs::symlink_metadata(&mount).unwrap().is_dir());
    let mode = std::env::var("WIDE_REGISTRY_LAB_MODE").unwrap();
    assert!(matches!(mode.as_str(), "first" | "replace"));
    let mut trace = Trace {
        input: BufReader::new(io::stdin()),
        output: io::stdout(),
        count: 0,
    };
    match std::env::var("WIDE_REGISTRY_LAB_ACTION").unwrap().as_str() {
        "baseline" => baseline(&mount, mode == "replace", &mut trace),
        "capture" => capture(
            &mount,
            mode == "replace",
            omission(&std::env::var("WIDE_REGISTRY_LAB_OMIT").unwrap()),
            &mut trace,
        ),
        "validate" => trace.event(validation(&mount)).unwrap(),
        _ => panic!("unknown storage lab action"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn trace() -> Trace<Cursor<Vec<u8>>, Vec<u8>> {
        Trace {
            input: Cursor::new(b"ok\n".repeat(MAX_EVENTS)),
            output: Vec::new(),
            count: 0,
        }
    }

    #[test]
    fn transport_refuses_missing_bad_and_oversized_replies() {
        for reply in ["", "no\n", "ok without newline", "ok\nextra"] {
            let mut trace = Trace {
                input: Cursor::new(reply.as_bytes()),
                output: Vec::new(),
                count: 0,
            };
            if reply == "ok\nextra" {
                assert!(trace.mark("first").is_ok());
                assert!(trace.mark("second").is_err());
            } else {
                assert!(trace.mark("refused").is_err());
            }
        }
        let mut trace = trace();
        trace.count = MAX_EVENTS;
        assert!(trace.mark("over-limit").is_err());
    }

    #[test]
    fn missing_metadata_is_recovery_without_fallback() {
        let temporary = tempfile::tempdir().unwrap();
        assert_eq!(validation(temporary.path())["state"], "recovery");
        assert!(!temporary.path().join("lab").exists());
    }

    #[test]
    fn real_native_sequence_emits_barriers_ack_and_bound_readiness() {
        for replace in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let mut trace = trace();
            baseline(temporary.path(), replace, &mut trace);
            assert_eq!(
                validation(temporary.path())["state"],
                if replace { "old" } else { "recovery" }
            );
            capture(temporary.path(), replace, None, &mut trace);
            assert_eq!(validation(temporary.path())["state"], "new");
            let events: Vec<Value> = String::from_utf8(trace.output)
                .unwrap()
                .lines()
                .map(|line| serde_json::from_str(line.strip_prefix(PREFIX).unwrap()).unwrap())
                .collect();
            let ack = events
                .iter()
                .position(|value| value["event"] == "acknowledged")
                .unwrap();
            let final_barrier = events
                .iter()
                .position(|value| value["label"] == "after-FinalDirectorySync")
                .unwrap();
            let ack_mark = events
                .iter()
                .position(|value| value["label"] == "acknowledged-success")
                .unwrap();
            assert!(final_barrier < ack && ack < ack_mark);
            for label in [
                "after-GenerationDirectory",
                "after-RootDirectory",
                "after-StableParent",
                "after-SelectorFileSync",
                "after-native-selection",
            ] {
                assert!(
                    events.iter().any(|value| value["label"] == label),
                    "{label}"
                );
            }
        }
    }
}
