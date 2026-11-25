//! Internal integrity primitives for installed frontend packages.
//!
//! This module neither installs packages nor exposes Tauri commands. The host
//! must keep accepted records outside package directories. A future loader must
//! consume `VerifiedPackage` bytes instead of reopening the original paths.

mod filesystem;

use std::collections::BTreeMap;
use std::fmt;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const RECORD_VERSION: u32 = 1;

/// Resource budgets for one synchronous inspection or verification operation.
#[derive(Debug, Clone)]
pub(crate) struct IntegrityLimits {
    pub max_files: usize,
    pub max_file_bytes: u64,
    pub max_total_bytes: u64,
    pub max_path_bytes: usize,
    pub max_depth: usize,
}

impl Default for IntegrityLimits {
    fn default() -> Self {
        Self {
            max_files: 2048,
            max_file_bytes: 16 * 1024 * 1024,
            max_total_bytes: 64 * 1024 * 1024,
            max_path_bytes: 1024,
            max_depth: 16,
        }
    }
}

/// A candidate becomes trusted only through the host's explicit acceptance flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct IntegrityRecord {
    format_version: u32,
    files: BTreeMap<String, FileDigest>,
}

/// Database-independent file metadata. Construction does not verify file bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct IntegrityEntry {
    pub path: String,
    pub byte_length: u64,
    pub sha256: [u8; 32],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IntegrityBuildError<E> {
    Source(E),
    InvalidRecord(IntegrityError),
}

impl<E: fmt::Display> fmt::Display for IntegrityBuildError<E> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(error) => write!(formatter, "cannot read integrity entry: {error}"),
            Self::InvalidRecord(error) => error.fmt(formatter),
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for IntegrityBuildError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Source(error) => Some(error),
            Self::InvalidRecord(error) => Some(error),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
struct FileDigest {
    byte_length: u64,
    sha256: String,
}

impl<'de> Deserialize<'de> for IntegrityRecord {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fields {
            format_version: u32,
            #[serde(deserialize_with = "deserialize_unique_files")]
            files: BTreeMap<String, FileDigest>,
        }
        let fields: Fields = deserialize_object(deserializer)?;
        Ok(Self {
            format_version: fields.format_version,
            files: fields.files,
        })
    }
}

impl<'de> Deserialize<'de> for FileDigest {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fields {
            byte_length: u64,
            sha256: String,
        }
        let fields: Fields = deserialize_object(deserializer)?;
        Ok(Self {
            byte_length: fields.byte_length,
            sha256: fields.sha256,
        })
    }
}

// Serde's derived struct visitor also accepts positional arrays. Records use
// object fields only, while retaining duplicate-field checks in derived parsing.
fn deserialize_object<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    struct ObjectOnly<T>(std::marker::PhantomData<T>);
    impl<'de, T: Deserialize<'de>> serde::de::Visitor<'de> for ObjectOnly<T> {
        type Value = T;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("an object with named fields")
        }

        fn visit_map<M: serde::de::MapAccess<'de>>(self, map: M) -> Result<T, M::Error> {
            T::deserialize(serde::de::value::MapAccessDeserializer::new(map))
        }
    }
    deserializer.deserialize_map(ObjectOnly(std::marker::PhantomData))
}

impl IntegrityRecord {
    /// Validate incrementally, without collecting or reading beyond the first failure.
    pub(crate) fn from_entries<E>(
        version: u32,
        entries: impl IntoIterator<Item = Result<IntegrityEntry, E>>,
        limits: &IntegrityLimits,
    ) -> Result<Self, IntegrityBuildError<E>> {
        use IntegrityBuildError::{InvalidRecord, Source};
        if version != RECORD_VERSION {
            return Err(InvalidRecord(IntegrityError::UnsupportedVersion(version)));
        }
        let mut files = BTreeMap::new();
        let mut total = 0_u64;
        for entry in entries {
            let entry = entry.map_err(Source)?;
            if files.len() >= limits.max_files {
                return Err(InvalidRecord(limit("", "max_files")));
            }
            validate_entry(&entry.path, entry.byte_length, &mut total, limits)
                .map_err(InvalidRecord)?;
            if files.contains_key(&entry.path) {
                return Err(InvalidRecord(IntegrityError::MalformedRecord(
                    "duplicate package file path".to_owned(),
                )));
            }
            files.insert(
                entry.path,
                FileDigest {
                    byte_length: entry.byte_length,
                    sha256: encode_digest(entry.sha256),
                },
            );
        }
        Ok(Self {
            format_version: version,
            files,
        })
    }

