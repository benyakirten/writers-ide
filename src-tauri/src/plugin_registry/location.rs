//! Exclusive registry-location ownership. This neither initializes nor selects storage.
use std::{
    fs::{self, File, OpenOptions},
    path::{Component, Path, PathBuf},
    sync::Arc,
};

use super::error::{RegistryError, Result};

#[derive(Clone)]
pub(crate) struct LocationLease {
    root: PathBuf,
    guard: Arc<File>,
}

#[derive(Debug)]
pub(crate) enum LocationAcquireError {
    Contended,
    LockFailed(std::io::Error),
    OpenFailed(RegistryError),
}
impl LocationAcquireError {
    fn into_registry_error(self) -> RegistryError {
        match self {
            Self::Contended => RegistryError::Unavailable("registry location already owned".into()),
            Self::LockFailed(error) => {
                RegistryError::Unavailable(format!("registry location lock failed: {error}"))
            }
            Self::OpenFailed(error) => error,
        }
    }
}

impl From<RegistryError> for LocationAcquireError {
    fn from(error: RegistryError) -> Self {
        Self::OpenFailed(error)
    }
}
impl From<std::io::Error> for LocationAcquireError {
    fn from(error: std::io::Error) -> Self {
        Self::OpenFailed(error.into())
    }
}

impl LocationLease {
    /// Call from blocking host work. The stable parent must already exist.
    /// Acquiring ownership never creates or inspects the dedicated root.
    pub(crate) fn acquire(root: &Path) -> Result<Self> {
        Self::acquire_detailed(root).map_err(LocationAcquireError::into_registry_error)
    }

    pub(crate) fn acquire_detailed(root: &Path) -> std::result::Result<Self, LocationAcquireError> {
        let name = root.file_name().ok_or_else(|| {
            RegistryError::InvalidInput("registry root must have a local directory name".into())
        })?;
        if !matches!(root.components().next_back(), Some(Component::Normal(_))) {
            return Err(RegistryError::InvalidInput("invalid registry root".into()).into());
        }
        let parent = root
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| {
                RegistryError::InvalidInput("registry root requires a stable parent".into())
            })?
            .canonicalize()?;
        let mut lock_name = name.to_os_string();
        lock_name.push(".location-lock");
        let lock = parent.join(lock_name);
        match fs::symlink_metadata(&lock) {
            Ok(metadata) if !metadata.is_file() => {
                return Err(RegistryError::RecoveryRequired(
                    "registry location lock is not a regular file".into(),
                )
                .into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        let guard = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock)?;
        guard.try_lock().map_err(classify_lock_error)?;
        Ok(Self {
            root: parent.join(name),
            guard: Arc::new(guard),
        })
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    #[cfg(test)]
    pub(super) fn guard(&self) -> Arc<File> {
        self.guard.clone()
    }

    pub(super) fn same_owner(&self, other: &Self) -> bool {
        self.root == other.root && Arc::ptr_eq(&self.guard, &other.guard)
    }

    pub(super) fn check_database(&self, path: &Path) -> Result<PathBuf> {
        if !fs::symlink_metadata(&self.root)?.is_dir() {
            return Err(RegistryError::RecoveryRequired(
                "registry root is not a directory".into(),
            ));
        }
        let path = path.canonicalize()?;
        if !path.starts_with(&self.root) || !fs::metadata(&path)?.is_file() {
            return Err(RegistryError::InvalidInput(
                "registry database is outside the owned root".into(),
            ));
        }
        Ok(path)
    }
}

fn classify_lock_error(error: std::fs::TryLockError) -> LocationAcquireError {
    match error {
        std::fs::TryLockError::WouldBlock => LocationAcquireError::Contended,
        std::fs::TryLockError::Error(error) => LocationAcquireError::LockFailed(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detailed_lock_errors_do_not_mislabel_io_failure_as_contention() {
        assert!(matches!(
            classify_lock_error(std::fs::TryLockError::WouldBlock),
            LocationAcquireError::Contended
        ));
        let error = std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "injected lock failure",
        );
        match classify_lock_error(std::fs::TryLockError::Error(error)) {
            LocationAcquireError::LockFailed(error) => {
                assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied)
            }
            _ => panic!("expected lock I/O failure"),
        }
    }

    #[test]
    fn lease_precedes_root_detection_and_is_shared_until_last_owner() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("registry");
        let lease = LocationLease::acquire(&root).unwrap();
        assert!(!root.exists());
        assert!(matches!(
            LocationLease::acquire(&root),
            Err(RegistryError::Unavailable(_))
        ));
        let copy = lease.clone();
        drop(lease);
        assert!(LocationLease::acquire(&root).is_err());
        drop(copy);
        let _next = LocationLease::acquire(&root).unwrap();
        assert!(!root.exists());
    }

    #[test]
    fn existing_empty_root_is_not_initialized() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("registry");
        fs::create_dir(&root).unwrap();
        let lease = LocationLease::acquire(&root).unwrap();
        assert!(lease.check_database(&root.join("missing")).is_err());
        assert_eq!(fs::read_dir(root).unwrap().count(), 0);
    }

    #[test]
    fn refuses_nonregular_lock_without_replacing_it() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("registry");
        fs::create_dir(parent.path().join("registry.location-lock")).unwrap();
        assert!(matches!(
            LocationLease::acquire(&root),
            Err(RegistryError::RecoveryRequired(_))
        ));
        assert!(!root.exists());
    }
}
