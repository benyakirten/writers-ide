use super::*;
use crate::plugin_integrity::IntegrityLimits;
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    task::{Context, Poll, Waker},
    time::Duration,
};

fn enqueue<F: Future>(future: Pin<&mut F>) {
    let waker = Waker::noop();
    assert!(matches!(
        future.poll(&mut Context::from_waker(waker)),
        Poll::Pending
    ));
}
fn run<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}
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
        .recv_timeout(Duration::from_secs(10))
        .expect("worker did not reach test barrier")
}

#[test]
fn command_resource_fifo_bounded_admission_and_service_lifetime() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap(),
    ))
    .unwrap();
    let original = run(session.handle.read_command_resource_settings()).unwrap();
    let changed = CommandResourceSettings {
        max_payload_depth: 1,
        ..original.settings
    };
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&receive_release);
        Ok(())
    }));
    enqueue(active.as_mut());
    wait(&receive_started);
    let mut write = Box::pin(
        session
            .handle
            .set_command_resource_settings(original.revision, changed),
    );
    enqueue(write.as_mut());
    let mut read = Box::pin(session.handle.read_command_resource_settings());
    enqueue(read.as_mut());
    assert!(matches!(
        run(session.handle.read_command_resource_settings()),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert!(matches!(
        run(session
            .handle
            .set_command_resource_settings(original.revision, original.settings)),
        Err(RegistryError::LimitExceeded(_))
    ));
    release.send(()).unwrap();
    run(active).unwrap();
    let saved = run(write).unwrap();
    assert_eq!(saved.revision.value(), 1);
    assert_eq!(saved.settings, changed);
    assert_eq!(run(read).unwrap(), saved);
    run(session.owner.shutdown()).unwrap();
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap(),
    ))
    .unwrap();
    assert_eq!(
        run(next.handle.read_command_resource_settings()).unwrap(),
        saved
    );
    assert!(matches!(
        run(session.handle.read_command_resource_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        run(session
            .handle
            .set_command_resource_settings(saved.revision, original.settings)),
        Err(RegistryError::Unavailable(_))
    ));
    // Even an accepting worker rejects a handle from an older service association.
    let stale = RegistryHandle {
        shared: next.handle.shared.clone(),
        service: next.handle.service + 1,
        validity: next.handle.validity.clone(),
    };
    assert!(matches!(
        run(stale.read_command_resource_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        run(stale.set_command_resource_settings(saved.revision, original.settings)),
        Err(RegistryError::Unavailable(_))
    ));
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn command_resource_abandoned_admitted_write_drains_after_close() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap(),
    ))
    .unwrap();
    let original = run(session.handle.read_command_resource_settings()).unwrap();
    let changed = CommandResourceSettings {
        max_window_pending: 1,
        ..original.settings
    };
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&receive_release);
        Ok(())
    }));
    enqueue(active.as_mut());
    wait(&receive_started);
    let mut read = Box::pin(session.handle.read_command_resource_settings());
    enqueue(read.as_mut());
    let mut write = Box::pin(
        session
            .handle
            .set_command_resource_settings(original.revision, changed),
    );
    enqueue(write.as_mut());
    drop(write);
    session.owner.shared.close();
    release.send(()).unwrap();
    run(active).unwrap();
    assert!(matches!(run(read), Err(RegistryError::Unavailable(_))));
    run(session.owner.shutdown()).unwrap();
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap(),
    ))
    .unwrap();
    let saved = run(next.handle.read_command_resource_settings()).unwrap();
    assert_eq!(saved.settings, changed);
    assert_eq!(saved.revision.value(), 1);
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn creates_only_after_readiness_and_reopens_saved_settings() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    let original = run(session.handle.read_settings()).unwrap();
    let changed = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..original
    };
    assert_eq!(
        run(session.handle.set_host_settings(original, changed)).unwrap(),
        changed
    );
    run(session.owner.shutdown()).unwrap();
    assert!(matches!(
        run(session.handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    let reopened = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    assert_eq!(run(reopened.handle.read_settings()).unwrap(), changed);
    run(reopened.owner.shutdown()).unwrap();
}

#[test]
fn creation_never_overwrites_and_open_never_creates() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    assert!(run(Registry::open(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(1, 4, 4).unwrap()
    ))
    .is_err());
    assert!(!path.exists());
    std::fs::write(&path, b"original").unwrap();
    assert!(run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(1, 4, 4).unwrap()
    ))
    .is_err());
    assert_eq!(std::fs::read(path).unwrap(), b"original");
}

