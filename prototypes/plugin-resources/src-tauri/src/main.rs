use std::{io::Write, sync::Arc, time::Duration};

use serde_json::{json, Value};
use tauri::{WebviewUrl, WebviewWindowBuilder};

// Keep the internal integrity API in this crate; no production visibility change.
#[allow(dead_code)]
#[path = "../../../../src-tauri/src/plugin_integrity/mod.rs"]
mod plugin_integrity;
mod portable;
mod reporting;
mod resources;

use plugin_integrity::{verify_package, IntegrityLimits, IntegrityRecord, VerifiedPackage};
use resources::{Resources, BASE_ORIGIN};

include!(concat!(env!("OUT_DIR"), "/fixture_manifest.rs"));

fn limits() -> IntegrityLimits {
    IntegrityLimits {
        max_files: 512,
        max_file_bytes: 8 * 1024 * 1024,
        max_total_bytes: 32 * 1024 * 1024,
        max_path_bytes: portable::MAX_PATH,
        max_depth: 16,
    }
}

fn extract_and_verify() -> Result<VerifiedPackage, Box<dyn std::error::Error>> {
    let limits = limits();
    let record = IntegrityRecord::from_json(ACCEPTED_RECORD, &limits)?;
    let source = tempfile::tempdir()?;
    for (path, bytes) in EMBEDDED_FILES {
        if !portable::portable_path(path) {
            return Err("invalid embedded fixture path".into());
        }
        let destination = source.path().join(path);
        std::fs::create_dir_all(destination.parent().ok_or("missing parent")?)?;
        std::fs::write(destination, bytes)?;
    }
    let package = verify_package(source.path(), &record, &limits)?;
    source.close()?;
    Ok(package)
}

#[tauri::command]
fn finish(window: tauri::WebviewWindow, report: Value) -> Result<(), String> {
    reporting::validate(window.label(), &report)?;
    emit_and_exit(report)
}

fn emit_and_exit(report: Value) -> ! {
    if reporting::claim_completion() {
        let code = if report.get("ok").and_then(Value::as_bool) == Some(true) {
            0
        } else {
            1
        };
        let mut stdout = std::io::stdout().lock();
        let _ = writeln!(stdout, "RESOURCE_PROTOTYPE_RESULT {report}");
        let _ = stdout.flush();
        // The bounded harness must also terminate workers and a frozen WebView.
        std::process::exit(code);
    }
    loop {
        std::thread::park();
    }
}

fn main() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(30));
        emit_and_exit(json!({"ok": false, "error": "native-watchdog-timeout"}));
    });
    let recovery = std::env::args().any(|arg| arg == "--recovery");
    // Verification is synchronous before the event loop and WebView exist.
    let package = match extract_and_verify() {
        Ok(package) => package,
        Err(_) => {
            emit_and_exit(json!({"ok": false, "error": "embedded-fixture-verification-failed"}))
        }
    };
    let resources = Arc::new(Resources::new(package));
    let initialization = format!(
        "window.__RESOURCE_PROTOTYPE__ = {};",
        json!({
            "baseUrl": format!("{BASE_ORIGIN}/snapshot-a/"),
            "secondBaseUrl": format!("{BASE_ORIGIN}/snapshot-b/"),
            "recovery": recovery,
            "sourceRemoved": true,
            "mode": if recovery { "recovery" } else { "normal" }
        })
    );
    let app = tauri::Builder::default()
        .register_uri_scheme_protocol("fixture-resource", move |context, request| {
            resources.respond(context.webview_label(), &request)
        })
        .invoke_handler(tauri::generate_handler![finish])
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Plugin Resource Prototype")
                .inner_size(900.0, 700.0)
                .initialization_script(initialization)
                .on_page_load(|_, payload| {
                    eprintln!("RESOURCE_PROTOTYPE_PAGE {:?}", payload.event());
                })
                .on_navigation(|url| {
                    eprintln!("RESOURCE_PROTOTYPE_NAVIGATION {}", url);
                    let host = if cfg!(target_os = "windows") {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    };
                    url.as_str() == host
                        || url.as_str() == format!("{host}/index.html")
                        || url.as_str() == format!("{host}/")
                })
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!());
    match app {
        Ok(app) => {
            app.run(|_, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    emit_and_exit(json!({"ok": false, "error": "closed-before-report"}));
                }
            });
            emit_and_exit(json!({"ok": false, "error": "event-loop-ended-before-report"}));
        }
        Err(error) => {
            eprintln!("RESOURCE_PROTOTYPE_STARTUP {error}");
            emit_and_exit(json!({"ok": false, "error": "native-startup-failed"}))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_record_verifies_and_retained_bytes_survive_removal() {
        let package = extract_and_verify().unwrap();
        for (path, bytes) in EMBEDDED_FILES {
            assert_eq!(package.file(path).unwrap(), *bytes);
        }
        assert_eq!(package.paths().count(), EMBEDDED_FILES.len());
    }

    #[test]
    fn mutation_never_replaces_the_accepted_record() {
        let source = tempfile::tempdir().unwrap();
        let record = IntegrityRecord::from_json(ACCEPTED_RECORD, &limits()).unwrap();
        for (path, bytes) in EMBEDDED_FILES {
            let destination = source.path().join(path);
            std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
            std::fs::write(destination, bytes).unwrap();
        }
        let package = verify_package(source.path(), &record, &limits()).unwrap();
        std::fs::write(source.path().join("fixture/plugin.js"), b"changed source").unwrap();
        assert!(verify_package(source.path(), &record, &limits()).is_err());
        assert_eq!(
            package.file("fixture/plugin.js"),
            EMBEDDED_FILES
                .iter()
                .find(|(path, _)| *path == "fixture/plugin.js")
                .map(|(_, bytes)| *bytes)
        );
        source.close().unwrap();
        assert!(package.file("fixture/plugin.js").is_some());
    }
}
