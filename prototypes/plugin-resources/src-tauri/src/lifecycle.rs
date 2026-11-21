//! Fixed fixture choreography. No frontend command chooses a window to close,
//! grants an association, or supplies a native requester identity.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::plugin_resources::SnapshotUsage;
use crate::resources::Resources;

#[derive(Debug)]
pub(crate) enum Action {
    Wait,
    Close(&'static str),
    Probe(&'static str, &'static str),
    Complete(Value),
}

#[derive(Debug, PartialEq, Eq)]
enum Phase {
    Initial,
    ClosingPeer,
    CheckingMain,
    ClosingMain,
    CheckingDenied,
    Complete,
}

struct Run {
    phase: Phase,
    reports: BTreeMap<String, Value>,
    native_cases: Vec<Value>,
    usage: Vec<Value>,
}

pub(crate) struct Harness {
    pub resources: Arc<Resources>,
    recovery: bool,
    expected_bytes: u64,
    run: Mutex<Run>,
}

impl Harness {
    pub(crate) fn new(resources: Arc<Resources>, recovery: bool, expected_bytes: u64) -> Self {
        Self {
            resources,
            recovery,
            expected_bytes,
            run: Mutex::new(Run {
                phase: Phase::Initial,
                reports: BTreeMap::new(),
                native_cases: Vec::new(),
                usage: Vec::new(),
            }),
        }
    }

    pub(crate) fn report(&self, label: &str, report: Value) -> Result<Action, String> {
        let mode = if self.recovery { "recovery" } else { "normal" };
        if report["role"] != label || report["mode"] != mode {
            return Err("report role/mode does not match the native caller and run".into());
        }
        let stage = report["stage"].as_str().ok_or("missing report stage")?;
        let cases = report["cases"].as_array().ok_or("missing report cases")?;
        if report["ok"] != true
            || cases.is_empty()
            || cases
                .iter()
                .any(|case| case["ok"] != true || case["name"].as_str().is_none_or(str::is_empty))
        {
            return Err(format!("fixture check failed in {label}/{stage}: {report}"));
        }
        if !(label == "main" && stage == "initial")
            && (cases.len() != 1 || cases[0]["name"] != "fixed-stage resource access")
        {
            return Err("incomplete or substituted resource probe".into());
        }
        let mut run = self.run.lock().map_err(|_| "lifecycle state poisoned")?;
        let key = format!("{label}/{stage}");
        if run.reports.contains_key(&key) {
            return Err("duplicate fixture report".into());
        }
        match (&run.phase, label, stage) {
            (Phase::Initial, "main", "initial") => {
                let expected_cases = if self.recovery { 4 } else { 14 };
                if cases.len() != expected_cases {
                    return Err("incomplete main fixture report".into());
                }
            }
            (Phase::Initial, "peer" | "denied", "initial") if !self.recovery => {}
            (Phase::CheckingMain, "main", "after-peer-close") => {}
            (Phase::CheckingDenied, "denied", "after-last-close") => {}
            _ => return Err("unexpected fixture report stage or caller".into()),
        }
        let stage = stage.to_owned();
        run.reports.insert(key, report);
        if self.recovery {
            self.check_usage(&mut run, "recovery retains no package snapshot", 0, 0)?;
            run.phase = Phase::Complete;
            return Ok(Action::Complete(aggregate(&run, true)?));
        }
        if stage == "initial" {
            if ["main/initial", "peer/initial", "denied/initial"]
                .iter()
                .all(|key| run.reports.contains_key(*key))
            {
                self.check_usage(
                    &mut run,
                    "associated WebViews share one retained snapshot",
                    1,
                    self.expected_bytes,
                )?;
                run.phase = Phase::ClosingPeer;
                return Ok(Action::Close("peer"));
            }
            return Ok(Action::Wait);
        }
        if stage == "after-peer-close" {
            run.phase = Phase::ClosingMain;
            return Ok(Action::Close("main"));
        }
        run.phase = Phase::Complete;
        Ok(Action::Complete(aggregate(&run, false)?))
    }

