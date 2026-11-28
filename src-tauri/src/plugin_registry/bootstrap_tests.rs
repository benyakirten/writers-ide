use super::*;
use crate::plugin_registry::{schema, selector::GenerationId};
use rusqlite::Connection;

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
fn capacity() -> RegistryCapacity {
    RegistryCapacity::with_observers(4, 4, 4).unwrap()
}
fn run<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}
fn seed(root: &Path) -> std::path::PathBuf {
    fs::create_dir(root).unwrap();
    let id = GenerationId::from_bytes([7; 16]);
    let generation = root.join(id.name());
    fs::create_dir(&generation).unwrap();
    let path = generation.join("registry.sqlite");
    let mut connection = Connection::open(&path).unwrap();
    schema::initialize(&mut connection).unwrap();
    connection.close().unwrap();
    fs::write(root.join("active"), selector::encode(id)).unwrap();
    path
}
fn recovery(root: &Path) -> LocationLease {
    match SelectedRegistry::begin(root, limits(), capacity()) {
        Err(BootstrapFailure::RecoveryRequired { location, error }) => {
            assert!(!error.to_string().is_empty());
            assert!(matches!(
                LocationLease::acquire_detailed(root),
                Err(LocationAcquireError::Contended)
            ));
            location
        }
        _ => panic!("expected selection failure without a worker"),
    }
}

#[test]
fn absent_root_is_blocked_without_creation_and_keeps_owner() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let location = match SelectedRegistry::begin(&root, limits(), capacity()) {
        Err(BootstrapFailure::InitializationBlocked { location }) => location,
        _ => panic!("expected initialization refusal"),
    };
    assert!(!root.exists());
    assert!(matches!(
        LocationLease::acquire_detailed(&root),
        Err(LocationAcquireError::Contended)
    ));
    drop(location);
    assert!(LocationLease::acquire(&root).is_ok());
}
#[test]
fn contention_precedes_root_inspection() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let _location = LocationLease::acquire(&root).unwrap();
    assert!(matches!(
        SelectedRegistry::begin(&root, limits(), capacity()),
        Err(BootstrapFailure::OwnershipUnavailable(
            LocationAcquireError::Contended
        ))
    ));
    assert!(!root.exists());
}
#[test]
fn lock_open_failure_is_not_contention() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    fs::create_dir(parent.path().join("registry.location-lock")).unwrap();
    assert!(matches!(
        SelectedRegistry::begin(&root, limits(), capacity()),
        Err(BootstrapFailure::OwnershipUnavailable(
            LocationAcquireError::OpenFailed(_)
        ))
    ));
    assert!(!root.exists());
}
#[test]
fn existing_empty_root_is_recovery_not_initialization() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    fs::create_dir(&root).unwrap();
    let _location = recovery(&root);
    assert_eq!(fs::read_dir(root).unwrap().count(), 0);
}
#[test]
fn corrupt_selector_never_falls_back_to_valid_database() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let path = seed(&root);
    fs::write(root.join("active"), b"corrupt").unwrap();
    let _location = recovery(&root);
    assert_eq!(fs::read(root.join("active")).unwrap(), b"corrupt");
    assert!(!path
        .with_file_name("registry.sqlite.registry-lock")
        .exists());
}
#[test]
fn missing_selected_generation_never_scans_for_another() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    seed(&root);
    fs::write(
        root.join("active"),
        selector::encode(GenerationId::from_bytes([9; 16])),
    )
    .unwrap();
    let _location = recovery(&root);
}
#[test]
fn selected_current_database_opens_and_drains_with_separate_location_owner() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    seed(&root);
    let SelectedRegistryOpening {
        location,
        mut opening,
    } = match SelectedRegistry::begin(&root, limits(), capacity()) {
        Ok(opening) => opening,
        _ => panic!("expected selected opening"),
    };
    let session = match run(opening.complete()) {
        Ok(session) => session,
        Err(_) => panic!("expected readiness"),
    };
    run(session.handle.read_command_resource_settings()).unwrap();
    run(session.owner.shutdown()).unwrap();
    assert!(LocationLease::acquire(&root).is_err());
    drop(location);
    assert!(LocationLease::acquire(&root).is_ok());
}
#[test]
fn corrupt_database_failure_has_awaitable_cleanup_and_retained_location() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let path = seed(&root);
    fs::write(&path, b"not sqlite").unwrap();
    let mut selected = match SelectedRegistry::begin(&root, limits(), capacity()) {
        Ok(value) => value,
        _ => panic!("selection should succeed"),
    };
    let failure = match run(selected.opening.complete()) {
        Err(failure) => failure,
        Ok(_) => panic!("must not expose a ready handle"),
    };
    let original = failure.error.to_string();
    assert!(!original.is_empty());
    run(failure.cleanup()).unwrap();
    assert!(LocationLease::acquire(&root).is_err());
    assert_eq!(fs::read(&path).unwrap(), b"not sqlite");
    drop(selected.location);
    assert!(LocationLease::acquire(&root).is_ok());
}
#[test]
fn invalid_limits_failure_before_worker_keeps_location_and_has_no_work_to_drain() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    seed(&root);
    let mut invalid = limits();
    invalid.max_rows = 0;
    match SelectedRegistry::begin(&root, invalid, capacity()) {
        Err(BootstrapFailure::Opening { location, failure }) => {
            assert!(matches!(failure.error, RegistryError::InvalidInput(_)));
            run(failure.cleanup()).unwrap();
            assert!(LocationLease::acquire(&root).is_err());
            drop(location);
        }
        _ => panic!("expected pre-worker validation failure"),
    }
}

#[cfg(unix)]
#[test]
fn linked_root_selector_generation_and_database_are_rejected() {
    use std::os::unix::fs::symlink;
    for component in ["root", "active", "generation", "database"] {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("registry");
        let path = seed(&root);
        let target = match component {
            "root" => root.clone(),
            "active" => root.join("active"),
            "generation" => path.parent().unwrap().to_path_buf(),
            _ => path,
        };
        let moved = parent.path().join("moved");
        fs::rename(&target, &moved).unwrap();
        symlink(&moved, &target).unwrap();
        let _location = recovery(&root);
        assert!(fs::symlink_metadata(target)
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
