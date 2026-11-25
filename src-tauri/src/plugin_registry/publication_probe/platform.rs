//! Test-only native publication candidates. Successful calls are runtime evidence,
//! not a general power-loss guarantee or approval for production publication.
#![cfg(test)]

use std::{io, path::Path};

#[cfg(unix)]
pub(super) fn sync_directory(path: &Path) -> io::Result<()> {
    // Rust 1.90's Apple implementation uses F_FULLFSYNC. Do not downgrade failures.
    std::fs::File::open(path)?.sync_all()
}

#[cfg(windows)]
pub(super) fn sync_directory(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "directory durability not established on Windows",
    ))
}

#[cfg(not(any(unix, windows)))]
pub(super) fn sync_directory(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "directory durability not established on this platform",
    ))
}

#[cfg(any(target_os = "linux", target_os = "macos", windows))]
fn validate_siblings(staging: &Path, active: &Path) -> io::Result<()> {
    let parent = |path: &Path| {
        let parent = path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "selector must have a parent")
        })?;
        std::fs::canonicalize(if parent.as_os_str().is_empty() {
            Path::new(".")
        } else {
            parent
        })
    };
    if staging.file_name().is_none()
        || active.file_name().is_none()
        || staging.file_name() == active.file_name()
        || parent(staging)? != parent(active)?
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "staging and active selectors must be distinct siblings",
        ));
    }
    // This is a test harness precondition check, not protection against a hostile
    // process swapping directories between validation and the native operation.
    Ok(())
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn replace_selector(staging: &Path, active: &Path, replace: bool) -> io::Result<()> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    validate_siblings(staging, active)?;
    let staging = CString::new(staging.as_os_str().as_bytes())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let active = CString::new(active.as_os_str().as_bytes())
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;

    // SAFETY: Both strings are NUL-terminated and remain alive for the call.
    // Exactly one native operation is attempted; failures have no fallback.
    let result = unsafe {
        if replace {
            libc::rename(staging.as_ptr(), active.as_ptr())
        } else {
            #[cfg(target_os = "linux")]
            {
                libc::renameat2(
                    libc::AT_FDCWD,
                    staging.as_ptr(),
                    libc::AT_FDCWD,
                    active.as_ptr(),
                    libc::RENAME_NOREPLACE,
                )
            }
            #[cfg(target_os = "macos")]
            {
                libc::renamex_np(staging.as_ptr(), active.as_ptr(), libc::RENAME_EXCL)
            }
        }
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
pub(super) fn replace_selector(staging: &Path, active: &Path, replace: bool) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    validate_siblings(staging, active)?;
    let wide = |path: &Path| -> io::Result<Vec<u16>> {
        let mut units: Vec<u16> = path.as_os_str().encode_wide().collect();
        if units.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "selector path contains NUL",
            ));
        }
        units.push(0);
        Ok(units)
    };
    let staging = wide(staging)?;
    let active = wide(active)?;
    let flags = if replace {
        MOVEFILE_WRITE_THROUGH | MOVEFILE_REPLACE_EXISTING
    } else {
        MOVEFILE_WRITE_THROUGH
    };
    // SAFETY: Both UTF-16 paths are NUL-terminated and alive for the call.
    // No COPY_ALLOWED, alternate API, or automatic retry is permitted.
    let result = unsafe { MoveFileExW(staging.as_ptr(), active.as_ptr(), flags) };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