    pub(crate) fn format_version(&self) -> u32 {
        self.format_version
    }

    /// Returns owned metadata; changing an item cannot change this record.
    pub(crate) fn entries(&self) -> impl ExactSizeIterator<Item = IntegrityEntry> + '_ {
        self.files.iter().map(|(path, digest)| IntegrityEntry {
            path: path.clone(),
            byte_length: digest.byte_length,
            sha256: decode_digest(&digest.sha256),
        })
    }

    /// Content identity under the frozen `writers-ide.file-set/1` encoding.
    pub(crate) fn fingerprint(&self) -> [u8; 32] {
        file_set_fingerprint(self.entries())
    }

    /// Parse host-supplied records, not a checksum file discovered in a package.
    pub(crate) fn from_json(
        bytes: &[u8],
        limits: &IntegrityLimits,
    ) -> Result<Self, IntegrityError> {
        // Bound parsing allocations before serde constructs strings and maps.
        let maximum = limits
            .max_path_bytes
            .saturating_add(128)
            .saturating_mul(limits.max_files)
            .saturating_add(512);
        if bytes.len() > maximum {
            return Err(limit("", "max_record_bytes"));
        }
        let record: Self = serde_json::from_slice(bytes)
            .map_err(|error| IntegrityError::MalformedRecord(error.to_string()))?;
        record.validate(limits)?;
        Ok(record)
    }

    pub(crate) fn to_json(&self) -> Result<Vec<u8>, IntegrityError> {
        serde_json::to_vec(self).map_err(|error| IntegrityError::MalformedRecord(error.to_string()))
    }

    fn validate(&self, limits: &IntegrityLimits) -> Result<(), IntegrityError> {
        if self.format_version != RECORD_VERSION {
            return Err(IntegrityError::UnsupportedVersion(self.format_version));
        }
        if self.files.len() > limits.max_files {
            return Err(limit("", "max_files"));
        }
        let mut total = 0_u64;
        for (path, digest) in &self.files {
            validate_entry(path, digest.byte_length, &mut total, limits)?;
            if digest.sha256.len() != 64
                || !digest
                    .sha256
                    .bytes()
                    .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
            {
                return Err(IntegrityError::MalformedRecord(format!(
                    "invalid lowercase SHA-256 digest for {path:?}"
                )));
            }
        }
        Ok(())
    }
}

/// Owned, verified bytes. No filesystem path is needed to consume these files.
#[derive(Debug)]
pub(crate) struct VerifiedPackage {
    files: BTreeMap<String, Vec<u8>>,
    fingerprint: [u8; 32],
    byte_length: u64,
}

impl VerifiedPackage {
    /// Content identity includes the complete, canonically ordered verified record.
    pub(crate) fn fingerprint(&self) -> [u8; 32] {
        self.fingerprint
    }

    /// Derive metadata from the retained verified buffers, never from source paths.
    pub(crate) fn integrity_record(
        &self,
        limits: &IntegrityLimits,
    ) -> Result<IntegrityRecord, IntegrityError> {
        record_from_bytes(&self.files, limits)
    }

    /// File payload bytes only; this does not measure allocation or runtime overhead.
    pub(crate) fn byte_length(&self) -> u64 {
        self.byte_length
    }

    pub(crate) fn file(&self, path: &str) -> Option<&[u8]> {
        self.files.get(path).map(Vec::as_slice)
    }

    pub(crate) fn paths(&self) -> impl Iterator<Item = &str> {
        self.files.keys().map(String::as_str)
    }
}

