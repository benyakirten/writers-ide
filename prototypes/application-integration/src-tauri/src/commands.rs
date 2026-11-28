use crate::plugin_registry::command_resource_settings::SaveOutcome;
use crate::{
    policy::{Host, Role},
    router::HostRouter,
    wire::{self, Reply},
};
use serde_json::{json, Value};
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::{ipc::Channel, State, WebviewWindow};
fn caller(window: &WebviewWindow, host: &Host) -> Reply<String> {
    let label = window.label();
    let role = {
        let s = host.lock();
        s.windows
            .get(label)
            .ok_or_else(|| wire::error("denied", "Unknown actual WebView"))?
            .role
    };
    // url() can synchronously dispatch to the UI thread. Never hold host state
    // while waiting for it: a simultaneous UI-thread invoke also needs that state.
    let url = window
        .url()
        .map_err(|_| wire::error("denied", "Unavailable actual shell"))?;
    if !fixed_url(&url, role.shell()) {
        return Err(wire::error("denied", "Actual shell denied"));
    }
    Ok(label.into())
}
pub fn fixed_url(url: &tauri::Url, shell: &str) -> bool {
    ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || ((url.scheme() == "http" || url.scheme() == "https")
            && url.host_str() == Some("tauri.localhost")))
        && url.path() == format!("/{shell}")
        && url.query().is_none()
        && url.fragment().is_none()
}
#[tauri::command]
pub fn session_handshake(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
) -> Reply<Value> {
    let host = router.capture();
    host.handshake(&caller(&window, &host)?)
}
#[tauri::command]
pub fn bootstrap_status(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let payload: wire::Base = wire::parse(&payload)?;
    host.authorize(
        &caller(&window, &host)?,
        &payload.session,
        payload.version,
        None,
    )?;
    Ok(json!({"state":"Ready"}))
}
#[tauri::command]
pub async fn settings_read(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let r: wire::Base = wire::parse(&payload)?;
    let label = caller(&window, &host)?;
    host.authorize(&label, &r.session, r.version, Some(Role::Manager))?;
    let snapshot = host
        .operations
        .read()
        .await
        .map_err(|_| wire::error("unavailable", "Authoritative read failed"))?;
    host.authorize(&label, &r.session, r.version, Some(Role::Manager))?;
    Ok(wire::snapshot(&host.epoch, &snapshot))
}
fn native_error(error: &crate::plugin_registry::RegistryError) -> Value {
    use crate::plugin_registry::RegistryError;
    let (code,message)=match error {
        RegistryError::OutcomeUnknown(_)=>("outcome-unknown","Native write outcome is unknown. Controlled recovery is required; no rollback is asserted."),
        RegistryError::Conflict(_)=>("conflict","Expected saved revision is stale"),
        RegistryError::LimitExceeded(_)=>("busy","Native operation capacity was refused"),
        RegistryError::Unavailable(_)=>("unavailable","Native service is unavailable"),
        RegistryError::RecoveryRequired(_)=>("recovery-required","Native storage requires controlled recovery"),
        RegistryError::Storage(_)=>("storage-failed","Native storage operation failed; no rollback is asserted"),
        _=>("native-error","Native operation failed"),
    };
    wire::error(code, message)
}
pub(crate) async fn execute_save(host: &Host, r: &wire::Save) -> Reply<Value> {
    let outcome = match r.settings.native() {
        Ok(s) => host.operations.save(r.expected_revision, s).await,
        Err(e) => return Err(e),
    };
    match outcome {
        Ok(SaveOutcome::Saved(snapshot)) => Ok(
            json!({"kind":"saved","requestId":r.request_id,"snapshot":wire::snapshot(&host.epoch,&snapshot)}),
        ),
        Ok(SaveOutcome::Conflict {
            current,
            read_error,
            error,
        }) => Ok(
            json!({"kind":"conflict","requestId":r.request_id,"current":current.map(|s|wire::snapshot(&host.epoch,&s)),"readError":read_error.as_ref().map(native_error),"error":native_error(&error)}),
        ),
        Err(error) => Err(native_error(&error)),
    }
}
pub(crate) struct SaveCompletion {
    host: Arc<Host>,
    session: String,
    id: i64,
    completed: bool,
}
impl SaveCompletion {
    pub(crate) fn new(host: Arc<Host>, session: String, id: i64) -> Self {
        Self {
            host,
            session,
            id,
            completed: false,
        }
    }
    pub(crate) fn complete(mut self, result: Reply<Value>) {
        self.host.complete(&self.session, self.id, result);
        self.completed = true;
    }
}
impl Drop for SaveCompletion {
    fn drop(&mut self) {
        if !self.completed {
            self.host.complete(&self.session, self.id, Err(wire::error(
                "outcome-unknown",
                "Native save completion was lost. The result is unconfirmed; no rollback is asserted. Do not replay the write.",
            )));
        }
    }
}
#[tauri::command]
pub async fn settings_save(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let r: wire::Save = wire::parse(&payload)?;
    let label = caller(&window, &host)?;
    let _invoke = host
        .invoke_slots
        .try_acquire()
        .map_err(|_| wire::error("busy", "Bounded save-result waiters occupied"))?;
    let (id, admitted) = host.reserve_save(&label, r.clone(), Instant::now())?;
    if admitted {
        let host = host.clone();
        let request = r.clone();
        let completion = SaveCompletion::new(host.clone(), request.session.clone(), id);
        tauri::async_runtime::spawn(async move {
            let result = execute_save(&host, &request).await;
            completion.complete(result);
        });
    }
    // Completion is owned by native state, not this invoke future.
    loop {
        let notified = host.changed.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let result = host.result(&label, &r.session, r.version, id, Instant::now())?;
        if result["kind"] != "pending" {
            return Ok(result);
        }
        // No task/timer per message. A native completion or shutdown wakes this waiter.
        notified.await;
    }
}
#[tauri::command]
pub fn settings_result(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let r: wire::ResultRequest = wire::parse(&payload)?;
    host.result(
        &caller(&window, &host)?,
        &r.session,
        r.version,
        wire::decimal(&r.request_id, true)?,
        Instant::now(),
    )
}
#[tauri::command]
pub fn settings_application_status(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let r: wire::Base = wire::parse(&payload)?;
    host.authorize(
        &caller(&window, &host)?,
        &r.session,
        r.version,
        Some(Role::Manager),
    )?;
    Ok(host.application_status())
}
#[tauri::command]
pub fn settings_attach(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
    events: Channel<Value>,
) -> Reply<Value> {
    let host = router.capture();
    host.attach(&caller(&window, &host)?, wire::parse(&payload)?, events)
}
#[tauri::command]
pub async fn settings_attachment_read(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let r: wire::Identity = wire::parse(&payload)?;
    let label = caller(&window, &host)?;
    let a = host.attachment(&label, r.version, &r.session, &r.epoch, &r.attachment)?;
    {
        let mut s = a.lock();
        if s.reading {
            return Err(wire::error("busy", "One read per attachment"));
        }
        s.reading = true;
    }
    // Guard releases control admission even if the invoke future is cancelled.
    struct Reading(Arc<crate::transport::Attachment>);
    impl Drop for Reading {
        fn drop(&mut self) {
            self.0.lock().reading = false;
        }
    }
    let _reading = Reading(a);
    let snapshot = host
        .association
        .read()
        .await
        .map_err(|_| wire::error("unavailable", "Attachment read failed"))?;
    host.attachment(&label, r.version, &r.session, &r.epoch, &r.attachment)?;
    Ok(wire::snapshot(&host.epoch, &snapshot))
}
#[tauri::command]
pub fn settings_ack(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<bool> {
    let host = router.capture();
    let r: wire::Ack = wire::parse(&payload)?;
    let a = host.attachment(
        &caller(&window, &host)?,
        r.version,
        &r.session,
        &r.epoch,
        &r.attachment,
    )?;
    Ok(a.acknowledge(wire::decimal(&r.sequence, true)?, r.revision))
}
#[tauri::command]
pub fn settings_renew(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<Value> {
    let host = router.capture();
    let r: wire::Renew = wire::parse(&payload)?;
    wire::challenge(&r.challenge)?;
    let a = host.attachment(
        &caller(&window, &host)?,
        r.version,
        &r.session,
        &r.epoch,
        &r.attachment,
    )?;
    a.lock().lease = Instant::now() + Duration::from_secs(30);
    Ok(
        json!({"version":1,"epoch":r.epoch,"attachment":r.attachment,"challenge":r.challenge,"valid":true}),
    )
}
#[tauri::command]
pub fn settings_detach(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<bool> {
    let host = router.capture();
    let r: wire::Identity = wire::parse(&payload)?;
    let a = host.attachment(
        &caller(&window, &host)?,
        r.version,
        &r.session,
        &r.epoch,
        &r.attachment,
    )?;
    a.close("explicit-detach");
    Ok(true)
}
fn report_allowed(role: Role, name: &str) -> bool {
    if name == "resource-csp-blocked" {
        return true;
    }
    match role {
        Role::Manager => [
            "manager-saved-state-visible",
            "manager-eight-inputs",
            "replacement-old-document-requests-denied",
            "replacement-manager-zero-settings-visible",
            "replacement-manager-previous-settings-visible",
        ]
        .contains(&name),
        Role::Workspace => [
            "workspace-real-host-created",
            "workspace-settings-ready",
            "workspace-settings-stale",
            "workspace-held-command-running",
            "workspace-cancelled-unfinished-retains-accounting",
            "workspace-frozen-synchronous-admission-rejected",
            "workspace-real-host-active",
            "stale-document-ack-denied",
            "workspace-management-invokes-denied",
            "replacement-old-document-requests-denied",
        ]
        .contains(&name),
        Role::Probe => [
            "probe-denied-settings_read",
            "probe-denied-settings_save",
            "probe-denied-settings_application_status",
            "probe-denied-settings_attachment_read",
            "probe-denied-settings_save-forged-role",
        ]
        .contains(&name),
    }
}
#[tauri::command]
pub fn fixture_report(
    window: WebviewWindow,
    router: State<'_, Arc<HostRouter>>,
    payload: String,
) -> Reply<bool> {
    let host = router.capture();
    let r: wire::Report = wire::parse(&payload)?;
    let label = caller(&window, &host)?;
    host.authorize(&label, &r.session, r.version, None)?;
    let mut s = host.lock();
    let role = s.windows.get(&label).expect("authorized").role;
    if r.cases.len() > 32 || r.cases.iter().any(|c| !report_allowed(role, &c.name)) {
        return Err(wire::invalid());
    }
    // Fixed whitelist bounds both keys and observations across repeated reports.
    let cases = s.reports.entry(label).or_default();
    for c in r.cases {
        if let Some(old) = cases.iter_mut().find(|old| old.name == c.name) {
            *old = c;
        } else {
            cases.push(c);
        }
    }
    host.changed.notify_waiters();
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fixed_shell_rejects_remote_query_and_wrong_entry() {
        assert!(fixed_url(
            &"tauri://localhost/manager.html".parse().unwrap(),
            "manager.html"
        ));
        for url in [
            "https://evil.test/manager.html",
            "tauri://localhost/manager.html?role=manager",
            "tauri://localhost/workspace.html",
        ] {
            assert!(!fixed_url(&url.parse().unwrap(), "manager.html"));
        }
    }
    #[test]
    fn report_stage_names_are_not_mutation_commands() {
        assert!(!report_allowed(Role::Probe, "manager-eight-inputs"));
        assert!(!report_allowed(Role::Manager, "save"));
    }
    #[test]
    fn workspace_management_denial_report_is_workspace_only() {
        assert!(report_allowed(
            Role::Workspace,
            "workspace-management-invokes-denied"
        ));
        assert!(!report_allowed(
            Role::Manager,
            "workspace-management-invokes-denied"
        ));
        assert!(!report_allowed(
            Role::Probe,
            "workspace-management-invokes-denied"
        ));
    }
}
