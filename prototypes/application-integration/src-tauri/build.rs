use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
};
fn collect(root: &Path, files: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(root).expect("attribution source directory") {
        let path = entry.expect("source entry").path();
        let metadata = fs::symlink_metadata(&path).expect("source metadata");
        assert!(!metadata.is_symlink(), "no source attribution symlinks");
        if metadata.is_dir() {
            collect(&path, files);
        } else {
            files.push(path);
        }
    }
}
fn fingerprint(name: &str, roots: &[&str]) {
    let mut files = Vec::new();
    for root in roots {
        let path = Path::new(root);
        if path.is_dir() {
            collect(path, &mut files);
        } else {
            files.push(path.to_owned());
        }
    }
    files.sort();
    let mut digest = Sha256::new();
    for file in files {
        println!("cargo:rerun-if-changed={}", file.display());
        let path = file.to_str().expect("UTF-8 source path").as_bytes();
        let bytes = fs::read(&file).expect("attribution source bytes");
        digest.update((path.len() as u64).to_be_bytes());
        digest.update(path);
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    println!("cargo:rustc-env={name}={:x}", digest.finalize());
}
fn main() {
    fingerprint(
        "FIXTURE_NATIVE_SHA256",
        &[
            "src",
            "permissions",
            "build.rs",
            "Cargo.toml",
            "Cargo.lock",
            "tauri.conf.json",
            "../../../src-tauri/src/plugin_registry",
            "../../../src-tauri/src/plugin_integrity",
            "../../../src-tauri/src/plugin_manifest",
            "../../../src-tauri/src/plugin_resources",
        ],
    );
    fingerprint("FIXTURE_FRONTEND_SHA256", &["../dist"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "session_handshake",
            "bootstrap_status",
            "settings_read",
            "settings_save",
            "settings_result",
            "settings_application_status",
            "settings_attach",
            "settings_attachment_read",
            "settings_ack",
            "settings_renew",
            "settings_detach",
            "fixture_report",
        ]),
    ))
    .expect("build isolated fixture");
}
