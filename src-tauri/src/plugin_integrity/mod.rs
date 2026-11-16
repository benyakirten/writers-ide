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
            validate_path(path, limits)?;
            if digest.byte_length > limits.max_file_bytes {
                return Err(limit(path, "max_file_bytes"));
            }
            total = total
                .checked_add(digest.byte_length)
                .ok_or_else(|| limit(path, "max_total_bytes"))?;
            if total > limits.max_total_bytes {
                return Err(limit(path, "max_total_bytes"));
            }
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
}

impl VerifiedPackage {
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
    let record = IntegrityRecord {
        format_version: RECORD_VERSION,
        files: files
            .iter()
            .map(|(path, bytes)| {
                (
                    path.clone(),
                    FileDigest {
                        byte_length: bytes.len() as u64,
                        sha256: sha256(bytes),
                    },
                )
            })
            .collect(),
    };
    record.validate(limits)?;
    Ok(record)
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
    }
    Ok(VerifiedPackage { files })
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Portable slash-separated paths only. Never normalize an untrusted alias.
fn validate_path(path: &str, limits: &IntegrityLimits) -> Result<(), IntegrityError> {
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
