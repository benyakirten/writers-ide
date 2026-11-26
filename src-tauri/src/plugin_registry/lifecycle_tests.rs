use super::*;
use crate::plugin_integrity::IntegrityLimits;
use crate::plugin_registry::generation::PreparedGeneration;
use std::{
    future::Future,
    path::Path,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    task::{Context, Poll, Wake, Waker},
    time::{Duration, Instant},
};

const TIMEOUT: Duration = Duration::from_secs(10);

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: IntegrityLimits::default(),
        max_rows: 100,
        max_snapshot_bytes: 1024 * 1024,
        max_text_bytes: 65536,
        max_location_bytes: 4096,
        max_review_items: 100,
    }
}

fn wait<T>(receiver: &mpsc::Receiver<T>) -> T {
    receiver
        .recv_timeout(TIMEOUT)
        .expect("test barrier timed out")
}

fn enqueue<F: Future>(future: Pin<&mut F>) {
    assert!(future
        .poll(&mut Context::from_waker(Waker::noop()))
        .is_pending());
}

// Keep executor-dependent shutdown joins available, but bound even a lost wakeup.
fn run<F: Future>(future: F) -> F::Output {
    struct ThreadWake(thread::Thread);
    impl Wake for ThreadWake {
        fn wake(self: Arc<Self>) {
            self.0.unpark();
        }
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let _entered = runtime.enter();
    let waker = Waker::from(Arc::new(ThreadWake(thread::current())));
    let mut context = Context::from_waker(&waker);
    let mut future = std::pin::pin!(future);
    let deadline = Instant::now() + TIMEOUT;
    let result = loop {
        if let Poll::Ready(result) = future.as_mut().poll(&mut context) {
            break Some(result);
        }
        let Some(remaining) = deadline.checked_duration_since(Instant::now()) else {
            break None;
        };
        thread::park_timeout(remaining);
    };
    drop(_entered);
    // A timed-out test must not wait indefinitely for a blocking join at runtime drop.
    runtime.shutdown_background();
    result.expect("future did not complete within ten seconds")
}

fn phase(control: &RegistryControl, expected: LifecyclePhase) -> LifecycleSnapshot {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        let snapshot = control.snapshot();
        if snapshot.phase == expected {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "expected {expected:?}, got {snapshot:?}"
        );
        thread::yield_now();
    }
}

fn replacement(path: PathBuf) -> MaintenanceRequest {
    MaintenanceRequest::fixture(move |_| {
        MaintenanceResult::Ready(Store::open(&path, limits()).unwrap())
    })
}

fn forbidden(count: &Arc<AtomicUsize>) -> MaintenanceRequest {
    let count = count.clone();
    MaintenanceRequest::fixture(move |_| {
        count.fetch_add(1, Ordering::SeqCst);
        panic!("rejected maintenance callback executed");
    })
}

