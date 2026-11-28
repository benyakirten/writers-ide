//! Native publication candidates, not qualified production publication support.
//! Successful calls do not establish filesystem qualification or power-loss durability.

use std::{io, path::Path};

use super::{
    error::{RegistryError, Result},
    location::LocationLease,
};

/// Must run before disruptive admission or first-run root creation.
/// No platform/storage configuration has completed the approved qualification gates.
/// Do not inspect the root, probe storage, or issue a qualification token here.
pub(super) fn production_preflight(_lease: &LocationLease) -> Result<()> {
    Err(RegistryError::Unavailable(
        "registry publication is unavailable: no platform/storage configuration is qualified"
            .into(),
    ))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
pub(super) fn sync_directory(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;

    // Rust 1.90's Apple sync_all uses F_FULLFSYNC, also used for sealed files.
    // A failed required barrier must not fall back to a weaker flush.
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY)
        .open(path)?
        .sync_all()
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(super) fn sync_directory(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "no approved directory durability candidate on this platform",
    ))
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
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
            "staging and active selectors must be distinct canonical siblings",
        ));
    }
    // Cooperative ownership is required. This is not a defense against native
    // writers swapping a parent between validation and the selection operation.
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

    // SAFETY: Both NUL-terminated paths remain alive throughout the call.
    // Attempt exactly one native selection operation, with no retry or fallback.
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

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
pub(super) fn replace_selector(_staging: &Path, _active: &Path, _replace: bool) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "no approved selector replacement candidate on this platform",
    ))
}

#[cfg(test)]
#[path = "publication_platform_tests.rs"]
mod tests;
