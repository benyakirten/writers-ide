//! Internal ownership and admission accounting for verified package snapshots.
//!
//! A future application owner must keep one pool and serialize access to it.
//! Only trusted host code may open WebView handles or associate snapshots. A
//! future Tauri adapter must resolve the actual requesting WebView to its live
//! handle; a label or handle claimed by frontend code is not authoritative.
//! This module registers no resource protocol or IPC commands.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::sync::Arc;

use crate::plugin_integrity::VerifiedPackage;

pub(crate) mod route;

#[cfg(test)]
mod route_tests;

/// Host-supplied limits. Production defaults have not been selected.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SnapshotLimits {
    pub max_snapshots: usize,
    pub max_retained_bytes: u64,
}

/// Counts retained file payloads, not allocation overhead or browser memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SnapshotUsage {
    pub snapshots: usize,
    pub retained_bytes: u64,
}

/// A content identity, not a resource URL contract or permission credential.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct SnapshotId([u8; 32]);

impl SnapshotId {
    pub(crate) fn to_hex(self) -> String {
        use std::fmt::Write;
        let mut result = String::with_capacity(64);
        for byte in self.0 {
            write!(result, "{byte:02x}").expect("writing to a String");
        }
        result
    }

    pub(crate) fn from_hex(value: &str) -> Option<Self> {
        if value.len() != 64
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return None;
        }
        let mut bytes = [0; 32];
        for (index, byte) in bytes.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).ok()?;
        }
        Some(Self(bytes))
    }
}

/// One host-established WebView lifetime. Handles cannot be deserialized or
/// constructed from window labels. A reopened WebView must get a new handle.
#[derive(Debug, Clone)]
pub(crate) struct WebViewHandle {
    pool: Arc<()>,
    sequence: u64,
}

struct Snapshot {
    package: VerifiedPackage,
    views: BTreeSet<u64>,
}

pub(crate) struct SnapshotPool {
    identity: Arc<()>,
    next_view: u64,
    views: BTreeMap<u64, BTreeSet<SnapshotId>>,
    snapshots: BTreeMap<SnapshotId, Snapshot>,
    retained_bytes: u64,
    limits: SnapshotLimits,
}

impl SnapshotPool {
    pub(crate) fn new(limits: SnapshotLimits) -> Self {
        Self {
            identity: Arc::new(()),
            next_view: 0,
            views: BTreeMap::new(),
            snapshots: BTreeMap::new(),
            retained_bytes: 0,
            limits,
        }
    }

    /// Called by the host for a plugin-hosting WebView, never by plugin code.
    /// Management/recovery WebViews must not be registered here.
    pub(crate) fn open_webview(&mut self) -> Result<WebViewHandle, SnapshotError> {
        let sequence = self
            .next_view
            .checked_add(1)
            .ok_or(SnapshotError::IdentifierExhausted)?;
        self.next_view = sequence;
        self.views.insert(sequence, BTreeSet::new());
        Ok(WebViewHandle {
            pool: Arc::clone(&self.identity),
            sequence,
        })
    }

    /// Admit only already verified bytes. Repeated content shares its existing
    /// allocation. Any rejected admission leaves usage and associations intact.
    pub(crate) fn admit(
        &mut self,
        view: &WebViewHandle,
        package: VerifiedPackage,
    ) -> Result<SnapshotId, SnapshotError> {
        self.check_view(view)?;
        let id = SnapshotId(package.fingerprint());
        if !self.snapshots.contains_key(&id) {
            if self.snapshots.len() >= self.limits.max_snapshots {
                return Err(SnapshotError::LimitExceeded(SnapshotLimit::Snapshots));
            }
            let retained_bytes = self
                .retained_bytes
                .checked_add(package.byte_length())
                .filter(|total| *total <= self.limits.max_retained_bytes)
                .ok_or(SnapshotError::LimitExceeded(SnapshotLimit::RetainedBytes))?;
            self.snapshots.insert(
                id,
                Snapshot {
                    package,
                    views: BTreeSet::new(),
                },
            );
            self.retained_bytes = retained_bytes;
        }
        self.views
            .get_mut(&view.sequence)
            .expect("validated WebView")
            .insert(id);
        self.snapshots
            .get_mut(&id)
            .expect("admitted snapshot")
            .views
            .insert(view.sequence);
        Ok(id)
    }

    /// Borrow from retained storage only after checking the host association.
    /// Exact file lookup does not normalize paths or fall back to a filesystem.
    pub(crate) fn file(
        &self,
        view: &WebViewHandle,
        id: SnapshotId,
        path: &str,
    ) -> Result<&[u8], SnapshotError> {
        self.check_view(view)?;
        let snapshot = self
            .snapshots
            .get(&id)
            .ok_or(SnapshotError::SnapshotUnavailable)?;
        if !snapshot.views.contains(&view.sequence) {
            return Err(SnapshotError::AccessDenied);
        }
        snapshot
            .package
            .file(path)
            .ok_or(SnapshotError::FileNotFound)
    }

    /// Called on actual WebView closure, not plugin disablement. Repeated close
    /// is harmless. No bytes leave the pool while another WebView retains them.
    pub(crate) fn close_webview(&mut self, view: &WebViewHandle) -> Result<(), SnapshotError> {
        if !Arc::ptr_eq(&self.identity, &view.pool) {
            return Err(SnapshotError::WebViewUnavailable);
        }
        let associated = self.views.remove(&view.sequence);
        if let Some(associated) = associated {
            for id in associated {
                let snapshot = self.snapshots.get_mut(&id).expect("associated snapshot");
                snapshot.views.remove(&view.sequence);
                if snapshot.views.is_empty() {
                    let snapshot = self.snapshots.remove(&id).expect("unreferenced snapshot");
                    self.retained_bytes -= snapshot.package.byte_length();
                }
            }
        }
        Ok(())
    }

    pub(crate) fn usage(&self) -> SnapshotUsage {
        SnapshotUsage {
            snapshots: self.snapshots.len(),
            retained_bytes: self.retained_bytes,
        }
    }

    fn check_view(&self, view: &WebViewHandle) -> Result<(), SnapshotError> {
        if !Arc::ptr_eq(&self.identity, &view.pool) || !self.views.contains_key(&view.sequence) {
            return Err(SnapshotError::WebViewUnavailable);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotLimit {
    Snapshots,
    RetainedBytes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SnapshotError {
    WebViewUnavailable,
    SnapshotUnavailable,
    AccessDenied,
    FileNotFound,
    LimitExceeded(SnapshotLimit),
    IdentifierExhausted,
}

impl fmt::Display for SnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = match self {
            Self::WebViewUnavailable => "plugin-hosting WebView is unavailable",
            Self::SnapshotUnavailable => "verified package snapshot is unavailable",
            Self::AccessDenied => "WebView is not associated with this snapshot",
            Self::FileNotFound => "file is not in the verified snapshot",
            Self::LimitExceeded(SnapshotLimit::Snapshots) => {
                "retained snapshot count limit exceeded"
            }
            Self::LimitExceeded(SnapshotLimit::RetainedBytes) => {
                "retained snapshot byte limit exceeded"
            }
            Self::IdentifierExhausted => "WebView lifetime identifiers exhausted",
        };
        formatter.write_str(message)
    }
}

impl std::error::Error for SnapshotError {}

#[cfg(test)]
mod tests;
