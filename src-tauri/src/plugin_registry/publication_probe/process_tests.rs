//! These tests terminate a child publisher, not the OS or its storage cache.
#[cfg(unix)]
use super::tests::{limits, run};
use super::*;
use std::{
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

const CHILD_TEST: &str = "plugin_registry::publication_probe::process_tests::child_entry";
const PROCESS_ROOT: &str = "WIDE_PUBLICATION_PROBE_PARENT";
const SCENARIO: &str = "WIDE_PUBLICATION_PROBE_SCENARIO";

struct ChildGuard(Child);
impl ChildGuard {
    fn finish(&mut self) -> std::process::ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if let Some(status) = self.0.try_wait().unwrap() {
                return status;
            }
            assert!(
                Instant::now() < deadline,
                "publication probe child timed out"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }
}
impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}
fn child(parent: &Path, scenario: &str) -> ChildGuard {
    ChildGuard(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", CHILD_TEST, "--nocapture"])
            .env(PROCESS_ROOT, parent)
            .env(SCENARIO, scenario)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
    )
}
fn wait_file(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !path.exists() {
        assert!(
            Instant::now() < deadline,
            "child did not reach barrier {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn child_entry() {
    let Some(parent) = std::env::var_os(PROCESS_ROOT) else {
        return;
    };
    let parent = PathBuf::from(parent);
    let scenario = std::env::var(SCENARIO).unwrap();
    if scenario == "try-lease" {
        match LocationLease::acquire(&parent) {
            Err(RegistryError::Unavailable(_)) => std::process::exit(77),
            Ok(_) => std::process::exit(0),
            Err(error) => panic!("unexpected child lease error: {error}"),
        }
    }
    if scenario == "hold-lease" {
        let _lease = LocationLease::acquire(&parent).unwrap();
        fs::write(parent.join("lease-ready"), b"ready").unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        while !parent.join("release-child").exists() {
            assert!(Instant::now() < deadline, "lease child timed out");
            thread::sleep(Duration::from_millis(5));
        }
        return;
    }
    #[cfg(unix)]
    {
        let (first, exit_phase) = match scenario.as_str() {
            "before-replace" => (false, Phase::BeforeReplace),
            "after-replace" => (false, Phase::AfterReplace),
            "after-directory-sync" => (false, Phase::SelectorConfirmed),
            "before-reopen" => (false, Phase::BeforeReopen),
            "first-before-replace" => (true, Phase::BeforeReplace),
            _ => panic!("unknown child scenario"),
        };
        struct ExitAt(Phase);
        impl Control for ExitAt {
            fn at(&mut self, phase: Phase) -> io::Result<()> {
                if phase == self.0 {
                    std::process::exit(73);
                }
                Ok(())
            }
        }
        let lease = LocationLease::acquire(&parent).unwrap();
        if first {
            lease.initialize().unwrap();
        } else {
            assert!(!lease.is_fresh().unwrap());
        }
        let mut control = ExitAt(exit_phase);
        let generation = prepare(&lease, &limits(), &mut control).unwrap();
        fs::write(parent.join("expected-generation"), generation.id.0).unwrap();
        let result = run(publish(lease, &generation, !first, limits(), &mut control));
        panic!("exit barrier was not reached: {}", result.is_ok());
    }
    #[cfg(not(unix))]
    panic!("unsupported child scenario");
}

#[test]
fn location_lease_competes_across_processes_without_creating_registry() {
    let parent = tempfile::tempdir().unwrap();
    let lease = LocationLease::acquire(parent.path()).unwrap();
    assert!(!lease.root().exists());
    assert_eq!(child(parent.path(), "try-lease").finish().code(), Some(77));
    drop(lease);
    assert_eq!(child(parent.path(), "try-lease").finish().code(), Some(0));
    assert!(!parent.path().join(ROOT).exists());
}

#[test]
fn terminated_owner_releases_lease_without_deleting_lock_file() {
    let parent = tempfile::tempdir().unwrap();
    let mut process = child(parent.path(), "hold-lease");
    wait_file(&parent.path().join("lease-ready"));
    assert!(matches!(
        LocationLease::acquire(parent.path()),
        Err(RegistryError::Unavailable(_))
    ));
    process.0.kill().unwrap();
    assert!(!process.finish().success());
    let lease = LocationLease::acquire(parent.path()).unwrap();
    assert!(lease
        .parent
        .join("registry-publication-probe.lock")
        .is_file());
    assert!(lease.is_fresh().unwrap());
}

#[cfg(unix)]
#[test]
fn abrupt_publisher_exit_preserves_selector_boundary_and_both_generations() {
    for phase in [
        "before-replace",
        "after-replace",
        "after-directory-sync",
        "before-reopen",
    ] {
        let parent = tempfile::tempdir().unwrap();
        let lease = LocationLease::acquire(parent.path()).unwrap();
        lease.initialize().unwrap();
        let old = prepare(&lease, &limits(), &mut Native).unwrap();
        let session = run(publish(lease.clone(), &old, false, limits(), &mut Native)).unwrap();
        run(session.shutdown()).unwrap();
        drop(lease);
        assert_eq!(child(parent.path(), phase).finish().code(), Some(73));
        let lease = LocationLease::acquire(parent.path()).unwrap();
        let new = GenerationId(
            fs::read(parent.path().join("expected-generation"))
                .unwrap()
                .try_into()
                .unwrap(),
        );
        let selected = read_selector(&lease).unwrap();
        assert_eq!(
            selected,
            if phase == "before-replace" {
                old.id
            } else {
                new
            }
        );
        assert!(old.id.database(&lease).is_file());
        assert!(new.database(&lease).is_file());
        let session = run(Registry::open(
            selected.database(&lease),
            limits(),
            crate::plugin_registry::RegistryCapacity::with_observers(4, 4, 4).unwrap(),
        ))
        .unwrap();
        run(session.owner.shutdown()).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn interrupted_first_publication_requires_recovery_not_resume() {
    let parent = tempfile::tempdir().unwrap();
    assert_eq!(
        child(parent.path(), "first-before-replace").finish().code(),
        Some(73)
    );
    let lease = LocationLease::acquire(parent.path()).unwrap();
    assert!(lease.root().is_dir());
    assert!(!lease.root().join(ACTIVE).exists());
    assert!(matches!(
        lease.is_fresh(),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert!(matches!(
        lease.initialize(),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert_eq!(
        fs::read_dir(lease.root().join("generations"))
            .unwrap()
            .count(),
        1
    );
}
