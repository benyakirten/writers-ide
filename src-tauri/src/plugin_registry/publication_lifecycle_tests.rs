use super::*;
use crate::plugin_integrity::IntegrityLimits;
#[cfg(any(target_os = "linux", target_os = "macos"))]
use crate::plugin_registry::selector::GenerationId;
use crate::plugin_registry::{
    generation::{publisher, PreparedGeneration},
    selector,
};
use publisher::{InitialRoot, PublicationMode, PublicationStage};
#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::fs;
use std::{
    future::Future,
    path::Path,
    sync::mpsc,
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

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn enqueue<F: Future>(future: std::pin::Pin<&mut F>) {
    assert!(future
        .poll(&mut Context::from_waker(Waker::noop()))
        .is_pending());
}

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
    let entered = runtime.enter();
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
    drop(entered);
    runtime.shutdown_background();
    result.expect("future did not complete within ten seconds")
}

// Baseline metadata is fixture data, not an enabled production initialization path.
#[cfg(any(target_os = "linux", target_os = "macos"))]
fn baseline(root: &Path) -> (LocationLease, PathBuf, GenerationId) {
    let lease = LocationLease::acquire(root).unwrap();
    fs::create_dir(root).unwrap();
    let id = GenerationId::from_bytes([1; 16]);
    fs::create_dir(id.directory(&lease)).unwrap();
    let database = id.database_path(&lease);
    drop(Store::create(&database, limits()).unwrap());
    fs::write(root.join(selector::ACTIVE), selector::encode(id)).unwrap();
    (lease, database, id)
}

fn assert_location_locked(root: &Path) {
    assert!(matches!(
        LocationLease::acquire(root),
        Err(RegistryError::Unavailable(_))
    ));
}

fn assert_database_locked(database: &Path) {
    assert!(matches!(
        Store::open(database, limits()),
        Err(RegistryError::Unavailable(_))
    ));
}

