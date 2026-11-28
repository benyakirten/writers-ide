//! Pure internal package declarations and dependency analysis. No installation,
//! imports, activation, permission grants, or Tauri commands are performed here.

pub(crate) mod model;
pub(crate) mod parse;
pub(crate) mod resolve;
pub(crate) mod version;

#[cfg(test)]
mod parse_tests;
#[cfg(test)]
mod resolve_tests;
