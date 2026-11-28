use std::{io::Write, sync::Arc, time::Duration};

use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

// Keep the internal integrity API in this crate; no production visibility change.
mod lifecycle;
#[allow(dead_code)]
#[path = "../../../../src-tauri/src/plugin_integrity/mod.rs"]
mod plugin_integrity;
#[allow(dead_code)]
#[path = "../../../../src-tauri/src/plugin_resources/mod.rs"]
mod plugin_resources;

mod reporting;
mod resources;

use lifecycle::{Action, Harness};
use plugin_integrity::{verify_package, IntegrityLimits, IntegrityRecord, VerifiedPackage};
use plugin_resources::{SnapshotLimits, SnapshotUsage};
use resources::Resources;

include!(concat!(env!("OUT_DIR"), "/fixture_manifest.rs"));

fn limits() -> IntegrityLimits {
    IntegrityLimits {
        max_files: 512,
        max_file_bytes: 8 * 1024 * 1024,
        max_total_bytes: 32 * 1024 * 1024,
        max_path_bytes: 1024,
        max_depth: 16,
    }
}

fn extract_and_verify() -> Result<VerifiedPackage, Box<dyn std::error::Error>> {
    extract_verified(ACCEPTED_RECORD, EMBEDDED_FILES)
}

fn extract_verified(
    accepted: &[u8],
    files: &[(&str, &[u8])],
) -> Result<VerifiedPackage, Box<dyn std::error::Error>> {
    let limits = limits();
    let record = IntegrityRecord::from_json(accepted, &limits)?;
    let source = tempfile::tempdir()?;
    for (path, bytes) in files {
        plugin_integrity::validate_path(path, &limits)?;
        let destination = source.path().join(path);
        std::fs::create_dir_all(destination.parent().ok_or("missing parent")?)?;
        std::fs::write(destination, bytes)?;
    }
    let package = verify_package(source.path(), &record, &limits)?;
    source.close()?;
    Ok(package)
}

#[tauri::command]
fn finish(
    window: tauri::WebviewWindow,
    harness: tauri::State<'_, Arc<Harness>>,
    report: Value,
) -> Result<(), String> {
    let action = reporting::validate(window.label(), &report)
        .and_then(|()| harness.report(window.label(), report));
    match action.and_then(|action| run_action(window.app_handle(), action)) {
        Ok(()) => Ok(()),
        Err(error) => fail(error),
    }
}

fn run_action(app: &tauri::AppHandle, action: Action) -> Result<(), String> {
    match action {
        Action::Wait => Ok(()),
        Action::Close(label) => app
            .get_webview_window(label)
            .ok_or("fixture window missing")?
            .close()
            .map_err(|error| error.to_string()),
        Action::Probe(label, stage) => app
            .get_webview_window(label)
            .ok_or("probe window missing")?
            .eval(format!(
                "void window.__RESOURCE_PROTOTYPE_PROBE__('{stage}');"
            ))
            .map_err(|error| error.to_string()),
        Action::Complete(report) => emit_and_exit(report),
    }
}

fn fail(error: impl std::fmt::Display) -> ! {
    emit_and_exit(json!({
        "ok": false,
        "mode": if std::env::args().any(|arg| arg == "--recovery") { "recovery" } else { "normal" },
        "error": error.to_string().chars().take(4096).collect::<String>(),
    }))
}