fn assert_closed(handle: &RegistryHandle) {
    assert!(matches!(
        run(handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
}

#[test]
fn production_refusal_retains_consumed_failure_until_owned_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let first_root = dir.path().join("registry");
    let first_lease = LocationLease::acquire(&first_root).unwrap();
    let initial = InitialRoot::claim_for_test(&first_lease).unwrap();
    let session = run(Registry::open_owned(
        first_lease,
        {
            // open_owned requires an existing database beneath its own leased root.
            let database = first_root.join("baseline.sqlite");
            drop(Store::create(&database, limits()).unwrap());
            database
        },
        limits(),
        8,
    ))
    .unwrap();
    let control = session.owner.control();
    let old_clone = session.handle.clone();
    let worker = run(session.handle.submit(true, |_| Ok(thread::current().id()))).unwrap();
    let (sent, received) = mpsc::channel();
    let request = MaintenanceRequest::fixture(move |lease| {
        let lease = lease.unwrap();
        assert_eq!(thread::current().id(), worker);
        let sealed = PreparedGeneration::create(lease, limits())
            .unwrap()
            .seal()
            .unwrap();
        let database = sealed.database_path().to_path_buf();
        let failure = publisher::publish(sealed, PublicationMode::First(initial)).unwrap_err();
        assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
        assert!(matches!(failure.error(), RegistryError::Unavailable(_)));
        assert_eq!(failure.database_path(), database);
        sent.send(database).unwrap();
        MaintenanceResult::Recovery {
            error: RegistryError::Unavailable("production publication is not qualified".into()),
            kind: RecoveryKind::Preparation,
            retained: Some(failure.into()),
        }
    });
    assert!(matches!(
        run(control.maintain(control.snapshot().revision, request)),
        Err(RegistryError::Unavailable(_))
    ));
    let database = wait(&received);
    let failed = control.snapshot();
    assert_eq!(
        failed.phase,
        LifecyclePhase::RecoveryOnly(RecoveryKind::Preparation)
    );
    assert_eq!(
        failed.last_outcome,
        Some(MaintenanceOutcome::Recovery(RecoveryKind::Preparation))
    );
    assert!(!first_root.join(selector::ACTIVE).exists());
    assert_location_locked(&first_root);
    assert_database_locked(&database);
    assert_closed(&session.handle);
    assert_closed(&old_clone);
    assert!(matches!(
        control.ready_handle(&failed.revision),
        Err(RegistryError::Unavailable(_))
    ));
    run(session.owner.shutdown()).unwrap();
    let _lease = LocationLease::acquire(&first_root).unwrap();
    drop(Store::open(&database, limits()).unwrap());
    assert_eq!(control.snapshot().phase, LifecyclePhase::Stopped);
    assert_closed(&old_clone);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn native_replacements_keep_one_worker_and_permanently_close_prior_handles() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let (lease, old_database, mut expected) = baseline(&root);
    let session = run(Registry::open_owned(
        lease,
        old_database.clone(),
        limits(),
        8,
    ))
    .unwrap();
    let control = session.owner.control();
    let worker = run(session.handle.submit(true, |_| Ok(thread::current().id()))).unwrap();
    assert_ne!(worker, thread::current().id());
    let mut prior_handles = vec![session.handle.clone()];
    for _ in 0..2 {
        let before = control.snapshot();
        let (sent, received) = mpsc::channel();
        let request = MaintenanceRequest::fixture(move |lease| {
            let lease = lease.unwrap();
            assert_eq!(thread::current().id(), worker);
            let sealed = PreparedGeneration::create(lease, limits())
                .unwrap()
                .seal()
                .unwrap();
            let database = sealed.database_path().to_path_buf();
            let published = publisher::publish_candidate_for_test(
                sealed,
                PublicationMode::Replace { expected },
            )
            .unwrap();
            let selected = published.id();
            assert_eq!(selector::read(lease).unwrap(), selected);
            let ready = published.open(limits()).unwrap();
            let store = ready.into_store(lease).unwrap();
            assert_eq!(thread::current().id(), worker);
            sent.send((selected, database)).unwrap();
            MaintenanceResult::Ready(store)
        });
        run(control.maintain(before.revision.clone(), request)).unwrap();
        let (selected, database) = wait(&received);
        assert_ne!(selected, expected);
        expected = selected;
        let after = control.snapshot();
        assert_eq!(after.phase, LifecyclePhase::Ready);
        assert_eq!(after.last_outcome, Some(MaintenanceOutcome::Ready));
        assert_ne!(after.revision, before.revision);
        assert!(matches!(
            control.ready_handle(&before.revision),
            Err(RegistryError::Conflict(_))
        ));
        let fresh = control.ready_handle(&after.revision).unwrap();
        run(fresh.read_settings()).unwrap();
        assert_eq!(
            run(fresh.submit(true, |_| Ok(thread::current().id()))).unwrap(),
            worker
        );
        for handle in &prior_handles {
            assert_closed(handle);
        }
        assert_location_locked(&root);
        assert_database_locked(&database);
        prior_handles.push(fresh);
    }
    drop(Store::open(&old_database, limits()).unwrap());
    run(session.owner.shutdown()).unwrap();
    let lease = LocationLease::acquire(&root).unwrap();
    assert_eq!(selector::read(&lease).unwrap(), expected);
    drop(Store::open(&expected.database_path(&lease), limits()).unwrap());
    for handle in &prior_handles {
        assert_closed(handle);
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn confirmed_native_publication_reopen_failure_preserves_selection_until_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let (lease, old_database, expected) = baseline(&root);
    let session = run(Registry::open_owned(
        lease,
        old_database.clone(),
        limits(),
        8,
    ))
    .unwrap();
    let control = session.owner.control();
    let retained_handle = session.handle.clone();
    let worker = run(session.handle.submit(true, |_| Ok(thread::current().id()))).unwrap();
    let (sent, received) = mpsc::channel();
    let request = MaintenanceRequest::fixture(move |lease| {
        let lease = lease.unwrap();
        assert_eq!(thread::current().id(), worker);
        let sealed = PreparedGeneration::create(lease, limits())
            .unwrap()
            .seal()
            .unwrap();
        let database = sealed.database_path().to_path_buf();
        let published =
            publisher::publish_candidate_for_test(sealed, PublicationMode::Replace { expected })
                .unwrap();
        let selected = published.id();
        // Model corruption after confirmed publication, not a publisher fault.
        let connection = rusqlite::Connection::open(&database).unwrap();
        connection.execute("DELETE FROM host_settings", []).unwrap();
        connection.close().unwrap();
        let failure = published.open(limits()).unwrap_err();
        assert!(matches!(
            failure.error(),
            RegistryError::RecoveryRequired(_)
        ));
        assert_eq!(failure.database_path(), database);
        assert_eq!(selector::read(lease).unwrap(), selected);
        assert_eq!(thread::current().id(), worker);
        sent.send((selected, database)).unwrap();
        MaintenanceResult::Recovery {
            error: RegistryError::RecoveryRequired("published database failed readiness".into()),
            kind: RecoveryKind::PublishedNotReady,
            retained: Some(failure.into()),
        }
    });
    assert!(matches!(
        run(control.maintain(control.snapshot().revision, request)),
        Err(RegistryError::RecoveryRequired(_))
    ));
    let (selected, database) = wait(&received);
    let failed = control.snapshot();
    assert_eq!(
        failed.phase,
        LifecyclePhase::RecoveryOnly(RecoveryKind::PublishedNotReady)
    );
    assert_eq!(
        failed.last_outcome,
        Some(MaintenanceOutcome::Recovery(
            RecoveryKind::PublishedNotReady
        ))
    );
    assert_eq!(
        fs::read(root.join(selector::ACTIVE)).unwrap(),
        selector::encode(selected)
    );
    assert_location_locked(&root);
    assert!(matches!(
        control.ready_handle(&failed.revision),
        Err(RegistryError::Unavailable(_))
    ));
    assert_closed(&retained_handle);
    drop(Store::open(&old_database, limits()).unwrap());
    run(session.owner.shutdown()).unwrap();
    let lease = LocationLease::acquire(&root).unwrap();
    assert_eq!(selector::read(&lease).unwrap(), selected);
    // Repair fixture corruption only after cleanup; the failed open owns no live Store.
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute(
            "ATTACH DATABASE ?1 AS original",
            [old_database.to_str().unwrap()],
        )
        .unwrap();
    connection
        .execute(
            "INSERT INTO host_settings SELECT * FROM original.host_settings",
            [],
        )
        .unwrap();
    connection.close().unwrap();
    drop(Store::open(&database, limits()).unwrap());
    assert_closed(&retained_handle);
    assert_eq!(control.snapshot().phase, LifecyclePhase::Stopped);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn shutdown_during_native_publication_finishes_switch_without_fresh_handles() {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let (lease, old_database, expected) = baseline(&root);
    let session = run(Registry::open_owned(
        lease,
        old_database.clone(),
        limits(),
        8,
    ))
    .unwrap();
    let control = session.owner.control();
    let retained_handle = session.handle.clone();
    let worker = run(session.handle.submit(true, |_| Ok(thread::current().id()))).unwrap();
    let (entered, entry) = mpsc::channel();
    let (release, released) = mpsc::channel();
    let request = MaintenanceRequest::fixture(move |lease| {
        let lease = lease.unwrap();
        assert_eq!(thread::current().id(), worker);
        let sealed = PreparedGeneration::create(lease, limits())
            .unwrap()
            .seal()
            .unwrap();
        entered.send(sealed.database_path().to_path_buf()).unwrap();
        wait(&released);
        let published =
            publisher::publish_candidate_for_test(sealed, PublicationMode::Replace { expected })
                .unwrap();
        assert_eq!(selector::read(lease).unwrap(), published.id());
        let ready = published.open(limits()).unwrap();
        assert_eq!(thread::current().id(), worker);
        MaintenanceResult::Ready(ready.into_store(lease).unwrap())
    });
    let mut maintenance = Box::pin(control.maintain(control.snapshot().revision, request));
    enqueue(maintenance.as_mut());
    let database = wait(&entry);
    assert_eq!(control.snapshot().phase, LifecyclePhase::Maintenance);
    let mut shutdown = Box::pin(session.owner.shutdown());
    enqueue(shutdown.as_mut());
    let stopping = control.snapshot();
    assert_eq!(stopping.phase, LifecyclePhase::ShuttingDown);
    assert!(matches!(
        control.ready_handle(&stopping.revision),
        Err(RegistryError::Unavailable(_))
    ));
    assert_closed(&retained_handle);
    assert_location_locked(&root);
    assert_database_locked(&database);
    assert_eq!(
        fs::read(root.join(selector::ACTIVE)).unwrap(),
        selector::encode(expected)
    );
    // Abandoning the requester must not cancel the admitted publication.
    drop(maintenance);
    release.send(()).unwrap();
    run(shutdown).unwrap();
    let lease = LocationLease::acquire(&root).unwrap();
    let selected = selector::read(&lease).unwrap();
    assert_ne!(selected, expected);
    assert_eq!(selected.database_path(&lease), database);
    drop(Store::open(&database, limits()).unwrap());
    drop(Store::open(&old_database, limits()).unwrap());
    let stopped = control.snapshot();
    assert_eq!(stopped.phase, LifecyclePhase::Stopped);
    assert_eq!(stopped.last_outcome, Some(MaintenanceOutcome::Ready));
    assert!(matches!(
        control.ready_handle(&stopped.revision),
        Err(RegistryError::Unavailable(_))
    ));
    assert_closed(&retained_handle);
}
