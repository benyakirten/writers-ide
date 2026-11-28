//! Host-only startup selection. No frontend paths, initialization or fallback search.
use std::{fs, path::Path};

use super::{
    location::{LocationAcquireError, LocationLease},
    selector, OpeningFailure, Registry, RegistryCapacity, RegistryError, RegistryLimits,
    RegistryOpening,
};

pub(crate) struct SelectedRegistry;
pub(crate) struct SelectedRegistryOpening {
    /// Retain this independently through opening, recovery UI and awaited cleanup.
    pub location: LocationLease,
    pub opening: RegistryOpening,
}
pub(crate) enum BootstrapFailure {
    OwnershipUnavailable(LocationAcquireError),
    InitializationBlocked {
        location: LocationLease,
    },
    RecoveryRequired {
        location: LocationLease,
        error: RegistryError,
    },
    Opening {
        location: LocationLease,
        failure: OpeningFailure,
    },
}
impl SelectedRegistry {
    /// Run on blocking host work. The host prepares only the stable parent and
    /// supplies its own root. Selection failures never spawn a registry worker.
    /// This schema-2-only adapter never chooses an upgrade backup destination.
    pub(crate) fn begin(
        root: &Path,
        limits: RegistryLimits,
        capacity: RegistryCapacity,
    ) -> std::result::Result<SelectedRegistryOpening, BootstrapFailure> {
        let location = LocationLease::acquire_detailed(root)
            .map_err(BootstrapFailure::OwnershipUnavailable)?;
        match fs::symlink_metadata(location.root()) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(BootstrapFailure::InitializationBlocked { location });
            }
            Err(error) => {
                return Err(BootstrapFailure::RecoveryRequired {
                    location,
                    error: error.into(),
                });
            }
            Ok(_) => {}
        }
        let selection =
            selector::read(&location).and_then(|id| selector::validate_generation(&location, id));
        let path = match selection {
            Ok(path) => path,
            Err(error) => return Err(BootstrapFailure::RecoveryRequired { location, error }),
        };
        match Registry::begin_owned(location.clone(), path, limits, capacity) {
            Ok(opening) => Ok(SelectedRegistryOpening { location, opening }),
            Err(failure) => Err(BootstrapFailure::Opening { location, failure }),
        }
    }
}

#[cfg(test)]
#[path = "bootstrap_tests.rs"]
mod tests;
