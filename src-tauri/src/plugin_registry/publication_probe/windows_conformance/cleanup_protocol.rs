//! Pure cleanup policy. This file also supports `rustc --test` without Win32.
use std::collections::BTreeSet;

pub(super) const GUARD: &str = "admission.lock";

// The acquisition result is an owned RAII lease, not a controller's PID or
// remembered liveness bit. Failed acquisition must not enter filesystem work.
pub(super) fn with_run_lease<G, T, E>(
    acquire: impl FnOnce() -> Result<G, E>,
    work: impl FnOnce(G) -> Result<T, E>,
) -> Result<T, E> {
    let guard = acquire()?;
    work(guard)
}

pub(super) fn case_admission_allowed(cleanup_started: bool, cleanup: bool) -> bool {
    !cleanup_started || cleanup
}

pub(super) fn validate_snapshot(
    expected: &BTreeSet<String>,
    present: &BTreeSet<String>,
    cleanup_started: bool,
) -> Result<(), &'static str> {
    if expected.len() > 256 || present.len() > 256 {
        return Err("cleanup object bound");
    }
    if !present.is_subset(expected) {
        return Err("unexpected fixture entry");
    }
    for required in ["", "ownership.json", GUARD] {
        if !expected.contains(required) || !present.contains(required) {
            return Err("missing cleanup ownership evidence");
        }
    }
    if !cleanup_started && expected != present {
        return Err("missing recorded fixture object");
    }
    Ok(())
}

pub(super) trait RemovalIo {
    type Error;
    fn remove_owned(&mut self, object: &str) -> Result<(), Self::Error>;
    fn checkpoint_removed(&mut self, object: &str) -> Result<(), Self::Error>;
}

// A caller must not schedule another removal unless this returns success.
// A valid old receipt can recover the delete/checkpoint gap through the bounded
// missing-known-entry rule. A corrupt receipt is never inferred or repaired.
pub(super) fn remove_checkpointed<T: RemovalIo>(io: &mut T, object: &str) -> Result<(), T::Error> {
    io.remove_owned(object)?;
    io.checkpoint_removed(object)
}

pub(super) fn reserve_restoration(
    written: u64,
    objects: usize,
    payload_limit: u64,
    object_limit: usize,
    receipt_limit: usize,
) -> Result<(u64, usize), &'static str> {
    let written = written
        .checked_add(receipt_limit as u64)
        .ok_or("restoration payload bound")?;
    // A failed final removal may need both a fresh guard and a fresh receipt.
    let objects = objects.checked_add(2).ok_or("restoration object bound")?;
    if written > payload_limit || objects > object_limit {
        return Err("restoration resource bound");
    }
    Ok((written, objects))
}