    /// The caller first removes the pool association on a real Destroyed event.
    pub(crate) fn destroyed(&self, label: &str, removed: bool) -> Result<Action, String> {
        let mut run = self.run.lock().map_err(|_| "lifecycle state poisoned")?;
        if self.recovery || !removed {
            return Err("unexpected window closure or missing live association".into());
        }
        match (&run.phase, label) {
            (Phase::ClosingPeer, "peer") => {
                self.check_usage(
                    &mut run,
                    "first actual WebView closure preserves shared snapshot",
                    1,
                    self.expected_bytes,
                )?;
                run.phase = Phase::CheckingMain;
                Ok(Action::Probe("main", "after-peer-close"))
            }
            (Phase::ClosingMain, "main") => {
                self.check_usage(
                    &mut run,
                    "last associated WebView closure releases snapshot bytes",
                    0,
                    0,
                )?;
                run.phase = Phase::CheckingDenied;
                Ok(Action::Probe("denied", "after-last-close"))
            }
            _ => Err("window closed outside the fixed fixture sequence".into()),
        }
    }

    fn check_usage(
        &self,
        run: &mut Run,
        name: &str,
        snapshots: usize,
        retained_bytes: u64,
    ) -> Result<(), String> {
        let actual = self.resources.usage()?;
        if actual
            != (SnapshotUsage {
                snapshots,
                retained_bytes,
            })
        {
            return Err(format!("{name}: unexpected pool usage {actual:?}"));
        }
        run.native_cases.push(json!({"name": name, "ok": true}));
        run.usage.push(json!({
            "stage": name,
            "snapshots": actual.snapshots,
            "retainedBytes": actual.retained_bytes,
        }));
        Ok(())
    }
}

fn aggregate(run: &Run, recovery: bool) -> Result<Value, String> {
    let mut report = run
        .reports
        .get("main/initial")
        .ok_or("missing main report")?
        .clone();
    let mut cases = report["cases"]
        .as_array()
        .ok_or("missing main cases")?
        .clone();
    let mut probes = BTreeMap::new();
    for (key, probe) in &run.reports {
        if key != "main/initial" {
            for case in probe["cases"].as_array().ok_or("missing probe cases")? {
                cases.push(json!({"name": format!("{key}: {}", case["name"].as_str().ok_or("missing case name")?), "ok": true}));
            }
            probes.insert(key, probe["observations"].clone());
        }
    }
    cases.extend(run.native_cases.iter().cloned());
    report["cases"] = Value::Array(cases);
    report["stage"] = json!("complete");
    report["poolIntegration"] = json!({
        "complete": run.phase == Phase::Complete,
        "implementation": "production SnapshotPool",
        "recovery": recovery,
        "usage": run.usage,
        "probes": probes,
    });
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_integrity::{create_record, verify_package, IntegrityLimits};
    use crate::plugin_resources::SnapshotLimits;

    fn harness(recovery: bool) -> Harness {
        let resources = Arc::new(Resources::new(SnapshotLimits {
            max_snapshots: 1,
            max_retained_bytes: 3,
        }));
        if !recovery {
            let source = tempfile::tempdir().unwrap();
            std::fs::write(source.path().join("main.js"), b"abc").unwrap();
            let limits = IntegrityLimits::default();
            let record = create_record(source.path(), &limits).unwrap();
            for label in ["main", "peer"] {
                resources.register_view(label).unwrap();
                resources
                    .admit(
                        label,
                        verify_package(source.path(), &record, &limits).unwrap(),
                    )
                    .unwrap();
            }
        }
        Harness::new(resources, recovery, 3)
    }

    fn report(label: &str, stage: &str, recovery: bool) -> Value {
        let count = if label == "main" && stage == "initial" {
            if recovery {
                4
            } else {
                14
            }
        } else {
            1
        };
        json!({
            "ok": true, "mode": if recovery { "recovery" } else { "normal" },
            "role": label, "stage": stage,
            "cases": (0..count).map(|i| json!({
                            "name": if label == "main" && stage == "initial" { format!("case {i}") } else { "fixed-stage resource access".to_owned() },
                            "ok": true,
                        })).collect::<Vec<_>>(),
            "observations": {},
        })
    }

    #[test]
    fn fixed_sequence_requires_actual_closures_and_collects_every_probe() {
        let harness = harness(false);
        assert!(matches!(
            harness
                .report("peer", report("peer", "initial", false))
                .unwrap(),
            Action::Wait
        ));
        assert!(matches!(
            harness
                .report("denied", report("denied", "initial", false))
                .unwrap(),
            Action::Wait
        ));
        assert!(matches!(
            harness
                .report("main", report("main", "initial", false))
                .unwrap(),
            Action::Close("peer")
        ));
        assert!(harness
            .report("main", report("main", "after-peer-close", false))
            .is_err());
        assert!(harness.resources.close_view("peer").unwrap());
        assert!(matches!(
            harness.destroyed("peer", true).unwrap(),
            Action::Probe("main", "after-peer-close")
        ));
        assert!(matches!(
            harness
                .report("main", report("main", "after-peer-close", false))
                .unwrap(),
            Action::Close("main")
        ));
        assert!(harness.resources.close_view("main").unwrap());
        assert!(matches!(
            harness.destroyed("main", true).unwrap(),
            Action::Probe("denied", "after-last-close")
        ));
        let Action::Complete(report) = harness
            .report("denied", report("denied", "after-last-close", false))
            .unwrap()
        else {
            panic!("expected final aggregate")
        };
        assert_eq!(report["cases"].as_array().unwrap().len(), 21);
        assert_eq!(report["poolIntegration"]["complete"], true);
        assert_eq!(report["poolIntegration"]["usage"][2]["retainedBytes"], 0);
        assert!(harness.report("denied", report.clone()).is_err());
        crate::reporting::validate("main", &report).unwrap();
    }

    #[test]
    fn reports_cannot_impersonate_callers_skip_stages_or_repeat() {
        let harness = harness(false);
        assert!(harness
            .report("denied", report("peer", "initial", false))
            .is_err());
        assert!(harness
            .report("main", report("main", "after-peer-close", false))
            .is_err());
        assert!(harness
            .report("main", report("main", "initial", true))
            .is_err());
        assert!(harness
            .report(
                "main",
                json!({"ok":true,"role":"main","mode":"normal","stage":"initial","cases":[]})
            )
            .is_err());
        assert!(matches!(
            harness
                .report("peer", report("peer", "initial", false))
                .unwrap(),
            Action::Wait
        ));
        assert!(harness
            .report("peer", report("peer", "initial", false))
            .is_err());
        assert!(harness.destroyed("peer", false).is_err());
        assert!(harness.destroyed("main", true).is_err());
    }

    #[test]
    fn resource_probes_require_exactly_the_expected_case() {
        let harness = harness(false);
        for cases in [
            json!([]),
            json!([{"name": "unrelated passing check", "ok": true}]),
            json!([
                {"name": "fixed-stage resource access", "ok": true},
                {"name": "extra check", "ok": true}
            ]),
        ] {
            let mut invalid = report("peer", "initial", false);
            invalid["cases"] = cases;
            assert!(harness.report("peer", invalid).is_err());
        }
        assert!(matches!(
            harness
                .report("peer", report("peer", "initial", false))
                .unwrap(),
            Action::Wait
        ));
    }

    #[test]
    fn recovery_has_no_snapshot_and_rejects_probe_roles() {
        let harness = harness(true);
        assert!(harness
            .report("peer", report("peer", "initial", true))
            .is_err());
        let Action::Complete(report) = harness
            .report("main", report("main", "initial", true))
            .unwrap()
        else {
            panic!("expected recovery aggregate")
        };
        assert_eq!(report["cases"].as_array().unwrap().len(), 5);
        assert_eq!(report["poolIntegration"]["recovery"], true);
        assert_eq!(report["poolIntegration"]["usage"][0]["snapshots"], 0);
    }
}