/// Inspect a host-selected directory for explicit installation acceptance.
/// This never writes a record, grants permissions, or authenticates a publisher.
pub(crate) fn create_record(
    root: &Path,
    limits: &IntegrityLimits,
) -> Result<IntegrityRecord, IntegrityError> {
    let files = filesystem::read_package(root, limits)?;
    record_from_bytes(&files, limits)
}

/// Verify against an already accepted host record and return only checked bytes.
pub(crate) fn verify_package(
    root: &Path,
    record: &IntegrityRecord,
    limits: &IntegrityLimits,
) -> Result<VerifiedPackage, IntegrityError> {
    record.validate(limits)?;
    let files = filesystem::read_package(root, limits)?;
    for path in record.files.keys() {
        if !files.contains_key(path) {
            return Err(IntegrityError::MissingFile(path.clone()));
        }
    }
    for path in files.keys() {
        if !record.files.contains_key(path) {
            return Err(IntegrityError::UnexpectedFile(path.clone()));
        }
    }
    let mut byte_length = 0_u64;
    for (path, bytes) in &files {
        let expected = &record.files[path];
        let actual_length = bytes.len() as u64;
        if expected.byte_length != actual_length {
            return Err(IntegrityError::LengthMismatch {
                path: path.clone(),
                expected: expected.byte_length,
                actual: actual_length,
            });
        }
        if sha256(bytes) != expected.sha256 {
            return Err(IntegrityError::DigestMismatch(path.clone()));
        }
        byte_length = byte_length
            .checked_add(actual_length)
            .ok_or_else(|| limit(path, "max_total_bytes"))?;
    }
    let fingerprint = record.fingerprint();
    Ok(VerifiedPackage {
        files,
        fingerprint,
        byte_length,
    })
}

fn record_from_bytes(
    files: &BTreeMap<String, Vec<u8>>,
    limits: &IntegrityLimits,
) -> Result<IntegrityRecord, IntegrityError> {
    let entries = files.iter().map(|(path, bytes)| {
        Ok::<_, std::convert::Infallible>(IntegrityEntry {
            path: path.clone(),
            byte_length: bytes.len() as u64,
            sha256: Sha256::digest(bytes).into(),
        })
    });
    IntegrityRecord::from_entries(RECORD_VERSION, entries, limits).map_err(|error| match error {
        IntegrityBuildError::InvalidRecord(error) => error,
        IntegrityBuildError::Source(never) => match never {},
    })
}

fn validate_entry(
    path: &str,
    byte_length: u64,
    total: &mut u64,
    limits: &IntegrityLimits,
) -> Result<(), IntegrityError> {
    validate_path(path, limits)?;
    if byte_length > limits.max_file_bytes {
        return Err(limit(path, "max_file_bytes"));
    }
    *total = total
        .checked_add(byte_length)
        .ok_or_else(|| limit(path, "max_total_bytes"))?;
    if *total > limits.max_total_bytes {
        return Err(limit(path, "max_total_bytes"));
    }
    Ok(())
}

fn encode_digest(digest: [u8; 32]) -> String {
    use std::fmt::Write;
    let mut encoded = String::with_capacity(64);
    for byte in digest {
        write!(encoded, "{byte:02x}").expect("writing to a String cannot fail");
    }
    encoded
}

fn decode_digest(digest: &str) -> [u8; 32] {
    // Records are private and validated before they are exposed to callers.
    std::array::from_fn(|index| {
        u8::from_str_radix(&digest[index * 2..index * 2 + 2], 16)
            .expect("record contains a validated SHA-256 digest")
    })
}

