//! Internal persistent plugin records. No Tauri commands, installation or native authority.
mod bootstrap;
pub(crate) mod command_resource_settings;
mod error;
mod generation;
mod location;
mod migrations;
mod model;
mod preparation;
mod publication_platform;
#[cfg(test)]
mod publication_probe;
#[cfg(test)]
mod qualification_evidence;
mod recovery;
mod schema;
mod selector;
mod store;
mod transitions;
mod worker;

// Internal host adapters remain disconnected from normal application startup.
#[allow(unused_imports)]
pub(crate) use self::{
    bootstrap::{BootstrapFailure, SelectedRegistry, SelectedRegistryOpening},
    error::{RegistryError, Result},
    location::{LocationAcquireError, LocationLease},
    model::*,
    preparation::*,
    store::ArtifactTarget,
    transitions::{InstallationAction, InstallationExpectation},
    worker::{
        lifecycle::{
            LifecycleObserver, LifecyclePhase, LifecycleRevision, LifecycleSnapshot,
            MaintenanceOutcome, MaintenanceRequest, RecoveryCause, RecoveryKind, RegistryControl,
            ServiceValidityObserver, StopReason,
        },
        OpeningCleanup, OpeningFailure, Registry, RegistryCapacity, RegistryHandle,
        RegistryOpening, RegistryOwner, RegistrySession,
    },
};
