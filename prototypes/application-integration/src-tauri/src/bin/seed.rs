#![allow(dead_code, unused_imports)]
#[path = "../owned.rs"]
mod owned;
#[path = "../../../../../src-tauri/src/plugin_integrity/mod.rs"]
mod plugin_integrity;
#[path = "../../../../../src-tauri/src/plugin_manifest/mod.rs"]
mod plugin_manifest;
#[path = "../seed_modules.rs"]
mod plugin_registry;
fn main() {
    let result = owned::OwnedParent::arguments().and_then(|parent| {
        if parent.inspect || parent.resource_denial_policy {
                    return Err("seed accepts only --parent and --run-id".into());
                }
        plugin_registry::seed(&parent.root()).map_err(|e| e.to_string())?;
        plugin_registry::seed(&parent.replacement_root()).map_err(|e| e.to_string())?;
        println!("APPLICATION_INTEGRATION_SEED {{\"schema\":2,\"closed\":true,\"preseeded\":true,\"replacementPreseeded\":true,\"replacementRevision\":\"0\",\"publicationAttempted\":false,\"runId\":\"{}\"}}", parent.run_id);
        Ok(())
    });
    if let Err(error) = result {
        eprintln!("seed refused: {error}");
        std::process::exit(1);
    }
}
