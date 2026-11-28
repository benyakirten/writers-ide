//! Private version-1 selection metadata. Reading never repairs or selects a fallback.
use std::{
    io::Read,
    path::{Path, PathBuf},
};

#[cfg(unix)]
use cap_fs_ext::OpenOptionsSyncExt;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, File, Metadata, OpenOptions};
use sha2::{Digest, Sha256};

use super::{
    error::{RegistryError, Result},
    location::LocationLease,
};

#[cfg(test)]
#[path = "selector_tests.rs"]
mod tests;

pub(super) const ACTIVE: &str = "active";
const HEADER: &[u8; 16] = b"WIDE-REGISTRY-1\n";
const RECORD_LENGTH: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct GenerationId([u8; 16]);

impl GenerationId {
    pub(super) fn random() -> Result<Self> {
        let mut bytes = [0; 16];
        getrandom::fill(&mut bytes).map_err(|error| {
            RegistryError::Unavailable(format!("generation randomness: {error}"))
        })?;
        Ok(Self(bytes))
    }

    #[cfg(test)]
    pub(super) fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(bytes)
    }

    pub(super) fn name(self) -> String {
        const HEX: &[u8; 16] = b"0123456789abcdef";
        let mut name = String::with_capacity(32);
        for byte in self.0 {
            name.push(HEX[usize::from(byte >> 4)] as char);
            name.push(HEX[usize::from(byte & 15)] as char);
        }
        name
    }

    pub(super) fn directory(self, lease: &LocationLease) -> PathBuf {
        lease.root().join(self.name())
    }

    pub(super) fn database_path(self, lease: &LocationLease) -> PathBuf {
        self.directory(lease).join("registry.sqlite")
    }
}

pub(super) fn encode(id: GenerationId) -> [u8; RECORD_LENGTH] {
    let mut bytes = [0; RECORD_LENGTH];
    bytes[..16].copy_from_slice(HEADER);
    bytes[16..32].copy_from_slice(&id.0);
    let digest = Sha256::digest(&bytes[..32]);
    bytes[32..].copy_from_slice(&digest);
    bytes
}

pub(super) fn decode(bytes: &[u8]) -> Result<GenerationId> {
    if bytes.len() != RECORD_LENGTH {
        return Err(recovery("expected exactly 64 bytes"));
    }
    if &bytes[..16] != HEADER {
        return Err(recovery("unknown format or version"));
    }
    if Sha256::digest(&bytes[..32])[..] != bytes[32..] {
        return Err(recovery("checksum mismatch"));
    }
    let mut id = [0; 16];
    id.copy_from_slice(&bytes[16..32]);
    Ok(GenerationId(id))
}

pub(super) fn read(lease: &LocationLease) -> Result<GenerationId> {
    let directory = open_root(lease)?;
    let file = open_regular_file(&directory, ACTIVE)?;
    let mut bytes = Vec::with_capacity(RECORD_LENGTH + 1);
    file.take((RECORD_LENGTH + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| recovery(format!("cannot read active record: {error}")))?;
    decode(&bytes)
}

/// Call only while the database is closed or sealed, before opening SQLite.
/// This validates the owned layout, not database contents or platform durability.
pub(super) fn validate_generation(lease: &LocationLease, id: GenerationId) -> Result<PathBuf> {
    {
        let root = open_root(lease)?;
        let generation = open_directory(&root, Path::new(&id.name()), "generation")?;
        let _database = open_regular_file(&generation, "registry.sqlite")?;
        // Close the raw database handle before the caller opens SQLite. On Unix,
        // closing another handle to a live database can release process locks.
    }
    // Every lookup used a fixed local component beneath the leased root. This
    // is cooperative validation, not protection against later native mutation.
    Ok(id.database_path(lease))
}

fn open_root(lease: &LocationLease) -> Result<Dir> {
    let root = lease.root();
    let name = root
        .file_name()
        .ok_or_else(|| recovery("root must name a directory"))?;
    let parent = root
        .parent()
        .ok_or_else(|| recovery("root requires a stable parent"))?;
    // Only the leased, canonical stable parent uses ambient authority. Opening
    // the root relative to it prevents following a root symlink first.
    let parent = Dir::open_ambient_dir(parent, cap_std::ambient_authority())
        .map_err(|error| recovery(format!("cannot open stable parent: {error}")))?;
    open_directory(&parent, Path::new(name), "root")
}

fn open_directory(parent: &Dir, name: &Path, label: &str) -> Result<Dir> {
    let directory = parent
        .open_dir_nofollow(name)
        .map_err(|error| recovery(format!("cannot open {label}: {error}")))?;
    let metadata = directory
        .dir_metadata()
        .map_err(|error| recovery(format!("cannot inspect {label}: {error}")))?;
    reject_link(&metadata)?;
    if !metadata.is_dir() {
        return Err(recovery(format!("{label} is not a directory")));
    }
    Ok(directory)
}

fn open_regular_file(directory: &Dir, name: &str) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    // Check the opened handle, not a path classification that can become stale.
    // Nonblocking open prevents a substituted FIFO from waiting for a writer.
    #[cfg(unix)]
    options.nonblock(true);
    let file = directory
        .open_with(name, &options)
        .map_err(|error| recovery(format!("cannot open {name}: {error}")))?;
    let metadata = file
        .metadata()
        .map_err(|error| recovery(format!("cannot inspect {name}: {error}")))?;
    reject_link(&metadata)?;
    if !metadata.is_file() {
        return Err(recovery(format!("{name} is not a regular file")));
    }
    Ok(file)
}

fn reject_link(metadata: &Metadata) -> Result<()> {
    if metadata.file_type().is_symlink() {
        return Err(recovery("symbolic links are not allowed"));
    }
    #[cfg(windows)]
    {
        use cap_fs_ext::OsMetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(recovery("reparse points are not allowed"));
        }
    }
    Ok(())
}

fn recovery(reason: impl std::fmt::Display) -> RegistryError {
    RegistryError::RecoveryRequired(format!("registry selector: {reason}"))
}
