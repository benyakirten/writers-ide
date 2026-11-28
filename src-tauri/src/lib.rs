// Internal foundation only; the installer and verified-byte loader are not wired yet.
#[allow(dead_code)]
mod plugin_integrity;

// Pure declarations and static dependency analysis; no external execution is enabled.
#[allow(dead_code)]
mod plugin_manifest;

// No runtime owner or resource routes are connected in this internal slice.
#[allow(dead_code)]
mod plugin_resources;

// Persistent internal records only; no installer, credentials or application wiring.
#[allow(dead_code)]
mod plugin_registry;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