#[test]
fn simultaneous_admission_has_one_winner_and_abandoned_attempt_finishes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = run(Registry::create(path.clone(), limits(), 8)).unwrap();
    let control = session.owner.control();
    let before = control.snapshot();
    assert_eq!(before.phase, LifecyclePhase::Ready);
    assert_eq!(before.last_outcome, None);
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&released);
        Ok(())
    }));
    enqueue(active.as_mut());
    wait(&entered);

    let invocations = Arc::new(AtomicUsize::new(0));
    let (reported, reports) = mpsc::channel();
    let mut starts = Vec::new();
    let mut contenders = Vec::new();
    for _ in 0..2 {
        let (start, receive_start) = mpsc::channel();
        starts.push(start);
        let control = control.clone();
        let revision = before.revision.clone();
        let path = path.clone();
        let count = invocations.clone();
        let reported = reported.clone();
        contenders.push(thread::spawn(move || {
            wait(&receive_start);
            let request = MaintenanceRequest::fixture(move |_| {
                count.fetch_add(1, Ordering::SeqCst);
                MaintenanceResult::Ready(Store::open(&path, limits()).unwrap())
            });
            let mut attempt = Box::pin(control.maintain(revision, request));
            let admitted = match attempt
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop()))
            {
                Poll::Pending => true,
                Poll::Ready(Err(RegistryError::Conflict(_))) => false,
                other => panic!("unexpected admission result: {other:?}"),
            };
            drop(attempt);
            reported.send(admitted).unwrap();
        }));
    }
    for start in starts {
        start.send(()).unwrap();
    }
    assert_ne!(wait(&reports), wait(&reports));
    for contender in contenders {
        let (joined, receive_joined) = mpsc::channel();
        thread::spawn(move || {
            let _ = joined.send(contender.join());
        });
        wait(&receive_joined).unwrap();
    }
    let admitted = control.snapshot();
    assert_eq!(admitted.phase, LifecyclePhase::Maintenance);
    assert_ne!(admitted.revision, before.revision);
    assert_eq!(invocations.load(Ordering::SeqCst), 0);
    assert!(matches!(
        control.ready_handle(&admitted.revision),
        Err(RegistryError::Unavailable(_))
    ));
    let rejected = Arc::new(AtomicUsize::new(0));
    // A current revision still cannot queue a competing attempt.
    assert!(matches!(
        run(control.maintain(admitted.revision.clone(), forbidden(&rejected))),
        Err(RegistryError::Conflict(_))
    ));
    assert_eq!(control.snapshot(), admitted);
    release.send(()).unwrap();
    run(active).unwrap();
    let ready = phase(&control, LifecyclePhase::Ready);
    assert_eq!(ready.last_outcome, Some(MaintenanceOutcome::Ready));
    assert_ne!(ready.revision, admitted.revision);
    assert_eq!(invocations.load(Ordering::SeqCst), 1);
    assert!(matches!(
        run(control.maintain(before.revision.clone(), forbidden(&rejected))),
        Err(RegistryError::Conflict(_))
    ));
    assert_eq!(rejected.load(Ordering::SeqCst), 0);
    assert_eq!(control.snapshot(), ready);
    assert!(matches!(
        control.ready_handle(&before.revision),
        Err(RegistryError::Conflict(_))
    ));
    run(control
        .ready_handle(&ready.revision)
        .unwrap()
        .read_settings())
    .unwrap();
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn maintenance_drains_writes_rejects_reads_and_replaces_handles_on_same_thread() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = run(Registry::create(path.clone(), limits(), 8)).unwrap();
    let control = session.owner.control();
    let before = control.snapshot();
    let old_clone = session.handle.clone();
    let original = run(session.handle.read_settings()).unwrap();
    let changed = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..original
    };
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        started.send(thread::current().id()).unwrap();
        wait(&released);
        Ok(thread::current().id())
    }));
    enqueue(active.as_mut());
    let worker_thread = wait(&entered);
    let read_count = Arc::new(AtomicUsize::new(0));
    let count = read_count.clone();
    let mut read = Box::pin(session.handle.submit(true, move |_| {
        count.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }));
    enqueue(read.as_mut());
    let mut write = Box::pin(session.handle.set_host_settings(original, changed));
    enqueue(write.as_mut());
    drop(write);
    let mut following_write = Box::pin(session.handle.submit(false, move |store| {
        assert_eq!(store.read_settings()?, changed);
        Ok(())
    }));
    enqueue(following_write.as_mut());
    let (transitioned, transition) = mpsc::channel();
    let replacement_path = path.clone();
    let request = MaintenanceRequest::fixture(move |lease| {
        assert!(lease.is_none());
        // Reopening the identical destination also proves the old Store lock dropped.
        let mut store = Store::open(&replacement_path, limits()).unwrap();
        assert_eq!(store.read_settings().unwrap(), changed);
        transitioned.send(thread::current().id()).unwrap();
        MaintenanceResult::Ready(store)
    });
    let mut maintenance = Box::pin(control.maintain(before.revision.clone(), request));
    enqueue(maintenance.as_mut());
    let pending = control.snapshot();
    assert_eq!(pending.phase, LifecyclePhase::Maintenance);
    assert!(matches!(
        run(session.handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        run(session.handle.set_host_settings(original, changed)),
        Err(RegistryError::Unavailable(_))
    ));
    release.send(()).unwrap();
    assert_eq!(run(active).unwrap(), worker_thread);
    assert!(matches!(run(read), Err(RegistryError::Unavailable(_))));
    run(maintenance).unwrap();
    run(following_write).unwrap();
    assert_eq!(wait(&transition), worker_thread);
    assert_eq!(read_count.load(Ordering::SeqCst), 0);
    let ready = control.snapshot();
    assert_ne!(ready.revision, pending.revision);
    let fresh = control.ready_handle(&ready.revision).unwrap();
    assert_eq!(run(fresh.read_settings()).unwrap(), changed);
    assert_eq!(
        run(fresh.submit(true, |_| Ok(thread::current().id()))).unwrap(),
        worker_thread
    );
    for old in [&session.handle, &old_clone] {
        assert!(matches!(
            run(old.read_settings()),
            Err(RegistryError::Unavailable(_))
        ));
        assert!(matches!(
            run(old.set_host_settings(changed, original)),
            Err(RegistryError::Unavailable(_))
        ));
    }
    // A second replacement must not revive either earlier generation of handles.
    run(control.maintain(ready.revision.clone(), replacement(path))).unwrap();
    assert!(matches!(
        run(fresh.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        run(old_clone.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        control.ready_handle(&ready.revision),
        Err(RegistryError::Conflict(_))
    ));
    run(control
        .ready_handle(&control.snapshot().revision)
        .unwrap()
        .read_settings())
    .unwrap();
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn revisions_reject_foreign_and_prior_lifetimes_without_invoking_requests() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("first.sqlite");
    let first = run(Registry::create(path.clone(), limits(), 8)).unwrap();
    let second = run(Registry::create(
        dir.path().join("second.sqlite"),
        limits(),
        8,
    ))
    .unwrap();
    let previous = first.owner.control().snapshot().revision;
    let foreign = second.owner.control().snapshot().revision;
    assert_ne!(previous, foreign);
    let rejected = Arc::new(AtomicUsize::new(0));
    let control = first.owner.control();
    let before = control.snapshot();
    assert!(matches!(
        run(control.maintain(foreign.clone(), forbidden(&rejected))),
        Err(RegistryError::Conflict(_))
    ));
    assert!(matches!(
        control.ready_handle(&foreign),
        Err(RegistryError::Conflict(_))
    ));
    assert_eq!(control.snapshot(), before);
    run(first.owner.shutdown()).unwrap();
    let reopened = run(Registry::open(path, limits(), 8)).unwrap();
    let control = reopened.owner.control();
    let current = control.snapshot();
    assert_ne!(current.revision, previous);
    assert!(matches!(
        run(control.maintain(previous.clone(), forbidden(&rejected))),
        Err(RegistryError::Conflict(_))
    ));
    assert!(matches!(
        control.ready_handle(&previous),
        Err(RegistryError::Conflict(_))
    ));
    assert_eq!(control.snapshot(), current);
    assert_eq!(rejected.load(Ordering::SeqCst), 0);
    run(reopened.owner.shutdown()).unwrap();
    run(second.owner.shutdown()).unwrap();
}

#[derive(Clone, Copy, Debug)]
enum ShutdownStyle {
    Await,
    DropOwner,
    AbandonWaiter,
}

#[test]
fn shutdown_is_sticky_before_and_during_maintenance_for_success_and_failure() {
    for pending in [true, false] {
        for recovery in [false, true] {
            for style in [
                ShutdownStyle::Await,
                ShutdownStyle::DropOwner,
                ShutdownStyle::AbandonWaiter,
            ] {
                shutdown_case(pending, recovery, style);
            }
        }
    }
}

fn shutdown_case(pending: bool, recovery: bool, style: ShutdownStyle) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    std::fs::create_dir(&root).unwrap();
    let path = root.join("current.sqlite");
    drop(Store::create(&path, limits()).unwrap());
    let session = run(Registry::open_owned(lease, path.clone(), limits(), 8)).unwrap();
    let control = session.owner.control();
    let initial = control.snapshot();
    let (active_started, active_entered) = mpsc::channel();
    let (release_active, active_released) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        active_started.send(()).unwrap();
        wait(&active_released);
        Ok(())
    }));
    enqueue(active.as_mut());
    wait(&active_entered);
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let replacement_path = path.clone();
    let request = MaintenanceRequest::fixture(move |_| {
        started.send(()).unwrap();
        wait(&released);
        if recovery {
            MaintenanceResult::Recovery {
                error: RegistryError::RecoveryRequired("fixture failure".into()),
                kind: RecoveryKind::PublishedNotReady,
                retained: None,
            }
        } else {
            MaintenanceResult::Ready(Store::open(&replacement_path, limits()).unwrap())
        }
    });
    let mut maintenance = Box::pin(control.maintain(initial.revision, request));
    enqueue(maintenance.as_mut());
    if !pending {
        release_active.send(()).unwrap();
        wait(&entered);
    }
    let admitted = control.snapshot();
    let mut owner = session.owner;
    // Keep independent completion evidence even when the shutdown future owns the owner.
    let worker = owner.thread.take().unwrap();
    let (joined, receive_joined) = mpsc::channel();
    thread::spawn(move || {
        joined.send(worker.join()).unwrap();
    });
    let mut shutdown = None;
    match style {
        ShutdownStyle::DropOwner => drop(owner),
        ShutdownStyle::Await | ShutdownStyle::AbandonWaiter => {
            let mut future = Box::pin(owner.shutdown());
            enqueue(future.as_mut());
            if matches!(style, ShutdownStyle::Await) {
                shutdown = Some(future);
            }
        }
    }
    let closing = control.snapshot();
    assert!(matches!(
        LocationLease::acquire(&root),
        Err(RegistryError::Unavailable(_))
    ));
    assert_eq!(closing.phase, LifecyclePhase::ShuttingDown);
    assert_ne!(closing.revision, admitted.revision);
    assert!(matches!(
        control.ready_handle(&closing.revision),
        Err(RegistryError::Unavailable(_))
    ));
    let rejected = Arc::new(AtomicUsize::new(0));
    assert!(matches!(
        run(control.maintain(closing.revision, forbidden(&rejected))),
        Err(RegistryError::Unavailable(_))
    ));
    if pending {
        release_active.send(()).unwrap();
        wait(&entered);
        assert_eq!(control.snapshot().phase, LifecyclePhase::ShuttingDown);
    }
    release.send(()).unwrap();
    run(active).unwrap();
    let result = run(maintenance);
    if recovery {
        assert!(matches!(result, Err(RegistryError::RecoveryRequired(_))));
    } else {
        result.unwrap();
    }
    if let Some(shutdown) = shutdown {
        run(shutdown).unwrap();
    }
    wait(&receive_joined).unwrap();
    let stopped = control.snapshot();
    assert_eq!(
        stopped.phase,
        LifecyclePhase::Stopped,
        "{style:?}, pending={pending}"
    );
    assert_eq!(
        stopped.last_outcome,
        Some(if recovery {
            MaintenanceOutcome::Recovery(RecoveryKind::PublishedNotReady)
        } else {
            MaintenanceOutcome::Ready
        })
    );
    assert!(matches!(
        control.ready_handle(&stopped.revision),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        run(session.handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert_eq!(rejected.load(Ordering::SeqCst), 0);
    let lease = LocationLease::acquire(&root).unwrap();
    let reopened = run(Registry::open_owned(lease, path, limits(), 8)).unwrap();
    run(reopened.owner.shutdown()).unwrap();
}

#[test]
fn abandoned_failures_report_distinct_recovery_states_and_never_resume() {
    for kind in [
        RecoveryKind::Preparation,
        RecoveryKind::PublicationUnknown,
        RecoveryKind::PublishedNotReady,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let session = run(Registry::create(
            dir.path().join("registry.sqlite"),
            limits(),
            8,
        ))
        .unwrap();
        let control = session.owner.control();
        let before = control.snapshot();
        let (started, entered) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let request = MaintenanceRequest::fixture(move |_| {
            started.send(()).unwrap();
            wait(&released);
            MaintenanceResult::Recovery {
                error: RegistryError::RecoveryRequired("fixture failure".into()),
                kind,
                retained: None,
            }
        });
        let mut future = Box::pin(control.maintain(before.revision.clone(), request));
        enqueue(future.as_mut());
        wait(&entered);
        let admitted = control.snapshot();
        drop(future);
        release.send(()).unwrap();
        let failed = phase(&control, LifecyclePhase::RecoveryOnly(kind));
        assert_eq!(
            failed.last_outcome,
            Some(MaintenanceOutcome::Recovery(kind))
        );
        assert_ne!(failed.revision, before.revision);
        assert_ne!(failed.revision, admitted.revision);
        assert!(matches!(
            control.ready_handle(&failed.revision),
            Err(RegistryError::Unavailable(_))
        ));
        let rejected = Arc::new(AtomicUsize::new(0));
        assert!(matches!(
            run(control.maintain(before.revision, forbidden(&rejected))),
            Err(RegistryError::Conflict(_))
        ));
        assert!(matches!(
            run(control.maintain(failed.revision.clone(), forbidden(&rejected))),
            Err(RegistryError::Unavailable(_))
        ));
        assert_eq!(control.snapshot(), failed);
        assert_eq!(rejected.load(Ordering::SeqCst), 0);
        assert!(matches!(
            run(session.handle.read_settings()),
            Err(RegistryError::Unavailable(_))
        ));
        run(session.owner.shutdown()).unwrap();
    }
}

#[test]
fn recovery_retains_location_and_seal_failure_connection_until_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    std::fs::create_dir(&root).unwrap();
    let path = root.join("current.sqlite");
    drop(Store::create(&path, limits()).unwrap());
    let session = run(Registry::open_owned(lease, path.clone(), limits(), 8)).unwrap();
    let control = session.owner.control();
    let worker_thread = run(session.handle.submit(true, |_| Ok(thread::current().id()))).unwrap();
    let failure_path = root.join("candidate/registry.sqlite");
    let request = MaintenanceRequest::fixture(move |lease| {
        let lease = lease.expect("owned lifecycle lost its location lease");
        assert_eq!(thread::current().id(), worker_thread);
        assert!(matches!(
            LocationLease::acquire(lease.root()),
            Err(RegistryError::Unavailable(_))
        ));
        let generation =
            PreparedGeneration::create(lease, Path::new("candidate"), limits()).unwrap();
        // Corrupt required rows through a separate fixture connection. Sealing must
        // fail validation before close and return the still-owned connection.
        let connection = rusqlite::Connection::open(generation_path(lease.root())).unwrap();
        connection.execute("DELETE FROM host_settings", []).unwrap();
        drop(connection);
        let failure = generation.seal().unwrap_err();
        assert!(failure.has_connection());
        assert_eq!(failure.database_path(), generation_path(lease.root()));
        MaintenanceResult::Recovery {
            error: RegistryError::RecoveryRequired("checked seal failed".into()),
            kind: RecoveryKind::Preparation,
            retained: Some(failure),
        }
    });
    assert!(matches!(
        run(control.maintain(control.snapshot().revision, request)),
        Err(RegistryError::RecoveryRequired(_))
    ));
    let failed = control.snapshot();
    assert_eq!(
        failed.phase,
        LifecyclePhase::RecoveryOnly(RecoveryKind::Preparation)
    );
    assert_eq!(
        failed.last_outcome,
        Some(MaintenanceOutcome::Recovery(RecoveryKind::Preparation))
    );
    assert!(matches!(
        LocationLease::acquire(&root),
        Err(RegistryError::Unavailable(_))
    ));
    // The retained Store owns this lock. The old service's Store has already dropped.
    assert!(matches!(
        Store::open(&failure_path, limits()),
        Err(RegistryError::Unavailable(_))
    ));
    drop(Store::open(&path, limits()).unwrap());
    assert!(matches!(
        control.ready_handle(&failed.revision),
        Err(RegistryError::Unavailable(_))
    ));
    run(session.owner.shutdown()).unwrap();
    let _lease = LocationLease::acquire(&root).unwrap();
    // Repair only after cleanup. Successful open proves the retained Store released.
    let connection = rusqlite::Connection::open(&failure_path).unwrap();
    connection
        .execute("ATTACH DATABASE ?1 AS original", [path.to_str().unwrap()])
        .unwrap();
    connection
        .execute(
            "INSERT INTO host_settings SELECT * FROM original.host_settings",
            [],
        )
        .unwrap();
    drop(connection);
    drop(Store::open(&failure_path, limits()).unwrap());
}

fn generation_path(root: &Path) -> PathBuf {
    root.join("candidate/registry.sqlite")
}

fn reacquire_after_cleanup(root: &Path) -> LocationLease {
    let deadline = Instant::now() + TIMEOUT;
    loop {
        match LocationLease::acquire(root) {
            Ok(lease) => return lease,
            Err(RegistryError::Unavailable(_)) => {
                assert!(
                    Instant::now() < deadline,
                    "worker did not release location ownership"
                );
                thread::yield_now();
            }
            Err(error) => panic!("unexpected location acquisition failure: {error:?}"),
        }
    }
}

#[test]
fn owned_startup_cancellation_retains_location_until_worker_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    std::fs::create_dir(&root).unwrap();
    let path = root.join("current.sqlite");
    drop(Store::create(&path, limits()).unwrap());
    let guard = Arc::downgrade(&lease.guard());
    let (started, entered) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let probe = ProbeStartup {
        lease: lease.guard(),
        after_open: Some((started, released)),
    };
    let mut startup = Box::pin(Registry::start(
        path.clone(),
        limits(),
        8,
        false,
        Some(lease.clone()),
        Some(probe),
    ));
    enqueue(startup.as_mut());
    wait(&entered);
    drop(startup);
    drop(lease);
    assert!(guard.upgrade().is_some());
    assert!(matches!(
        LocationLease::acquire(&root),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        Store::open(&path, limits()),
        Err(RegistryError::Unavailable(_))
    ));
    release.send(()).unwrap();
    let lease = reacquire_after_cleanup(&root);
    assert!(guard.upgrade().is_none());
    let session = run(Registry::open_owned(lease, path, limits(), 8)).unwrap();
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn open_owned_missing_or_empty_root_never_initializes_storage() {
    for existing_root in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("registry");
        let lease = LocationLease::acquire(&root).unwrap();
        if existing_root {
            std::fs::create_dir(&root).unwrap();
        }
        let path = root.join("current.sqlite");
        assert!(run(Registry::open_owned(lease, path.clone(), limits(), 8)).is_err());
        let _lease = reacquire_after_cleanup(&root);
        assert!(!path.exists());
        assert_eq!(root.exists(), existing_root);
        if existing_root {
            assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
        }
    }
}

