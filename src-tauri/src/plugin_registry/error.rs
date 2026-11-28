use std::{error::Error, fmt};

pub(crate) type Result<T> = std::result::Result<T, RegistryError>;

#[derive(Debug)]
pub(crate) enum RegistryError {
    InvalidInput(String),
    NotFound(String),
    Conflict(String),
    VersionConflict(String),
    LimitExceeded(String),
    Unavailable(String),
    Storage(Box<dyn Error + Send + Sync>),
    RecoveryRequired(String),
    OutcomeUnknown(String),
}

impl fmt::Display for RegistryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidInput(s) => write!(f, "invalid registry input: {s}"),
            Self::NotFound(s) => write!(f, "registry record not found: {s}"),
            Self::Conflict(s) => write!(f, "registry state changed: {s}"),
            Self::VersionConflict(s) => write!(f, "accepted version conflict: {s}"),
            Self::LimitExceeded(s) => write!(f, "registry limit exceeded: {s}"),
            Self::Unavailable(s) => write!(f, "registry unavailable: {s}"),
            Self::Storage(e) => write!(f, "registry storage failed: {e}"),
            Self::RecoveryRequired(s) => write!(f, "registry recovery required: {s}"),
            Self::OutcomeUnknown(s) => write!(f, "registry outcome unknown: {s}"),
        }
    }
}

impl Error for RegistryError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Storage(error) => Some(error.as_ref()),
            _ => None,
        }
    }
}

impl From<rusqlite::Error> for RegistryError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Storage(Box::new(error))
    }
}

impl From<std::io::Error> for RegistryError {
    fn from(error: std::io::Error) -> Self {
        Self::Storage(Box::new(error))
    }
}
