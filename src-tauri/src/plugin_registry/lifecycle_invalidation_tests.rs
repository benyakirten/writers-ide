use super::*;
use crate::plugin_registry::store::StoreRecovery;

fn observed(path: PathBuf, lifecycle: usize, validity: usize) -> RegistrySession {
    run(Registry::create(
        path,
        limits(),
        RegistryCapacity::with_observers(8, lifecycle, validity).unwrap(),
    ))
    .unwrap()
}

fn uncertain(store: &mut Store) -> Result<()> {
    let original = store.read_command_resource_settings()?;
    store.test_connection().execute_batch(
        "CREATE TEMP TABLE parent (id INTEGER PRIMARY KEY);
         CREATE TEMP TABLE child (parent INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED);
         CREATE TEMP TRIGGER fail_commit AFTER UPDATE OF command_resource_revision ON host_settings
         BEGIN INSERT INTO child VALUES (1); END;",
    )?;
    store.set_command_resource_settings(
        original.revision,
        CommandResourceSettings {
            max_caller_pending: original.settings.max_caller_pending + 1,
            ..original.settings
        },
    )?;
    Ok(())
}

fn failing_job_case(shutdown: bool, panic: bool) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let root = dir.path().join("owned");
    std::fs::create_dir(&root).unwrap();
    let path = root.join(path.file_name().unwrap());
    drop(Store::create(&path, limits()).unwrap());
    let lease = LocationLease::acquire(&root).unwrap();
    let session = run(Registry::open_owned(
        lease,
        path.clone(),
        limits(),
        RegistryCapacity::with_observers(8, 2, 2).unwrap(),
    ))
    .unwrap();
    let control = session.owner.control();
    let mut lifecycle = control.observe().unwrap();
    let mut validity = session.handle.observe_validity().unwrap();
    let (entered, entering) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let mut active = std::pin::pin!(session.handle.test_submit(move |store| {
        entered.send(()).unwrap();
        wait(&released);
        if panic {
            panic!("worker fixture panic");
        }
        uncertain(store)
    }));
    enqueue(active.as_mut());
    wait(&entering);
    let count = Arc::new(AtomicUsize::new(0));
    let write_count = count.clone();
    let mut write = std::pin::pin!(session.handle.test_submit(move |_| {
        write_count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }));
    enqueue(write.as_mut());
    let read_count = count.clone();
    let mut read = std::pin::pin!(session.handle.submit(true, move |_| {
        read_count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }));
    enqueue(read.as_mut());
    let mut maintenance =
        std::pin::pin!(control.maintain(control.snapshot().revision, forbidden(&count)));
    enqueue(maintenance.as_mut());
    // Maintenance invalidates the old association immediately, before its worker action.
    assert!(!session.handle.is_service_valid());
    if shutdown {
        control.shared.close();
    }
    release.send(()).unwrap();
    assert!(matches!(run(active), Err(RegistryError::OutcomeUnknown(_))));
    if panic {
        phase(&control, LifecyclePhase::Stopped);
    } else {
        let snapshot = control.snapshot();
        assert_eq!(
            snapshot.recovery_cause,
            Some(RecoveryCause::TransactionUncertain)
        );
        assert_eq!(
            snapshot.phase,
            if shutdown {
                LifecyclePhase::ShuttingDown
            } else {
                LifecyclePhase::RecoveryOnly(RecoveryKind::TransactionUncertain)
            }
        );
        assert!(matches!(
            run(session.handle.read_settings()),
            Err(RegistryError::Unavailable(_))
        ));
        if !shutdown {
            assert!(Store::open(&path, limits()).is_err());
            assert!(LocationLease::acquire(&root).is_err());
        }
    }
    assert!(matches!(run(write), Err(RegistryError::Unavailable(_))));
    assert!(matches!(run(read), Err(RegistryError::Unavailable(_))));
    assert!(matches!(
        run(maintenance),
        Err(RegistryError::Unavailable(_))
    ));
    assert_eq!(count.load(Ordering::SeqCst), 0);
    run(validity.invalidated());
    assert!(!validity.is_valid());
    let result = run(session.owner.shutdown());
    assert_eq!(result.is_err(), panic);
    let terminal = control.snapshot();
    assert_eq!(terminal.phase, LifecyclePhase::Stopped);
    assert_eq!(
        terminal.last_outcome,
        Some(MaintenanceOutcome::SuppressedBeforeExecution)
    );
    assert_eq!(
        terminal.stop_reason,
        Some(if panic {
            StopReason::WorkerPanicked
        } else {
            StopReason::Shutdown
        })
    );
    assert_eq!(
        terminal.recovery_cause,
        if panic {
            None
        } else {
            Some(RecoveryCause::TransactionUncertain)
        }
    );
    assert_eq!(run(lifecycle.next()), Some(terminal));
    assert_eq!(run(lifecycle.next()), None);
    // Readers and controls remain alive, but neither retains storage ownership.
    assert!(LocationLease::acquire(&root).is_ok());
    assert!(Store::open(&path, limits()).is_ok());
}

