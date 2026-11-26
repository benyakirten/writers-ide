use super::*;
use std::fs;

#[test]
fn production_preflight_refuses_without_creating_root_or_changing_parent() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    let entries = || {
        let mut names: Vec<_> = fs::read_dir(parent.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        names.sort();
        names
    };
    let before = entries();
    assert!(matches!(
        production_preflight(&lease),
        Err(RegistryError::Unavailable(_))
    ));
    assert_eq!(entries(), before);
    assert_eq!(
        fs::symlink_metadata(&root).unwrap_err().kind(),
        io::ErrorKind::NotFound
    );
}

#[test]
fn production_preflight_refuses_without_changing_existing_root() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    // Even an invalid root entry must not be read or repaired by preflight.
    fs::write(&root, b"preserve invalid root").unwrap();
    assert!(matches!(
        production_preflight(&lease),
        Err(RegistryError::Unavailable(_))
    ));
    assert_eq!(fs::read(&root).unwrap(), b"preserve invalid root");
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
mod native {
    use super::*;
    use std::os::unix::fs::symlink;

    // Namespace/barrier-call checks only, not storage qualification or crash tests.
    #[test]
    fn exclusive_creation_and_replacement_preserve_complete_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let staging = directory.path().join("staging");
        let active = directory.path().join("active");
        fs::write(&staging, b"first").unwrap();
        replace_selector(&staging, &active, false).unwrap();
        assert_eq!(fs::read(&active).unwrap(), b"first");
        assert!(!staging.exists());

        fs::write(&staging, b"replacement").unwrap();
        assert_eq!(
            replace_selector(&staging, &active, false)
                .unwrap_err()
                .kind(),
            io::ErrorKind::AlreadyExists
        );
        assert_eq!(fs::read(&active).unwrap(), b"first");
        assert_eq!(fs::read(&staging).unwrap(), b"replacement");
        replace_selector(&staging, &active, true).unwrap();
        assert_eq!(fs::read(&active).unwrap(), b"replacement");
        assert!(!staging.exists());
    }

    #[test]
    fn canonical_siblings_allow_parent_alias_but_reject_other_or_identical_entries() {
        let directory = tempfile::tempdir().unwrap();
        let alias = directory.path().join("alias");
        symlink(directory.path(), &alias).unwrap();
        let other = directory.path().join("other");
        fs::create_dir(&other).unwrap();
        let staging = directory.path().join("staging");
        let active = directory.path().join("active");
        fs::write(&staging, b"new").unwrap();
        fs::write(&active, b"old").unwrap();
        for replace in [false, true] {
            for destination in [other.join("active"), alias.join("staging")] {
                assert_eq!(
                    replace_selector(&staging, &destination, replace)
                        .unwrap_err()
                        .kind(),
                    io::ErrorKind::InvalidInput
                );
                assert_eq!(fs::read(&staging).unwrap(), b"new");
                assert_eq!(fs::read(&active).unwrap(), b"old");
            }
        }
        replace_selector(&alias.join("staging"), &active, true).unwrap();
        assert_eq!(fs::read(&active).unwrap(), b"new");
    }

    #[test]
    fn destination_symlinks_are_not_followed_and_exclusive_creation_preserves_them() {
        let directory = tempfile::tempdir().unwrap();
        let staging = directory.path().join("staging");
        let active = directory.path().join("active");
        let target = directory.path().join("target");
        fs::write(&staging, b"new").unwrap();
        // Cover both dangling and existing destination symlinks.
        for exists in [false, true] {
            if exists {
                fs::write(&target, b"target").unwrap();
            }
            symlink(&target, &active).unwrap();
            assert_eq!(
                replace_selector(&staging, &active, false)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::AlreadyExists
            );
            assert_eq!(fs::read_link(&active).unwrap(), target);
            assert_eq!(fs::read(&staging).unwrap(), b"new");
            fs::remove_file(&active).unwrap();
        }
        symlink(&target, &active).unwrap();
        replace_selector(&staging, &active, true).unwrap();
        assert!(fs::symlink_metadata(&active).unwrap().is_file());
        assert_eq!(fs::read(&active).unwrap(), b"new");
        assert_eq!(fs::read(&target).unwrap(), b"target");
    }

    #[test]
    fn native_failures_return_errors_and_preserve_evidence() {
        let directory = tempfile::tempdir().unwrap();
        let staging = directory.path().join("staging");
        let active = directory.path().join("active");
        fs::write(&active, b"old").unwrap();
        for replace in [false, true] {
            assert_eq!(
                replace_selector(&staging, &active, replace)
                    .unwrap_err()
                    .kind(),
                io::ErrorKind::NotFound
            );
            assert_eq!(fs::read(&active).unwrap(), b"old");
        }
        fs::remove_file(&active).unwrap();
        fs::create_dir(&active).unwrap();
        fs::write(active.join("evidence"), b"keep").unwrap();
        fs::write(&staging, b"new").unwrap();
        assert!(replace_selector(&staging, &active, true).is_err());
        assert_eq!(fs::read(&staging).unwrap(), b"new");
        assert_eq!(fs::read(active.join("evidence")).unwrap(), b"keep");
    }

    #[test]
    fn directory_barrier_returns_actual_success_and_errors() {
        let directory = tempfile::tempdir().unwrap();
        sync_directory(directory.path()).unwrap();
        assert_eq!(
            sync_directory(&directory.path().join("missing"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        let file = directory.path().join("file");
        fs::write(&file, b"not a directory").unwrap();
        assert!(sync_directory(&file).is_err());
    }
}

// Includes Windows: do not promote the probe's raw MoveFileExW experiment.
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
#[test]
fn unapproved_platform_candidates_refuse_without_touching_files() {
    let directory = tempfile::tempdir().unwrap();
    let staging = directory.path().join("staging");
    let active = directory.path().join("active");
    fs::write(&staging, b"new").unwrap();
    fs::write(&active, b"old").unwrap();
    for replace in [false, true] {
        assert_eq!(
            replace_selector(&staging, &active, replace)
                .unwrap_err()
                .kind(),
            io::ErrorKind::Unsupported
        );
    }
    for path in [directory.path(), &directory.path().join("missing")] {
        assert_eq!(
            sync_directory(path).unwrap_err().kind(),
            io::ErrorKind::Unsupported
        );
    }
    assert_eq!(fs::read(&staging).unwrap(), b"new");
    assert_eq!(fs::read(&active).unwrap(), b"old");
}
