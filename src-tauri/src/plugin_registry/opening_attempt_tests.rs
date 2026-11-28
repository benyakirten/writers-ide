use super::*;
use std::{
    sync::mpsc,
    time::{Duration, Instant},
};

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits::default(),
        max_rows: 100,
        max_snapshot_bytes: 1024 * 1024,
        max_text_bytes: 65536,
        max_location_bytes: 4096,
        max_review_items: 100,
    }
}
fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}
fn fixture() -> (tempfile::TempDir, LocationLease, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    std::fs::create_dir(&root).unwrap();
    let path = root.join("registry.sqlite");
    drop(Store::create(&path, limits()).unwrap());
    (dir, lease, path)
}
fn begin(lease: LocationLease, path: PathBuf, probe: ProbeStartup) -> RegistryOpening {
    match Registry::begin_with_upgrade(
        path,
        limits(),
        RegistryCapacity::with_observers(4, 4, 4).unwrap(),
        false,
        Some(lease),
        None,
        Some(probe),
    ) {
        Ok(opening) => opening,
        Err(_) => panic!("worker should start"),
    }
}
fn failed_after_open(lease: LocationLease, path: PathBuf) -> OpeningFailure {
    let (entered, receive) = mpsc::channel();
    let (release, barrier) = mpsc::channel();
    drop(release);
    let probe = ProbeStartup {
        lease: lease.guard(),
        after_open: Some((entered, barrier)),
    };
    let mut opening = begin(lease, path, probe);
    receive.recv_timeout(Duration::from_secs(10)).unwrap();
    match run(opening.complete()) {
        Err(failure) => failure,
        Ok(_) => panic!("failed readiness must not issue an operation handle"),
    }
}

#[test]
fn failed_readiness_retains_live_store_on_worker_until_explicit_cleanup() {
    let (_dir, lease, path) = fixture();
    let root = lease.root().to_path_buf();
    let failure = failed_after_open(lease.clone(), path.clone());
    assert!(failure.error.to_string().contains("startup barrier"));
    let owner = failure.cleanup.owner.as_ref().unwrap();
    let control = owner.control();
    assert!(control.ready_handle(&control.snapshot().revision).is_err());
    assert!(Store::open(&path, limits()).is_err());
    run(failure.cleanup()).unwrap();
    drop(Store::open(&path, limits()).unwrap());
    assert!(LocationLease::acquire(&root).is_err());
    drop(lease);
    assert!(LocationLease::acquire(&root).is_ok());
}
#[test]
fn opening_error_is_separate_from_cleanup_completion_loss() {
    let (_dir, lease, path) = fixture();
    let mut failure = failed_after_open(lease, path.clone());
    let original = failure.error.to_string();
    // Fault-inject lost cleanup reporting, not a replacement connection.
    let (send, receive) = oneshot::channel();
    drop(send);
    failure.cleanup.owner.as_mut().unwrap().finished = Some(receive);
    let OpeningFailure { error, cleanup } = failure;
    let cleanup = run(cleanup.wait()).unwrap_err();
    assert_eq!(error.to_string(), original);
    assert!(original.contains("startup barrier"));
    assert!(cleanup.to_string().contains("completion lost"));
    drop(Store::open(&path, limits()).unwrap());
}
#[test]
fn explicit_startup_cancellation_awaits_real_cleanup_and_retains_worker_lease() {
    let (_dir, lease, path) = fixture();
    let root = lease.root().to_path_buf();
    let (entered, receive) = mpsc::channel();
    let (release, barrier) = mpsc::channel();
    let probe = ProbeStartup {
        lease: lease.guard(),
        after_open: Some((entered, barrier)),
    };
    let mut opening = begin(lease, path.clone(), probe);
    receive.recv_timeout(Duration::from_secs(10)).unwrap();
    // Abandon only the readiness future, then explicitly drain the same attempt.
    {
        let mut readiness = Box::pin(opening.complete());
        use std::{
            future::Future,
            task::{Context, Waker},
        };
        assert!(readiness
            .as_mut()
            .poll(&mut Context::from_waker(Waker::noop()))
            .is_pending());
    }
    let mut cleanup = Box::pin(opening.cleanup());
    use std::{
        future::Future,
        task::{Context, Waker},
    };
    assert!(cleanup
        .as_mut()
        .poll(&mut Context::from_waker(Waker::noop()))
        .is_pending());
    assert!(LocationLease::acquire(&root).is_err());
    assert!(Store::open(&path, limits()).is_err());
    release.send(()).unwrap();
    run(cleanup).unwrap();
    assert!(LocationLease::acquire(&root).is_ok());
    drop(Store::open(&path, limits()).unwrap());
}
#[test]
fn dropped_failed_attempt_requests_cleanup_without_claiming_completion() {
    let (_dir, lease, path) = fixture();
    let root = lease.root().to_path_buf();
    let failure = failed_after_open(lease, path);
    drop(failure);
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if LocationLease::acquire(&root).is_ok() {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "worker did not release ownership"
        );
        std::thread::yield_now();
    }
}