#[test]
fn invalidation_suppresses_queued_writes_and_pending_maintenance_retaining_ownership() {
    failing_job_case(false, false);
}
#[test]
fn invalidation_preserves_sticky_shutdown_and_separate_metadata() {
    failing_job_case(true, false);
}
#[test]
fn panic_suppresses_pending_maintenance_and_releases_connection_before_terminal_cleanup() {
    failing_job_case(false, true);
}

#[test]
fn handled_uncertainty_invalidates_before_triggering_reply_without_maintenance() {
    let dir = tempfile::tempdir().unwrap();
    let session = observed(dir.path().join("registry.sqlite"), 1, 1);
    let control = session.owner.control();
    let before = control.snapshot();
    let mut observer = session.handle.observe_validity().unwrap();
    assert!(matches!(
        run(session.handle.test_submit(uncertain)),
        Err(RegistryError::OutcomeUnknown(_))
    ));
    assert!(!session.handle.is_service_valid());
    let after = control.snapshot();
    assert_ne!(before.revision, after.revision);
    assert_eq!(
        after.phase,
        LifecyclePhase::RecoveryOnly(RecoveryKind::TransactionUncertain)
    );
    assert_eq!(
        after.recovery_cause,
        Some(RecoveryCause::TransactionUncertain)
    );
    assert!(control.ready_handle(&after.revision).is_err());
    run(observer.invalidated());
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn persisted_domain_failure_records_evidence_before_its_original_reply() {
    let dir = tempfile::tempdir().unwrap();
    let session = observed(dir.path().join("registry.sqlite"), 1, 1);
    let control = session.owner.control();
    assert!(matches!(run(session.handle.test_submit(|store| {
        store.test_connection().execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET permission_mode='invalid';")?;
        let result = store.read_settings();
        assert_eq!(store.recovery(), Some(StoreRecovery::DomainInvalid));
        result
    })), Err(RegistryError::RecoveryRequired(_))));
    assert!(!session.handle.is_service_valid());
    assert_eq!(
        control.snapshot().recovery_cause,
        Some(RecoveryCause::DomainInvalid)
    );
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn persisted_mutation_domain_failure_invalidates_even_after_confirmed_rollback() {
    let dir = tempfile::tempdir().unwrap();
    let session = observed(dir.path().join("registry.sqlite"), 1, 1);
    assert!(matches!(run(session.handle.test_submit(|store| {
        let original = store.read_command_resource_settings()?;
        store.test_connection().execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET command_resource_revision=-1;")?;
        store.set_command_resource_settings(original.revision, original.settings)
    })), Err(RegistryError::RecoveryRequired(_))));
    assert!(!session.handle.is_service_valid());
    assert_eq!(
        session.owner.control().snapshot().recovery_cause,
        Some(RecoveryCause::DomainInvalid)
    );
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn external_recovery_errors_invalid_requests_and_known_failures_are_nonfatal() {
    let dir = tempfile::tempdir().unwrap();
    let session = observed(dir.path().join("registry.sqlite"), 1, 1);
    let control = session.owner.control();
    let initial = control.snapshot();
    let occupied = dir.path().join("occupied-backup");
    std::fs::write(&occupied, b"invalid external backup").unwrap();
    assert!(matches!(
        run(session.handle.backup(occupied.clone())),
        Err(RegistryError::Storage(_))
    ));
    assert_eq!(std::fs::read(occupied).unwrap(), b"invalid external backup");
    assert!(session.handle.is_service_valid());
    assert_eq!(control.snapshot(), initial);
    let missing = dir.path().join("missing-backup");
    let destination = dir.path().join("restore");
    assert!(matches!(
        run(session.handle.test_submit(move |_| {
            crate::plugin_registry::recovery::prepare_restore(
                &missing,
                None,
                &destination,
                false,
                &limits(),
            )
        })),
        Err(RegistryError::RecoveryRequired(_))
    ));
    for error in [
        RegistryError::RecoveryRequired("request-only evidence".into()),
        RegistryError::OutcomeUnknown("lost completion is not transaction evidence".into()),
        RegistryError::Conflict("known".into()),
        RegistryError::InvalidInput("known".into()),
        RegistryError::LimitExceeded("known".into()),
        RegistryError::Storage(Box::new(std::io::Error::other("known"))),
    ] {
        assert!(run(session.handle.test_submit(move |_| Err::<(), _>(error))).is_err());
        assert!(session.handle.is_service_valid());
        assert_eq!(control.snapshot(), initial);
    }
    let original = run(session.handle.read_command_resource_settings()).unwrap();
    let invalid = CommandResourceSettings {
        max_caller_pending: 0,
        ..original.settings
    };
    assert!(matches!(
        run(session
            .handle
            .set_command_resource_settings(original.revision, invalid)),
        Err(RegistryError::InvalidInput(_))
    ));
    // A confirmed SQL failure followed by successful rollback is not transaction uncertainty.
    assert!(matches!(run(session.handle.test_submit(move |store| {
        store.test_connection().execute_batch("CREATE TEMP TRIGGER reject_update BEFORE UPDATE ON host_settings BEGIN SELECT RAISE(ABORT,'known failure'); END;")?;
        store.set_command_resource_settings(original.revision, CommandResourceSettings { max_caller_pending: 1, ..original.settings })
    })), Err(RegistryError::Storage(_))));
    assert!(session.handle.is_service_valid());
    assert_eq!(control.snapshot(), initial);
    assert_eq!(
        run(session.handle.read_command_resource_settings()).unwrap(),
        original
    );
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn observer_caps_drop_initial_latest_and_terminal_snapshots() {
    let dir = tempfile::tempdir().unwrap();
    let session = observed(dir.path().join("registry.sqlite"), 1, 1);
    let control = session.owner.control();
    let mut lifecycle = control.observe().unwrap();
    assert_eq!(lifecycle.current(), control.snapshot());
    assert_eq!(lifecycle.current().phase, LifecyclePhase::Ready);
    assert_eq!(lifecycle.current().revision.sequence, 1);
    let mut next = Box::pin(lifecycle.next());
    enqueue(next.as_mut());
    let validity = session.handle.observe_validity().unwrap();
    assert!(validity.is_valid());
    assert!(matches!(
        control.observe(),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert!(matches!(
        session.handle.observe_validity(),
        Err(RegistryError::LimitExceeded(_))
    ));
    drop(validity);
    let mut validity = session.handle.observe_validity().unwrap();
    control.shared.close();
    assert_eq!(run(next).unwrap().phase, LifecyclePhase::ShuttingDown);
    run(validity.invalidated());
    run(session.owner.shutdown()).unwrap();
    assert!(!session.handle.is_service_valid());
    assert!(matches!(
        session.handle.observe_validity(),
        Err(RegistryError::Unavailable(_))
    ));
    let terminal = run(lifecycle.next()).unwrap();
    assert_eq!(terminal.phase, LifecyclePhase::Stopped);
    assert_eq!(run(lifecycle.next()), None);
    drop(lifecycle);
    let mut terminal_reader = control.observe().unwrap();
    assert_eq!(terminal_reader.current(), terminal);
    assert_eq!(run(terminal_reader.next()), None);
}

#[test]
fn coalesced_replacement_never_resets_old_validity_and_old_registration_costs_no_slot() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = observed(path.clone(), 1, 2);
    let control = session.owner.control();
    let mut lifecycle = control.observe().unwrap();
    let mut old = session.handle.observe_validity().unwrap();
    let initial = lifecycle.current();
    run(control.test_replace_service(initial.revision.clone(), path, limits())).unwrap();
    // The slow lifecycle reader coalesces Maintenance -> Ready.
    let ready = run(lifecycle.next()).unwrap();
    assert_eq!(ready.phase, LifecyclePhase::Ready);
    assert_ne!(ready.revision, initial.revision);
    assert!(!session.handle.is_service_valid());
    run(old.invalidated());
    assert!(!old.is_valid());
    assert!(matches!(
        session.handle.observe_validity(),
        Err(RegistryError::Unavailable(_))
    ));
    let fresh = control.ready_handle(&ready.revision).unwrap();
    assert!(fresh.is_service_valid());
    let fresh_reader = fresh.observe_validity().unwrap();
    assert!(matches!(
        fresh.observe_validity(),
        Err(RegistryError::LimitExceeded(_))
    ));
    drop(old);
    let second = fresh.observe_validity().unwrap();
    drop(second);
    drop(fresh_reader);
    run(session.owner.shutdown()).unwrap();
    assert!(!fresh.is_service_valid());
}

#[test]
fn observation_requires_explicit_positive_host_budgets() {
    for (queue, lifecycle, validity) in [(0, 1, 1), (1, 0, 1), (1, 1, 0), (1, 0, 0)] {
        assert!(RegistryCapacity::with_observers(queue, lifecycle, validity).is_err());
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("must-not-create.sqlite");
        let invalid = RegistryCapacity {
            queue,
            lifecycle_readers: lifecycle,
            validity_readers: validity,
        };
        assert!(matches!(
            run(Registry::create(path.clone(), limits(), invalid)),
            Err(RegistryError::InvalidInput(_))
        ));
        assert!(!path.exists());
    }
    let dir = tempfile::tempdir().unwrap();
    let session = run(Registry::create(
        dir.path().join("registry.sqlite"),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(1, 4, 4).unwrap(),
    ))
    .unwrap();
    assert!(session.owner.control().observe().is_ok());
    assert!(session.handle.observe_validity().is_ok());
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn live_decode_missing_schema_and_backup_source_failures_mark_domain_evidence() {
    for case in 0..4 {
        let dir = tempfile::tempdir().unwrap();
        let session = observed(dir.path().join("registry.sqlite"), 1, 1);
        let backup = dir.path().join("backup.sqlite");
        let result = run(session.handle.test_submit(move |store| {
            match case {
                0 => {
                    store.test_connection().execute_batch("DELETE FROM host_settings;")?;
                    store.read_settings().map(|_| ())
                }
                1 => {
                    store.test_connection().execute_batch("CREATE TEMP TABLE host_settings AS SELECT * FROM main.host_settings; UPDATE host_settings SET permission_mode=x'ff';")?;
                    store.read_settings().map(|_| ())
                }
                2 => {
                    store.test_connection().execute_batch("DROP TABLE host_settings;")?;
                    store.read_settings().map(|_| ())
                }
                _ => {
                    store.test_connection().execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE host_settings SET command_max_caller_pending=0;")?;
                    store.backup(&backup)
                }
            }
        }));
        assert!(result.is_err());
        assert!(!session.handle.is_service_valid(), "case {case}");
        assert_eq!(
            session.owner.control().snapshot().recovery_cause,
            Some(RecoveryCause::DomainInvalid)
        );
        run(session.owner.shutdown()).unwrap();
    }
}

#[test]
fn reader_registration_racing_real_worker_invalidation_never_misses_terminal_validity() {
    for _ in 0..8 {
        let dir = tempfile::tempdir().unwrap();
        let session = observed(dir.path().join("registry.sqlite"), 1, 1);
        let control = session.owner.control();
        let (entered, entering) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let mut active = std::pin::pin!(session.handle.test_submit(move |store| {
            entered.send(()).unwrap();
            wait(&released);
            uncertain(store)
        }));
        enqueue(active.as_mut());
        wait(&entering);
        let guard = control.shared.state.lock().unwrap();
        let handle = session.handle.clone();
        let (registered, registration) = mpsc::channel();
        let reader_thread = thread::spawn(move || {
            registered.send(handle.observe_validity()).unwrap();
        });
        // Both registration and invalidation now contend for the admission mutex.
        release.send(()).unwrap();
        drop(guard);
        let registration = wait(&registration);
        assert!(matches!(run(active), Err(RegistryError::OutcomeUnknown(_))));
        match registration {
            Ok(mut reader) => {
                run(reader.invalidated());
                assert!(!reader.is_valid());
            }
            Err(RegistryError::Unavailable(_)) => {}
            _ => panic!("unexpected validity registration outcome"),
        }
        reader_thread.join().unwrap();
        assert!(!session.handle.is_service_valid());
        let mut lifecycle = control.observe().unwrap();
        assert_eq!(lifecycle.current(), control.snapshot());
        assert_eq!(
            lifecycle.current().recovery_cause,
            Some(RecoveryCause::TransactionUncertain)
        );
        run(session.owner.shutdown()).unwrap();
        assert_eq!(
            run(lifecycle.next()).unwrap().phase,
            LifecyclePhase::Stopped
        );
        assert_eq!(run(lifecycle.next()), None);
    }
}

#[test]
fn artifact_integrity_version_integer_overflow_invalidates_real_worker_before_reply() {
    use crate::plugin_integrity::{create_record, verify_package};
    let dir = tempfile::tempdir().unwrap();
    let package = dir.path().join("package");
    std::fs::create_dir(&package).unwrap();
    std::fs::write(
        package.join("manifest.toml"),
        r#"manifest_version = 1
[package]
name = "sample"
display_name = "Sample"
version = "1.0.0"
description = "Sample package"
[[components]]
id = "main"
display_name = "Main"
description = "Sample component"
kind = "frontend"
entry = "main.js"
runtime_profile = "writers-ide.frontend/1"
activation_scope = "project"
default_enabled = true
capabilities = []
permissions = []
"#,
    )
    .unwrap();
    std::fs::write(package.join("main.js"), "export default {};").unwrap();
    let record = create_record(&package, &limits().integrity).unwrap();
    let verified = verify_package(&package, &record, &limits().integrity).unwrap();
    let prepared = PreparedArtifact::from_verified(&verified, &package, &limits()).unwrap();
    let receipt = PublicationReceipt::for_test(&prepared);
    let session = observed(dir.path().join("registry.sqlite"), 1, 1);
    let facts = run(session.handle.accept_artifact(prepared, receipt)).unwrap();
    let control = session.owner.control();
    let mut validity = session.handle.observe_validity().unwrap();
    let result = run(session.handle.test_submit(move |store| {
        let connection = store.test_connection();
        let trigger: String = connection.query_row(
            "SELECT sql FROM sqlite_schema WHERE name='accepted_artifacts_immutable'", [], |r| r.get(0),
        )?;
        connection.execute_batch("DROP TRIGGER accepted_artifacts_immutable; UPDATE accepted_artifacts SET integrity_record_version=4294967296;")?;
        connection.execute_batch(&trigger)?;
        store.package_details(facts.package)
    }));
    let Err(RegistryError::Storage(error)) = result else {
        panic!("original decoder error was not preserved")
    };
    assert!(matches!(
        error.downcast_ref::<rusqlite::Error>(),
        Some(rusqlite::Error::IntegralValueOutOfRange(_, 4_294_967_296))
    ));
    assert_eq!(
        control.snapshot().recovery_cause,
        Some(RecoveryCause::DomainInvalid)
    );
    assert!(!session.handle.is_service_valid());
    run(validity.invalidated());
    run(session.owner.shutdown()).unwrap();
}
