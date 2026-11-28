use crate::{
    campaign::pause,
    policy::{Host, Role},
    replacement::ReplacementShell,
    transport::Attachment,
    wire,
};
use serde_json::json;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::Manager;

const WINDOWS: [(&str, Role); 4] = [
    ("manager", Role::Manager),
    ("workspace-a", Role::Workspace),
    ("workspace-b", Role::Workspace),
    ("probe", Role::Probe),
];

struct KeepAlive(tauri::WebviewWindow);
impl Drop for KeepAlive {
    fn drop(&mut self) {
        let _ = self.0.destroy();
    }
}
fn observed(host: &Host, label: &str, name: &str) -> bool {
    host.lock()
        .reports
        .get(label)
        .is_some_and(|cases| cases.iter().any(|c| c.name == name && c.ok))
}
fn live(host: &Host, requested: &AtomicBool) -> bool {
    !requested.load(Ordering::Acquire) && !host.lock().stopping
}
fn manager_case(expected: &serde_json::Value, name: &str, check_inputs: bool) -> String {
    let name = json!(name);
    format!(
        r#"let visible=false;try{{const raw=document.getElementById('saved')?.textContent??'';const saved=JSON.parse(raw.slice(raw.indexOf('\n')+1));const expected={expected};visible=saved.revision===expected.revision&&saved.epoch===expected.epoch&&Object.entries(expected.settings).every(([key,value])=>typeof value==='object'?Object.entries(value).every(([k,v])=>saved.settings[key][k]===v&&(!{check_inputs}||Number(document.getElementById(key+'.'+k)?.value)===v)):saved.settings[key]===value&&(!{check_inputs}||Number(document.getElementById(key)?.value)===value));}}catch{{}}cases.push({{name:{name},ok:visible}});"#
    )
}

pub(crate) async fn primary_manager_observation(
    app: &tauri::AppHandle,
    host: &Host,
    saved: &crate::plugin_registry::CommandResourceSettingsSnapshot,
) -> bool {
    let document = host
        .lock()
        .windows
        .get("manager")
        .map(|w| w.session.clone());
    let Some(document) = document else {
        return false;
    };
    let Some(window) = app.get_webview_window("manager") else {
        return false;
    };
    if window.eval("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Read saved state and application status')?.click()").is_err() { return false; }
    let name = "replacement-manager-previous-settings-visible";
    let expected = json!({"epoch":host.epoch,"revision":saved.revision,"settings":wire::Limits::from(&saved.settings)});
    let case = manager_case(&expected, name, false);
    let report = json!({"version":1,"session":document});
    let script = format!(
        r#"void(async()=>{{const cases=[];{case}await window.__TAURI_INTERNALS__.invoke('fixture_report',{{payload:JSON.stringify({{...{report},cases}})}});}})();"#
    );
    for _ in 0..50 {
        if host.lock().stopping {
            return false;
        }
        if window.eval(&script).is_err() {
            return false;
        }
        if observed(host, "manager", name) {
            return true;
        }
        pause(100).await;
    }
    observed(host, "manager", name)
}

