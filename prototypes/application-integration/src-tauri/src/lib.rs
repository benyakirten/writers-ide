#![allow(dead_code)]
pub mod campaign;
mod commands;
#[cfg(test)]
mod native_tests;
mod owned;
#[path = "../../../../src-tauri/src/plugin_integrity/mod.rs"]
pub(crate) mod plugin_integrity;
#[path = "../../../../src-tauri/src/plugin_manifest/mod.rs"]
pub(crate) mod plugin_manifest;
#[path = "../../../../src-tauri/src/plugin_registry/mod.rs"]
pub(crate) mod plugin_registry;
#[path = "../../../../src-tauri/src/plugin_resources/mod.rs"]
pub(crate) mod plugin_resources;
mod policy;
mod replacement;
mod replacement_shell;
mod resources;
mod router;
mod transport;
mod windows;
mod wire;
mod workspace_denial;
