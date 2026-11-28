use crate::{
    campaign::pause,
    plugin_registry::CommandResourceSettingsSnapshot,
    policy::{Host, Role},
    wire,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::Manager;

const CASE: &str = "workspace-management-invokes-denied";

fn requests(workspace: &str, manager: &str, saved: &CommandResourceSettingsSnapshot) -> Value {
    let mut calls = Vec::with_capacity(8);
    for session in [workspace, manager] {
        // Use the authoritative unchanged configuration. An unexpected admission
        // must fail the test, but must not introduce a changed settings value.
        calls.extend([
            json!(["settings_save", {"version":1,"session":session,"requestId":"1","expectedRevision":saved.revision,"settings":wire::Limits::from(&saved.settings)}]),
            json!(["settings_read", {"version":1,"session":session}]),
            json!(["settings_result", {"version":1,"session":session,"requestId":"1"}]),
            json!(["settings_application_status", {"version":1,"session":session}]),
        ]);
    }
    json!(calls)
}
fn script(workspace: &str, manager: &str, saved: &CommandResourceSettingsSnapshot) -> String {
    let own = json!({"version":1,"session":workspace});
    let calls = requests(workspace, manager, saved);
    let case = json!(CASE);
    // ACL errors may be strings. Any rejected invoke counts as a denial, but a
    // successful own-session bootstrap and authorized report are also required.
    format!(
        r#"void(async()=>{{const invoke=(command,payload)=>window.__TAURI_INTERNALS__.invoke(command,{{payload:JSON.stringify(payload)}});const own={own};let live=false;try{{const status=await invoke('bootstrap_status',own);live=status?.state==='Ready';}}catch{{}}const denied=await Promise.all({calls}.map(async([command,payload])=>{{try{{await invoke(command,payload);return false;}}catch{{return true;}}}}));await invoke('fixture_report',{{...own,cases:[{{name:{case},ok:live&&denied.length===8&&denied.every(Boolean)}}]}});}})();"#
    )
}

pub(crate) async fn exercise(app: &tauri::AppHandle, host: &Arc<Host>) -> bool {
    let (manager, peers) = {
        let state = host.lock();
        let Some(manager) = state
            .windows
            .get("manager")
            .filter(|w| w.role == Role::Manager)
        else {
            return false;
        };
        let peers = ["workspace-a", "workspace-b"]
            .into_iter()
            .map(|label| {
                state
                    .windows
                    .get(label)
                    .filter(|w| w.role == Role::Workspace)
                    .map(|w| (label, w.session.clone()))
            })
            .collect::<Option<Vec<_>>>();
        (manager.session.clone(), peers)
    };
    let Some(peers) = peers else {
        return false;
    };
    let Ok(snapshot) = host.operations.read().await else {
        return false;
    };
    for (label, session) in &peers {
        let Some(window) = app.get_webview_window(label) else {
            return false;
        };
        if window
            .eval(script(session, &manager, &snapshot.saved))
            .is_err()
        {
            return false;
        }
    }
    for _ in 0..100 {
        let denied = {
            let state = host.lock();
            if state.stopping {
                return false;
            }
            peers.iter().all(|(label, session)| {
                state
                    .windows
                    .get(*label)
                    .is_some_and(|w| w.role == Role::Workspace && w.session == *session)
                    && state
                        .reports
                        .get(*label)
                        .is_some_and(|cases| cases.iter().any(|c| c.name == CASE && c.ok))
            })
        };
        if denied {
            return true;
        }
        pause(50).await;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_covers_all_management_commands_with_own_and_copied_sessions() {
        let saved = CommandResourceSettingsSnapshot {
            revision: crate::plugin_registry::CommandResourceRevision::new(7).unwrap(),
            settings: crate::plugin_registry::CommandResourceSettings::default(),
        };
        let calls = requests("workspace", "manager", &saved);
        let calls = calls.as_array().unwrap();
        assert_eq!(calls.len(), 8);
        for (group, session) in calls
            .as_chunks::<4>()
            .0
            .iter()
            .zip(["workspace", "manager"])
        {
            assert_eq!(
                group
                    .iter()
                    .map(|call| call[0].as_str().unwrap())
                    .collect::<Vec<_>>(),
                [
                    "settings_save",
                    "settings_read",
                    "settings_result",
                    "settings_application_status"
                ]
            );
            for call in group {
                assert_eq!(call[1]["session"], session);
                assert_eq!(call[1]["version"], 1);
                let raw = call[1].to_string();
                match call[0].as_str().unwrap() {
                    "settings_save" => {
                        let request: wire::Save = wire::parse(&raw).unwrap();
                        assert_eq!(request.expected_revision, saved.revision);
                        assert_eq!(request.settings.native().unwrap(), saved.settings);
                        assert_eq!(request.request_id, "1");
                    }
                    "settings_result" => {
                        let _: wire::ResultRequest = wire::parse(&raw).unwrap();
                    }
                    _ => {
                        let _: wire::Base = wire::parse(&raw).unwrap();
                    }
                }
            }
        }
    }

    #[test]
    fn script_requires_positive_control_and_reports_using_workspace_identity() {
        let saved = CommandResourceSettingsSnapshot {
            revision: crate::plugin_registry::CommandResourceRevision::default(),
            settings: crate::plugin_registry::CommandResourceSettings::default(),
        };
        let script = script("workspace", "copied-manager", &saved);
        assert!(
            script.find("invoke('bootstrap_status',own)").unwrap()
                < script.find("Promise.all").unwrap()
        );
        assert!(script.contains("live&&denied.length===8&&denied.every(Boolean)"));
        assert!(script.contains("invoke('fixture_report',{...own,cases:"));
        assert!(script.contains("payload:JSON.stringify(payload)"));
    }
}