// The caller owns and drains the replacement service even if a window or stage
// fails. All observations are recorded on the original campaign host.
pub(crate) async fn exercise(
    shell: &ReplacementShell<'_>,
    retired: &Arc<Host>,
    fresh: &Arc<Host>,
    attachments: &[Arc<Attachment>],
    initial: &crate::plugin_registry::command_resource_settings::SettingsSnapshot,
    requested: &AtomicBool,
) -> bool {
    if !live(fresh, requested) {
        return false;
    }
    // The stable Tauri API creates a WebView-backed window. This fixed blank
    // page loads no application scripts and has no capability or native lifetime.
    // It prevents only the incidental last-window exit during shell replacement.
    let keepalive = match tauri::WebviewWindowBuilder::new(
        shell.app,
        "replacement-keepalive",
        tauri::WebviewUrl::External("about:blank".parse().expect("fixed blank URL")),
    )
    .visible(false)
    .on_navigation(|url| url.as_str() == "about:blank")
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build()
    {
        Ok(window) => KeepAlive(window),
        Err(_) => {
            retired.stage("packaged-replacement-old-windows-destroyed", false);
            return false;
        }
    };
    let old_documents = retired
        .lock()
        .windows
        .iter()
        .map(|(label, w)| (label.clone(), w.session.clone()))
        .collect::<BTreeMap<_, _>>();
    for (label, _) in WINDOWS {
        if let Some(window) = shell.app.get_webview_window(label) {
            if window.destroy().is_err() {
                retired.stage("packaged-replacement-old-windows-destroyed", false);
                return false;
            }
        }
    }
    for _ in 0..100 {
        if !live(fresh, requested) {
            return false;
        }
        if WINDOWS
            .iter()
            .all(|(label, _)| shell.app.get_webview_window(label).is_none())
            && retired.lock().windows.is_empty()
        {
            break;
        }
        pause(50).await;
    }
    let destroyed = WINDOWS
        .iter()
        .all(|(label, _)| shell.app.get_webview_window(label).is_none())
        && retired.lock().windows.is_empty();
    retired.stage("packaged-replacement-old-windows-destroyed", destroyed);
    if !destroyed || !live(fresh, requested) {
        return false;
    }
    let swapped = shell.router.replace(retired, fresh.clone()).is_ok();
    retired.stage("packaged-replacement-router-swapped", swapped);
    if !swapped {
        return false;
    }
    let mut documents = BTreeMap::new();
    for (label, role) in WINDOWS {
        if !live(fresh, requested) {
            return false;
        }
        match crate::windows::create(
            shell.app,
            fresh,
            shell.resources,
            label,
            role,
            shell.denial_policy,
        ) {
            Ok(document) => {
                documents.insert(label, document);
            }
            Err(_) => {
                retired.stage("packaged-replacement-new-document-lifetimes", false);
                return false;
            }
        }
    }
    drop(keepalive);
    let new_documents = ["manager", "workspace-a", "workspace-b"]
        .iter()
        .all(|label| {
            old_documents
                .get(*label)
                .zip(documents.get(label))
                .is_some_and(|(old, new)| old != new)
        });
    retired.stage("packaged-replacement-new-document-lifetimes", new_documents);
    let retired_stopping = retired.lock().stopping;
    let captured_closed = retired_stopping
        && Arc::ptr_eq(&shell.router.capture(), fresh)
        && old_documents
            .iter()
            .all(|(label, document)| retired.authorize(label, document, 1, None).is_err());
    retired.stage(
        "packaged-replacement-captured-old-host-closed",
        captured_closed,
    );
    for _ in 0..100 {
        if !live(fresh, requested) {
            return false;
        }
        for label in ["workspace-a", "workspace-b"] {
            if let Some(window) = shell.app.get_webview_window(label) {
                let _ = window.eval("document.getElementById('report')?.click()");
            }
        }
        if let Some(window) = shell.app.get_webview_window("manager") {
            let _ = window.eval("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Report observations')?.click()");
        }
        let ready = ["workspace-a", "workspace-b"].iter().all(|label| {
            observed(fresh, label, "workspace-real-host-created")
                && observed(fresh, label, "workspace-settings-ready")
                && observed(fresh, label, "workspace-real-host-active")
        }) && observed(fresh, "manager", "manager-eight-inputs");
        if ready {
            break;
        }
        pause(100).await;
    }
    let applied = fresh.application_status().as_array().is_some_and(|rows| {
        rows.len() == 2
            && rows
                .iter()
                .all(|r| r["state"] == "applied" && r["revision"] == "0")
    }) && {
        let state = fresh.lock();
        ["workspace-a", "workspace-b"].iter().all(|label| {
            state.attachments.values().any(|a| {
                a.label == *label
                    && a.epoch == fresh.epoch
                    && !attachments.iter().any(|old| old.id == a.id)
                    && a.lock().applied == Some(initial.saved.revision)
            })
        })
    };
    let hosts_created = ["workspace-a", "workspace-b"].iter().all(|label| {
        observed(fresh, label, "workspace-real-host-created")
            && observed(fresh, label, "workspace-settings-ready")
            && observed(fresh, label, "workspace-real-host-active")
    });
    retired.stage("packaged-replacement-workspace-initial-acks", applied);
    retired.stage(
        "packaged-replacement-real-frontend-hosts-ready",
        hosts_created,
    );

    // Execute delayed old-document DTOs from the real newly created shells. The
    // handler must capture the new host and reject the old marker, not retarget it.
    for label in ["manager", "workspace-a", "workspace-b"] {
        if !live(fresh, requested) {
            return false;
        }
        let Some(old) = old_documents.get(label) else {
            return false;
        };
        let mut requests = vec![json!(["bootstrap_status", {"version":1,"session":old}])];
        if label == "manager" {
            requests.extend([
                json!(["settings_read", {"version":1,"session":old}]),
                json!(["settings_result", {"version":1,"session":old,"requestId":"1"}]),
                json!(["settings_save", {"version":1,"session":old,"requestId":"1","expectedRevision":"0","settings":wire::Limits::from(&initial.saved.settings)}]),
            ]);
        } else {
            let Some(a) = attachments.iter().find(|a| a.label == label) else {
                return false;
            };
            requests.extend([
                json!(["settings_ack", {"version":1,"session":old,"epoch":a.epoch,"attachment":a.id,"sequence":"1","revision":"0"}]),
                json!(["settings_renew", {"version":1,"session":old,"epoch":a.epoch,"attachment":a.id,"challenge":"12345678-1234-1234-1234-123456789abc"}]),
            ]);
        }
        let report = json!({"version":1,"session":documents[label]});
        let extra = if label == "manager" {
            let expected = json!({"epoch":fresh.epoch,"revision":initial.saved.revision,"settings":wire::Limits::from(&initial.saved.settings)});
            manager_case(&expected, "replacement-manager-zero-settings-visible", true)
        } else {
            String::new()
        };
        if let Some(window) = shell.app.get_webview_window(label) {
            let script = format!(
                r#"void(async()=>{{const invoke=(command,args)=>window.__TAURI_INTERNALS__.invoke(command,args);const denied=await Promise.all({requests}.map(async([command,payload])=>{{try{{await invoke(command,{{payload:JSON.stringify(payload)}});return false;}}catch(error){{return error?.code==='denied'||error?.code==='closed';}}}}));const cases=[{{name:'replacement-old-document-requests-denied',ok:denied.every(Boolean)}}];{extra}await invoke('fixture_report',{{payload:JSON.stringify({{...{report},cases}})}});}})();"#,
                requests = json!(requests)
            );
            if window.eval(script).is_err() {
                return false;
            }
        } else {
            return false;
        }
    }
    for _ in 0..50 {
        if !live(fresh, requested) {
            return false;
        }
        if ["manager", "workspace-a", "workspace-b"]
            .iter()
            .all(|label| observed(fresh, label, "replacement-old-document-requests-denied"))
            && observed(
                fresh,
                "manager",
                "replacement-manager-zero-settings-visible",
            )
        {
            break;
        }
        pause(100).await;
    }
    let denied = ["manager", "workspace-a", "workspace-b"]
        .iter()
        .all(|label| observed(fresh, label, "replacement-old-document-requests-denied"));
    let manager = observed(
        fresh,
        "manager",
        "replacement-manager-zero-settings-visible",
    );
    retired.stage("packaged-replacement-delayed-old-requests-denied", denied);
    retired.stage(
        "packaged-replacement-manager-zero-settings-visible",
        manager,
    );
    new_documents && captured_closed && applied && hosts_created && denied && manager
}