pub(super) trait FinalizationIo {
    type Error;
    fn reserve_recovery(&mut self) -> Result<(), Self::Error>;
    fn remove_receipt(&mut self) -> Result<(), Self::Error>;
    fn remove_root_once(&mut self) -> Result<(), Self::Error>;
    fn verify_original_root(&mut self) -> Result<(), Self::Error>;
    fn restore_receipt_new(&mut self) -> Result<(), Self::Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum FinalizationError<E> {
    ReceiptRetained(E),
    RootRetained(E),
    InterventionRequired(E),
}

// No outside evidence or crash-atomicity claim: interruption after receipt
// deletion can leave a root without a receipt. Recovery here handles returned
// errors only, never an inferred identity or a second directory-removal attempt.
pub(super) fn finalize_root<T: FinalizationIo>(
    io: &mut T,
) -> Result<(), FinalizationError<T::Error>> {
    io.reserve_recovery()
        .map_err(FinalizationError::ReceiptRetained)?;
    io.remove_receipt()
        .map_err(FinalizationError::ReceiptRetained)?;
    match io.remove_root_once() {
        Ok(()) => Ok(()),
        Err(error) => {
            io.verify_original_root()
                .map_err(FinalizationError::InterventionRequired)?;
            io.restore_receipt_new()
                .map_err(FinalizationError::InterventionRequired)?;
            Err(FinalizationError::RootRetained(error))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(values: &[&str]) -> BTreeSet<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn only_explicit_cleanup_can_recover_missing_known_objects() {
        let expected = names(&["", "ownership.json", GUARD, "case00", "case00/control"]);
        let present = names(&["", "ownership.json", GUARD]);
        assert!(validate_snapshot(&expected, &present, true).is_ok());
        assert_eq!(
            validate_snapshot(&expected, &present, false),
            Err("missing recorded fixture object")
        );
    }

    #[test]
    fn unknown_objects_and_missing_final_evidence_always_refuse() {
        let expected = names(&["", "ownership.json", GUARD, "case00"]);
        for present in [
            names(&["", "ownership.json", GUARD, "unknown"]),
            names(&["", "ownership.json"]),
            names(&["ownership.json"]),
            names(&[""]),
        ] {
            assert!(validate_snapshot(&expected, &present, true).is_err());
        }
    }

    #[test]
    fn snapshot_recovery_is_bounded() {
        let mut expected = names(&["", "ownership.json", GUARD]);
        expected.extend((0..254).map(|index| format!("object{index}")));
        assert_eq!(
            validate_snapshot(&expected, &names(&["", "ownership.json", GUARD]), true),
            Err("cleanup object bound")
        );
    }

    #[test]
    fn unresolved_worker_blocks_later_separate_cleanup_without_mutation() {
        use std::{cell::Cell, rc::Rc};
        struct Lease(Rc<Cell<bool>>);
        impl Drop for Lease {
            fn drop(&mut self) {
                self.0.set(false);
            }
        }
        fn acquire(held: &Rc<Cell<bool>>) -> Result<Lease, &'static str> {
            if held.get() {
                return Err("sharing violation");
            }
            held.set(true);
            Ok(Lease(Rc::clone(held)))
        }
        let held = Rc::new(Cell::new(false));
        let unresolved_worker = with_run_lease(|| acquire(&held), Ok).unwrap();
        // The old controller is gone. A separate cleanup knows only the lease.
        let mutated = Cell::new(false);
        let cleanup = with_run_lease(
            || acquire(&held),
            |_guard| {
                mutated.set(true);
                Ok(())
            },
        );
        assert_eq!(cleanup, Err("sharing violation"));
        assert!(!mutated.get());
        drop(unresolved_worker);
        assert!(with_run_lease(|| acquire(&held), |_guard| Ok(())).is_ok());
    }

    #[test]
    fn missing_retired_guard_never_admits_another_worker() {
        let entered = std::cell::Cell::new(false);
        let result = with_run_lease(
            || Err::<(), _>("guard missing or delete-pending"),
            |_| {
                entered.set(true);
                Ok(())
            },
        );
        assert!(result.is_err());
        assert!(!entered.get());
        assert!(!case_admission_allowed(true, false));
        assert!(case_admission_allowed(true, true));
    }

    #[derive(Default)]
    struct FinalIo {
        events: Vec<&'static str>,
        fail_at: Option<&'static str>,
        root_failure: bool,
    }
    impl FinalIo {
        fn step(&mut self, stage: &'static str) -> Result<(), &'static str> {
            self.events.push(stage);
            if self.fail_at == Some(stage) {
                return Err(stage);
            }
            Ok(())
        }
    }
    impl FinalizationIo for FinalIo {
        type Error = &'static str;
        fn reserve_recovery(&mut self) -> Result<(), Self::Error> {
            self.step("reserve")
        }
        fn remove_receipt(&mut self) -> Result<(), Self::Error> {
            self.step("delete receipt")
        }
        fn remove_root_once(&mut self) -> Result<(), Self::Error> {
            self.step("remove root")?;
            if self.root_failure {
                return Err("root removal failed");
            }
            Ok(())
        }
        fn verify_original_root(&mut self) -> Result<(), Self::Error> {
            self.step("verify original root")
        }
        fn restore_receipt_new(&mut self) -> Result<(), Self::Error> {
            self.step("restore CREATE_NEW")
        }
    }

    #[test]
    fn normal_finalization_completes_without_restoration() {
        let mut io = FinalIo::default();
        assert_eq!(finalize_root(&mut io), Ok(()));
        assert_eq!(io.events, ["reserve", "delete receipt", "remove root"]);
    }

    #[test]
    fn failed_root_removal_restores_once_after_identity_check() {
        let mut io = FinalIo {
            root_failure: true,
            ..FinalIo::default()
        };
        assert_eq!(
            finalize_root(&mut io),
            Err(FinalizationError::RootRetained("root removal failed"))
        );
        assert_eq!(
            io.events,
            [
                "reserve",
                "delete receipt",
                "remove root",
                "verify original root",
                "restore CREATE_NEW"
            ]
        );
    }

    #[test]
    fn identity_or_restoration_failure_requires_intervention_without_retry() {
        for stage in ["verify original root", "restore CREATE_NEW"] {
            let mut io = FinalIo {
                root_failure: true,
                fail_at: Some(stage),
                ..FinalIo::default()
            };
            assert_eq!(
                finalize_root(&mut io),
                Err(FinalizationError::InterventionRequired(stage))
            );
            assert_eq!(
                io.events
                    .iter()
                    .filter(|event| **event == "remove root")
                    .count(),
                1
            );
            if stage == "verify original root" {
                assert!(!io.events.contains(&"restore CREATE_NEW"));
            }
        }
    }

    #[test]
    fn reservation_or_receipt_deletion_failure_cannot_remove_root() {
        for stage in ["reserve", "delete receipt"] {
            let mut io = FinalIo {
                fail_at: Some(stage),
                ..FinalIo::default()
            };
            assert_eq!(
                finalize_root(&mut io),
                Err(FinalizationError::ReceiptRetained(stage))
            );
            assert!(!io.events.contains(&"remove root"));
            assert!(!io.events.contains(&"restore CREATE_NEW"));
        }
    }

    #[test]
    fn restoration_reserves_both_payload_and_object_budgets() {
        assert_eq!(reserve_restoration(100, 2, 200, 4, 100), Ok((200, 4)));
        assert!(reserve_restoration(101, 2, 200, 4, 100).is_err());
        assert!(reserve_restoration(100, 3, 200, 4, 100).is_err());
        assert!(reserve_restoration(u64::MAX, 2, u64::MAX, 4, 1).is_err());
        assert!(reserve_restoration(0, usize::MAX, 200, usize::MAX, 1).is_err());
    }

    #[derive(Default)]
    struct FakeIo {
        events: Vec<String>,
        fail_delete: bool,
        fail_checkpoint: bool,
    }
    impl RemovalIo for FakeIo {
        type Error = &'static str;
        fn remove_owned(&mut self, object: &str) -> Result<(), Self::Error> {
            self.events.push(format!("delete {object}"));
            if self.fail_delete {
                return Err("delete failed");
            }
            Ok(())
        }
        fn checkpoint_removed(&mut self, object: &str) -> Result<(), Self::Error> {
            self.events.push(format!("checkpoint {object}"));
            if self.fail_checkpoint {
                return Err("checkpoint failed");
            }
            Ok(())
        }
    }

    #[test]
    fn every_removal_is_checkpointed_before_the_next() {
        let mut io = FakeIo::default();
        for object in ["first", "second"] {
            remove_checkpointed(&mut io, object).unwrap();
        }
        assert_eq!(
            io.events,
            [
                "delete first",
                "checkpoint first",
                "delete second",
                "checkpoint second"
            ]
        );
    }

    #[test]
    fn deletion_or_checkpoint_failure_stops_scheduling() {
        for (delete, checkpoint) in [(true, false), (false, true)] {
            let mut io = FakeIo {
                fail_delete: delete,
                fail_checkpoint: checkpoint,
                ..FakeIo::default()
            };
            let result = (|| {
                remove_checkpointed(&mut io, "first")?;
                remove_checkpointed(&mut io, "second")
            })();
            assert!(result.is_err());
            assert!(!io.events.iter().any(|event| event.contains("second")));
            if delete {
                assert_eq!(io.events, ["delete first"]);
            }
        }
    }
}
