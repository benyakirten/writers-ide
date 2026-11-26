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

impl LocationLease {
    /// Call from blocking host work. The stable parent must already exist.
    /// Acquiring ownership never creates or inspects the dedicated root.
    pub(crate) fn acquire(root: &Path) -> Result<Self> {
        let name = root.file_name().ok_or_else(|| {
            RegistryError::InvalidInput("registry root must have a local directory name".into())
        })?;
        if !matches!(root.components().next_back(), Some(Component::Normal(_))) {
            return Err(RegistryError::InvalidInput("invalid registry root".into()));
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
                ));
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
        guard.try_lock().map_err(|error| {
            RegistryError::Unavailable(format!("registry location already owned: {error}"))
        })?;
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

#[cfg(test)]
mod tests {
    use super::*;

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