#[test]
fn open_owned_rejects_existing_database_outside_its_root() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    std::fs::create_dir(&root).unwrap();
    let outside = dir.path().join("outside.sqlite");
    let mut store = Store::create(&outside, limits()).unwrap();
    let original = store.read_settings().unwrap();
    drop(store);
    let before = std::fs::read(&outside).unwrap();
    assert!(matches!(
        run(Registry::open_owned(lease, outside.clone(), limits(), 8)),
        Err(RegistryError::InvalidInput(_))
    ));
    let _lease = reacquire_after_cleanup(&root);
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0);
    assert_eq!(std::fs::read(&outside).unwrap(), before);
    assert_eq!(
        Store::open(&outside, limits())
            .unwrap()
            .read_settings()
            .unwrap(),
        original
    );
}

#[test]
fn retained_handles_and_control_do_not_retain_location_after_owned_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    let guard = Arc::downgrade(&lease.guard());
    std::fs::create_dir(&root).unwrap();
    let path = root.join("current.sqlite");
    drop(Store::create(&path, limits()).unwrap());
    let session = run(Registry::open_owned(lease, path.clone(), limits(), 8)).unwrap();
    let control = session.owner.control();
    let retained_handle = session.handle.clone();
    let ready = control.snapshot();
    let acquired_handle = control.ready_handle(&ready.revision).unwrap();
    assert!(matches!(
        LocationLease::acquire(&root),
        Err(RegistryError::Unavailable(_))
    ));
    run(session.owner.shutdown()).unwrap();
    assert!(guard.upgrade().is_none());
    // These references stay alive while a new owner acquires the same location.
    let lease = LocationLease::acquire(&root).unwrap();
    assert_eq!(control.snapshot().phase, LifecyclePhase::Stopped);
    assert!(matches!(
        control.ready_handle(&control.snapshot().revision),
        Err(RegistryError::Unavailable(_))
    ));
    for handle in [&session.handle, &retained_handle, &acquired_handle] {
        assert!(matches!(
            run(handle.read_settings()),
            Err(RegistryError::Unavailable(_))
        ));
    }
    let next = run(Registry::open_owned(lease, path, limits(), 8)).unwrap();
    run(next.handle.read_settings()).unwrap();
    assert!(matches!(
        run(retained_handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert_eq!(control.snapshot().phase, LifecyclePhase::Stopped);
    run(next.owner.shutdown()).unwrap();
}