#[test]
fn ownership_is_exclusive_until_shutdown() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("registry.sqlite");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap(),
    ))
    .unwrap();
    assert!(matches!(
        run(Registry::open(
            path.clone(),
            limits(),
            crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap()
        )),
        Err(RegistryError::Unavailable(_))
    ));
    run(session.owner.shutdown()).unwrap();
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(2, 4, 4).unwrap(),
    ))
    .unwrap();
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn full_queue_rejects_without_execution_and_writes_keep_fifo() {
    let dir = tempfile::tempdir().unwrap();
    let session = run(Registry::create(
        dir.path().join("db"),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(1, 4, 4).unwrap(),
    ))
    .unwrap();
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut first = Box::pin(session.handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&receive_release);
        Ok(())
    }));
    enqueue(first.as_mut());
    wait(&receive_started);
    let order = Arc::new(AtomicUsize::new(0));
    let expected = order.clone();
    let mut queued = Box::pin(session.handle.submit(false, move |_| {
        assert_eq!(expected.fetch_add(1, Ordering::SeqCst), 0);
        Ok(())
    }));
    enqueue(queued.as_mut());
    let refused = order.clone();
    assert!(matches!(
        run(session.handle.submit(false, move |_| {
            refused.fetch_add(100, Ordering::SeqCst);
            Ok(())
        })),
        Err(RegistryError::LimitExceeded(_))
    ));
    release.send(()).unwrap();
    run(first).unwrap();
    run(queued).unwrap();
    assert_eq!(order.load(Ordering::SeqCst), 1);
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn shutdown_rejects_queued_reads_but_finishes_abandoned_writes() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    let original = run(session.handle.read_settings()).unwrap();
    let changed = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..original
    };
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&receive_release);
        Ok(())
    }));
    enqueue(active.as_mut());
    wait(&receive_started);
    let mut read = Box::pin(session.handle.read_settings());
    enqueue(read.as_mut());
    let mut write = Box::pin(session.handle.set_host_settings(original, changed));
    enqueue(write.as_mut());
    drop(write);
    session.owner.shared.close();
    release.send(()).unwrap();
    run(active).unwrap();
    assert!(matches!(run(read), Err(RegistryError::Unavailable(_))));
    run(session.owner.shutdown()).unwrap();
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    assert_eq!(run(next.handle.read_settings()).unwrap(), changed);
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn abandoned_queued_read_is_not_executed() {
    let dir = tempfile::tempdir().unwrap();
    let session = run(Registry::create(
        dir.path().join("db"),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut active = Box::pin(session.handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&receive_release);
        Ok(())
    }));
    enqueue(active.as_mut());
    wait(&receive_started);
    let count = Arc::new(AtomicUsize::new(0));
    let observed = count.clone();
    let mut read = Box::pin(session.handle.submit(true, move |_| {
        observed.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }));
    enqueue(read.as_mut());
    drop(read);
    release.send(()).unwrap();
    run(active).unwrap();
    run(session.handle.read_settings()).unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 0);
    run(session.owner.shutdown()).unwrap();
}

