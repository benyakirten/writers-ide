//! Internal persistent plugin records. No Tauri commands, installation or native authority.
mod error;
mod migrations;
mod model;
mod preparation;
#[cfg(test)]
mod publication_probe;
mod recovery;
mod schema;
mod store;
mod transitions;
mod worker;

// Application adapters are deliberately not wired in this foundation.
#[allow(unused_imports)]
pub(crate) use self::{
    error::{RegistryError, Result},
    model::*,
    preparation::*,
    store::ArtifactTarget,
    transitions::{InstallationAction, InstallationExpectation},
    worker::{Registry, RegistryHandle, RegistryOwner, RegistrySession},
};