pub(super) fn replace_selector(_staging: &Path, _active: &Path, _replace: bool) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "selector replacement candidate is not established on this platform",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    mod native {
        use super::*;
        use std::fs;
        use tempfile::tempdir;

        // These checks observe runtime namespace effects on the test filesystem.
        // They do not simulate a power interruption or establish disk persistence.
        #[test]
        fn first_creation_is_exclusive_and_preserves_failed_staging() {
            let directory = tempdir().unwrap();
            let staging = directory.path().join("staging");
            let active = directory.path().join("active");
            assert_eq!(staging.parent(), active.parent());
            fs::write(&staging, b"first").unwrap();
            replace_selector(&staging, &active, false).unwrap();
            assert_eq!(fs::read(&active).unwrap(), b"first");
            assert!(!staging.exists());

            fs::write(&staging, b"unexpected second").unwrap();
            let error = replace_selector(&staging, &active, false).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
            assert_eq!(fs::read(&active).unwrap(), b"first");
            assert_eq!(fs::read(&staging).unwrap(), b"unexpected second");
        }

        #[test]
        fn existing_selector_is_replaced_by_complete_candidate() {
            let directory = tempdir().unwrap();
            let staging = directory.path().join("staging");
            let active = directory.path().join("active");
            assert_eq!(staging.parent(), active.parent());
            fs::write(&active, b"old").unwrap();
            fs::write(&staging, b"new selector").unwrap();
            fs::OpenOptions::new()
                .write(true)
                .open(&staging)
                .unwrap()
                .sync_all()
                .unwrap();
            replace_selector(&staging, &active, true).unwrap();
            assert_eq!(fs::read(&active).unwrap(), b"new selector");
            assert!(!staging.exists());
        }

        #[test]
        fn missing_staging_failure_preserves_existing_selector() {
            let directory = tempdir().unwrap();
            let staging = directory.path().join("missing");
            let active = directory.path().join("active");
            fs::write(&active, b"old").unwrap();
            for replace in [false, true] {
                assert!(replace_selector(&staging, &active, replace).is_err());
                assert_eq!(fs::read(&active).unwrap(), b"old");
                assert!(!staging.exists());
            }
        }

        #[test]
        fn non_sibling_paths_are_rejected_without_moving_either_file() {
            let directory = tempdir().unwrap();
            let other = directory.path().join("other");
            fs::create_dir(&other).unwrap();
            let staging = directory.path().join("staging");
            let active = other.join("active");
            fs::write(&staging, b"new").unwrap();
            fs::write(&active, b"old").unwrap();
            for replace in [false, true] {
                let error = replace_selector(&staging, &active, replace).unwrap_err();
                assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
                assert_eq!(fs::read(&active).unwrap(), b"old");
                assert_eq!(fs::read(&staging).unwrap(), b"new");
            }
        }

        #[test]
        fn identical_paths_are_rejected_without_claiming_publication() {
            let directory = tempdir().unwrap();
            let active = directory.path().join("active");
            fs::write(&active, b"old").unwrap();
            for replace in [false, true] {
                let error = replace_selector(&active, &active, replace).unwrap_err();
                assert_eq!(error.kind(), io::ErrorKind::InvalidInput);
                assert_eq!(fs::read(&active).unwrap(), b"old");
            }
        }

        #[cfg(unix)]
        #[test]
        fn exclusive_creation_does_not_follow_or_replace_destination_symlink() {
            use std::os::unix::fs::symlink;

            let directory = tempdir().unwrap();
            let staging = directory.path().join("staging");
            let active = directory.path().join("active");
            let missing = directory.path().join("missing");
            fs::write(&staging, b"new").unwrap();
            symlink(&missing, &active).unwrap();
            let error = replace_selector(&staging, &active, false).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
            assert_eq!(fs::read_link(&active).unwrap(), missing);
            assert_eq!(fs::read(&staging).unwrap(), b"new");
            assert!(!missing.exists());
        }

        #[cfg(windows)]
        #[test]
        fn incompatible_sharing_blocks_candidate_without_retry_or_fallback() {
            use std::os::windows::fs::OpenOptionsExt;
            use windows_sys::Win32::{
                Foundation::{ERROR_ACCESS_DENIED, ERROR_SHARING_VIOLATION},
                Storage::FileSystem::{FILE_SHARE_READ, FILE_SHARE_WRITE},
            };

            let directory = tempdir().unwrap();
            let staging = directory.path().join("staging");
            let active = directory.path().join("active");
            for block_staging in [false, true] {
                fs::write(&active, b"old").unwrap();
                fs::write(&staging, b"new").unwrap();
                let blocked = if block_staging { &staging } else { &active };
                let handle = fs::OpenOptions::new()
                    .read(true)
                    .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
                    .open(blocked)
                    .unwrap();
                let error = replace_selector(&staging, &active, true).unwrap_err();
                let code = error
                    .raw_os_error()
                    .expect("Windows sharing failure has a native code");
                assert!(
                    code == ERROR_SHARING_VIOLATION as i32 || code == ERROR_ACCESS_DENIED as i32,
                    "unexpected sharing error: {error}"
                );
                assert_eq!(fs::read(&active).unwrap(), b"old");
                assert_eq!(fs::read(&staging).unwrap(), b"new");
                drop(handle);
                // Releasing the handle must not trigger an automatic retry.
                assert_eq!(fs::read(&active).unwrap(), b"old");
                assert_eq!(fs::read(&staging).unwrap(), b"new");
            }
        }
    }

    #[cfg(unix)]
    #[test]
    fn native_directory_barrier_reports_its_actual_result() {
        let directory = tempfile::tempdir().unwrap();
        sync_directory(directory.path()).unwrap();
        let missing = directory.path().join("missing");
        assert_eq!(
            sync_directory(&missing).unwrap_err().kind(),
            io::ErrorKind::NotFound
        );
    }

    #[cfg(windows)]
    #[test]
    fn directory_barrier_remains_unsupported_even_if_moves_succeed() {
        let directory = tempfile::tempdir().unwrap();
        let error = sync_directory(directory.path()).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
        assert_eq!(
            error.to_string(),
            "directory durability not established on Windows"
        );
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    #[test]
    fn unknown_replacement_platform_is_unsupported() {
        let error = replace_selector(Path::new("staging"), Path::new("active"), false).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }

    #[cfg(not(any(unix, windows)))]
    #[test]
    fn unknown_directory_barrier_is_unsupported() {
        let error = sync_directory(Path::new(".")).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::Unsupported);
    }
}