#[test]
fn panic_makes_admitted_write_unknown_and_never_revives_handles() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    let original = run(session.handle.read_settings()).unwrap();
    let changed = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..original
    };
    let result: Result<()> = run(session.handle.submit(false, move |store| {
        store.set_host_settings(original, changed)?;
        panic!("test failure after commit");
    }));
    assert!(matches!(result, Err(RegistryError::OutcomeUnknown(_))));
    assert!(run(session.owner.shutdown()).is_err());
    assert!(matches!(
        run(session.handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    assert_eq!(run(next.handle.read_settings()).unwrap(), changed);
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn dropping_owner_drains_without_waiting_for_operation_handles() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let mut session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    let original = run(session.handle.read_settings()).unwrap();
    let changed = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..original
    };
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut write = Box::pin(session.handle.submit(false, move |store| {
        started.send(()).unwrap();
        wait(&receive_release);
        store.set_host_settings(original, changed)
    }));
    enqueue(write.as_mut());
    wait(&receive_started);
    let finished = session.owner.finished.take();
    drop(session.owner);
    assert!(matches!(
        run(session.handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    release.send(()).unwrap();
    run(write).unwrap();
    run(finished.unwrap()).unwrap().unwrap();
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    assert_eq!(run(next.handle.read_settings()).unwrap(), changed);
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn probe_startup_cancellation_keeps_location_lease_until_worker_cleanup() {
    use super::super::publication_probe::LocationLease;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let first = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    run(first.owner.shutdown()).unwrap();
    let lease = LocationLease::acquire(dir.path()).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let probe = ProbeStartup {
        lease: lease.guard(),
        after_open: Some((started, resume)),
    };
    let mut startup = Box::pin(Registry::open_for_probe(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
        probe,
    ));
    enqueue(startup.as_mut());
    wait(&entered);
    drop(startup);
    drop(lease);
    assert!(matches!(
        LocationLease::acquire(dir.path()),
        Err(RegistryError::Unavailable(_))
    ));
    release.send(()).unwrap();
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    let _lease = loop {
        match LocationLease::acquire(dir.path()) {
            Ok(lease) => break lease,
            Err(RegistryError::Unavailable(_)) => {
                assert!(
                    std::time::Instant::now() < deadline,
                    "abandoned startup did not release lease after cleanup"
                );
                std::thread::sleep(Duration::from_millis(5));
            }
            Err(error) => panic!("unexpected lease failure: {error}"),
        }
    };
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn probe_location_lease_survives_dropped_session_and_abandoned_admitted_work() {
    use super::super::publication_probe::{LocationLease, ProbeSession};
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    let session = run(Registry::create(
        path.clone(),
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    let handle = session.handle.clone();
    let lease = LocationLease::acquire(dir.path()).unwrap();
    let (started, entered) = mpsc::channel();
    let (release, resume) = mpsc::channel();
    let mut write = Box::pin(handle.submit(false, move |_| {
        started.send(()).unwrap();
        wait(&resume);
        Ok(())
    }));
    enqueue(write.as_mut());
    wait(&entered);
    drop(write);
    let mut leased = ProbeSession::new(session, lease).unwrap();
    let finished = leased.completion();
    drop(leased);
    assert!(matches!(
        LocationLease::acquire(dir.path()),
        Err(RegistryError::Unavailable(_))
    ));
    release.send(()).unwrap();
    run(finished).unwrap().unwrap();
    assert!(matches!(
        run(handle.read_settings()),
        Err(RegistryError::Unavailable(_))
    ));
    let _lease = LocationLease::acquire(dir.path()).unwrap();
    let next = run(Registry::open(
        path,
        limits(),
        crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    ))
    .unwrap();
    run(next.owner.shutdown()).unwrap();
}

#[test]
fn zero_capacity_is_rejected_without_creating_destination() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("db");
    assert!(matches!(
        run(Registry::create(
            path.clone(),
            limits(),
            RegistryCapacity {
                queue: 0,
                lifecycle_readers: 4,
                validity_readers: 4
            }
        )),
        Err(RegistryError::InvalidInput(_))
    ));
    assert!(!path.exists());
}
