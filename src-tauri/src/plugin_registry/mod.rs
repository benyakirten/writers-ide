//! Internal persistent plugin records. No Tauri commands, installation or native authority.
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

// Application adapters are deliberately not wired in this foundation.
#[allow(unused_imports)]
pub(crate) use self::{
    error::{RegistryError, Result},
    location::LocationLease,
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
        Registry, RegistryCapacity, RegistryHandle, RegistryOwner, RegistrySession,
    },
};