fn emit_and_exit(report: Value) -> ! {
    let report = if reporting::validate("main", &report).is_ok() {
        report
    } else {
        json!({"ok": false, "error": "native-final-report-exceeded-limits"})
    };
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
    // These are explicit fixture budgets, not production defaults.
    let resources = Arc::new(Resources::new(SnapshotLimits {
        max_snapshots: 2,
        max_retained_bytes: 32 * 1024 * 1024,
    }));
    let mut expected_usage = SnapshotUsage {
        snapshots: 0,
        retained_bytes: 0,
    };
    let mut base_url = String::new();
    let mut second_base_url = String::new();
    if !recovery {
        // Primary admissions independently verify against the fixed record and
        // share one allocation. A second accepted artifact has its own identity.
        for label in ["main", "peer"] {
            let package = extract_and_verify().unwrap_or_else(|error| fail(error));
            expected_usage.retained_bytes = package.byte_length();
            resources
                .register_view(label)
                .unwrap_or_else(|error| fail(error));
            let id = resources
                .admit(label, package)
                .unwrap_or_else(|error| fail(error));
            let entry = resources
                .file_url(id, "fixture/plugin.js")
                .unwrap_or_else(|error| fail(error));
            base_url = entry
                .strip_suffix("fixture/plugin.js")
                .expect("entry suffix")
                .to_owned();
        }
        let second = extract_verified(SECOND_ACCEPTED_RECORD, SECOND_EMBEDDED_FILES)
            .unwrap_or_else(|error| fail(error));
        expected_usage.retained_bytes += second.byte_length();
        expected_usage.snapshots = 2;
        let id = resources
            .admit("main", second)
            .unwrap_or_else(|error| fail(error));
        let entry = resources
            .file_url(id, "fixture/plugin.js")
            .unwrap_or_else(|error| fail(error));
        second_base_url = entry
            .strip_suffix("fixture/plugin.js")
            .expect("entry suffix")
            .to_owned();
    }
    // This expected probe digest comes from the fixed BUILD-TIME record. It is
    // never regenerated from extracted candidate files during loading.
    let record: Value = serde_json::from_slice(ACCEPTED_RECORD).unwrap_or_else(|error| fail(error));
    let expected_sha256 = record["files"]["fixture/plugin.js"]["sha256"]
        .as_str()
        .unwrap_or_else(|| fail("missing accepted fixture entry digest"))
        .to_owned();
    let harness = Arc::new(Harness::new(
        Arc::clone(&resources),
        recovery,
        expected_usage,
    ));
    let lifecycle = Arc::clone(&harness);
    let app = tauri::Builder::default()
        .manage(harness)
        .register_uri_scheme_protocol("fixture-resource", move |context, request| {
            resources.respond(context.webview_label(), &request)
        })
        .invoke_handler(tauri::generate_handler![finish])
        .on_window_event(move |window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                let label = window.label();
                let action = lifecycle
                    .resources
                    .close_view(label)
                    .and_then(|removed| lifecycle.destroyed(label, removed));
                if let Err(error) =
                    action.and_then(|action| run_action(window.app_handle(), action))
                {
                    fail(error);
                }
            }
        })
        .setup(move |app| {
            let labels: &[&str] = if recovery {
                &["main"]
            } else {
                &["main", "peer", "denied"]
            };
            for &label in labels {
                let entry = if label == "main" {
                    "index.html"
                } else {
                    "probe.html"
                };
                let initialization = format!(
                    "window.__RESOURCE_PROTOTYPE__ = {};",
                    json!({
                        "baseUrl": base_url,
                        "secondBaseUrl": second_base_url,
                        "role": label,
                        "expectedSha256": expected_sha256,
                        "recovery": recovery,
                        "sourceRemoved": !recovery,
                        "mode": if recovery { "recovery" } else { "normal" }
                    })
                );
                WebviewWindowBuilder::new(app, label, WebviewUrl::App(entry.into()))
                    .title(format!("Plugin Resource Prototype — {label}"))
                    .inner_size(900.0, 700.0)
                    .visible(label == "main")
                    .initialization_script(initialization)
                    .on_page_load(move |_, payload| {
                        eprintln!("RESOURCE_PROTOTYPE_PAGE {label} {:?}", payload.event());
                    })
                    .on_navigation(move |url| {
                        let host = if cfg!(target_os = "windows") {
                            "http://tauri.localhost"
                        } else {
                            "tauri://localhost"
                        };
                        url.as_str() == host
                            || url.as_str() == format!("{host}/{entry}")
                            || url.as_str() == format!("{host}/")
                    })
                    .build()?;
            }
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
    fn second_build_time_record_has_distinct_identity_and_shared_child_contents() {
        let primary = extract_and_verify().unwrap();
        let second = extract_verified(SECOND_ACCEPTED_RECORD, SECOND_EMBEDDED_FILES).unwrap();
        assert_ne!(primary.fingerprint(), second.fingerprint());
        assert_ne!(
            primary.file("fixture/plugin.js"),
            second.file("fixture/plugin.js")
        );
        assert_eq!(
            primary.file("fixture/child.js"),
            second.file("fixture/child.js")
        );
        assert_eq!(primary.paths().count(), second.paths().count());
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