/// Entries must already be validated, unique and sorted by exact UTF-8 path bytes.
fn file_set_fingerprint(entries: impl ExactSizeIterator<Item = IntegrityEntry>) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"writers-ide.file-set/1\0");
    hash.update((entries.len() as u64).to_be_bytes());
    for entry in entries {
        hash.update((entry.path.len() as u64).to_be_bytes());
        hash.update(entry.path.as_bytes());
        hash.update(entry.byte_length.to_be_bytes());
        hash.update(entry.sha256);
    }
    hash.finalize().into()
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Portable slash-separated paths only. Never normalize an untrusted alias.
pub(crate) fn validate_path(path: &str, limits: &IntegrityLimits) -> Result<(), IntegrityError> {
    let invalid = |reason| IntegrityError::InvalidPath {
        path: path.to_owned(),
        reason,
    };
    if path.len() > limits.max_path_bytes {
        return Err(limit(path, "max_path_bytes"));
    }
    if path.is_empty() || path.starts_with('/') || path.contains('\\') {
        return Err(invalid(
            "expected a nonempty package-relative slash-separated path",
        ));
    }
    if path.chars().any(|character| {
        character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
    }) {
        return Err(invalid("path contains a nonportable character"));
    }
    let mut depth = 0;
    for component in path.split('/') {
        depth += 1;
        if depth > limits.max_depth {
            return Err(limit(path, "max_depth"));
        }
        if component.is_empty() || component == "." || component == ".." {
            return Err(invalid("empty, dot and parent components are forbidden"));
        }
        if component.ends_with([' ', '.']) {
            return Err(invalid("components must not end in a space or period"));
        }
        let stem = component.split('.').next().unwrap().to_ascii_uppercase();
        let port = stem
            .strip_prefix("COM")
            .or_else(|| stem.strip_prefix("LPT"));
        if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || port.is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        {
            return Err(invalid("reserved device names are forbidden"));
        }
    }
    Ok(())
}

fn deserialize_unique_files<'de, D>(
    deserializer: D,
) -> Result<BTreeMap<String, FileDigest>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    struct UniqueFiles;
    impl<'de> serde::de::Visitor<'de> for UniqueFiles {
        type Value = BTreeMap<String, FileDigest>;

        fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
            formatter.write_str("a file map with unique package-relative paths")
        }

        fn visit_map<M>(self, mut map: M) -> Result<Self::Value, M::Error>
        where
            M: serde::de::MapAccess<'de>,
        {
            let mut files = BTreeMap::new();
            loop {
                let next = map.next_entry::<String, FileDigest>()?;
                let Some((path, digest)) = next else {
                    break;
                };
                let previous = files.insert(path, digest);
                if previous.is_some() {
                    return Err(serde::de::Error::custom("duplicate package file path"));
                }
            }
            Ok(files)
        }
    }
    deserializer.deserialize_map(UniqueFiles)
}

fn limit(path: &str, limit: &'static str) -> IntegrityError {
    IntegrityError::LimitExceeded {
        path: path.to_owned(),
        limit,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum IntegrityError {
    MalformedRecord(String),
    UnsupportedVersion(u32),
    InvalidPath {
        path: String,
        reason: &'static str,
    },
    Filesystem {
        path: String,
        reason: String,
    },
    LimitExceeded {
        path: String,
        limit: &'static str,
    },
    MissingFile(String),
    UnexpectedFile(String),
    LengthMismatch {
        path: String,
        expected: u64,
        actual: u64,
    },
    DigestMismatch(String),
}

impl fmt::Display for IntegrityError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::MalformedRecord(reason) => {
                write!(formatter, "invalid integrity record: {reason}")
            }
            Self::UnsupportedVersion(version) => {
                write!(formatter, "unsupported integrity record version: {version}")
            }
            Self::InvalidPath { path, reason } => {
                write!(formatter, "invalid package path {path:?}: {reason}")
            }
            Self::Filesystem { path, reason } => {
                write!(formatter, "cannot read package path {path:?}: {reason}")
            }
            Self::LimitExceeded { path, limit } => {
                write!(formatter, "package path {path:?} exceeds {limit}")
            }
            Self::MissingFile(path) => write!(formatter, "missing package file: {path:?}"),
            Self::UnexpectedFile(path) => write!(formatter, "unexpected package file: {path:?}"),
            Self::LengthMismatch {
                path,
                expected,
                actual,
            } => write!(
                formatter,
                "package file {path:?} has {actual} bytes, expected {expected}"
            ),
            Self::DigestMismatch(path) => {
                write!(formatter, "SHA-256 mismatch for package file: {path:?}")
            }
        }
    }
}

impl std::error::Error for IntegrityError {}

#[cfg(test)]
mod tests;
