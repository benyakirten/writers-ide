use crate::plugin_registry::{self as registry, command_resource_settings::SettingsOwner};
use crate::{
    commands,
    owned::OwnedParent,
    policy::{Host, Role},
    resources::Resources,
    wire,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent};

pub(crate) async fn pause(ms: u64) {
    // Dropping a campaign wait leaves at most one short blocking slice behind.
    let deadline = Instant::now() + Duration::from_millis(ms);
    while Instant::now() < deadline {
        let remaining = deadline
            .saturating_duration_since(Instant::now())
            .min(Duration::from_millis(50));
        let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(remaining)).await;
    }
}
/// Admission must already be closed. Wire-reserved saves retain their right to
/// enter the settings coordinator until their native result has completed.
pub(crate) async fn drain_settings(host: &Host, settings: SettingsOwner) {
    host.drain_results().await;
    settings.shutdown().await;
}

pub(crate) async fn join_scheduler(scheduler: std::thread::JoinHandle<()>) -> bool {
    scheduler_task_result(tauri::async_runtime::spawn_blocking(move || {
        scheduler.join()
    }))
    .await
}
pub(crate) async fn scheduler_task_result(
    task: tauri::async_runtime::JoinHandle<std::thread::Result<()>>,
) -> bool {
    // Dispose thread panic payloads with the same isolation used for channel callbacks.
    match task.await {
        Ok(Ok(())) => true,
        Ok(Err(payload)) => {
            let _ = crate::transport::isolate(|| drop(payload));
            false
        }
        Err(_) => false,
    }
}

pub(crate) async fn until_stopped<F: std::future::Future>(
    host: &Host,
    future: F,
) -> Option<F::Output> {
    use std::{
        future::{poll_fn, Future},
        task::Poll,
    };
    let stopped = async {
        loop {
            let changed = host.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if host.lock().stopping {
                return;
            }
            changed.await;
        }
    };
    tokio::pin!(stopped);
    tokio::pin!(future);
    poll_fn(|cx| {
        if stopped.as_mut().poll(cx).is_ready() {
            return Poll::Ready(None);
        }
        match crate::transport::isolate(|| future.as_mut().poll(cx)) {
            Some(Poll::Ready(value)) => Poll::Ready(Some(value)),
            Some(Poll::Pending) => Poll::Pending,
            None => {
                host.stage("campaign-task-panicked", false);
                Poll::Ready(None)
            }
        }
    })
    .await
}

fn emit(value: &Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "APPLICATION_INTEGRATION_RESULT {value}");
    let _ = out.flush();
}
pub(crate) fn registry_limits() -> registry::RegistryLimits {
    registry::RegistryLimits {
        integrity: crate::plugin_integrity::IntegrityLimits {
            max_files: 16,
            max_file_bytes: 4096,
            max_total_bytes: 65536,
            max_path_bytes: 256,
            max_depth: 8,
        },
        max_rows: 1024,
        max_snapshot_bytes: 1024 * 1024,
        max_text_bytes: 4096,
        max_location_bytes: 4096,
        max_review_items: 128,
    }
}
fn capacity() -> registry::RegistryCapacity {
    registry::RegistryCapacity::with_observers(16, 8, 16).expect("positive fixture capacities")
}
pub(crate) struct StartupFailure {
    pub(crate) code: &'static str,
    pub(crate) cleanup_complete: bool,
    _location: Option<registry::LocationLease>,
    _original: Option<registry::RegistryError>,
}
impl From<&'static str> for StartupFailure {
    fn from(code: &'static str) -> Self {
        Self {
            code,
            cleanup_complete: true,
            _location: None,
            _original: None,
        }
    }
}
pub(crate) async fn opening(
    parent: &OwnedParent,
) -> Result<(registry::LocationLease, registry::RegistrySession), StartupFailure> {
    opening_at(parent.root()).await
}
pub(crate) async fn opening_replacement(
    parent: &OwnedParent,
) -> Result<(registry::LocationLease, registry::RegistrySession), StartupFailure> {
    opening_at(parent.replacement_root()).await
}
async fn opening_at(
    root: std::path::PathBuf,
) -> Result<(registry::LocationLease, registry::RegistrySession), StartupFailure> {
    let selected = tauri::async_runtime::spawn_blocking(move || {
        registry::SelectedRegistry::begin(&root, registry_limits(), capacity())
    })
    .await
    .map_err(|_| StartupFailure {
        code: "bootstrap-task-failed",
        cleanup_complete: false,
        _location: None,
        _original: None,
    })?;
    let mut selected = match selected {
        Ok(selected) => selected,
        Err(registry::BootstrapFailure::OwnershipUnavailable(reason)) => {
            return Err(match reason {
                registry::LocationAcquireError::Contended => "OwnershipUnavailable: contended",
                registry::LocationAcquireError::LockFailed(_) => {
                    "OwnershipUnavailable: lock-failed"
                }
                registry::LocationAcquireError::OpenFailed(_) => {
                    "OwnershipUnavailable: open-failed"
                }
            }
            .into())
        }
        Err(registry::BootstrapFailure::InitializationBlocked { location }) => {
            return Err(StartupFailure {
                _location: Some(location),
                .."InitializationBlocked".into()
            });
        }
        Err(registry::BootstrapFailure::RecoveryRequired { location, error }) => {
            return Err(StartupFailure {
                _location: Some(location),
                _original: Some(error),
                .."RecoveryRequired: selection failed".into()
            });
        }
        Err(registry::BootstrapFailure::Opening { location, failure }) => {
            let original = failure.error;
            let clean = failure.cleanup.wait().await;
            return Err(StartupFailure {
                code: "RecoveryRequired: opening failed",
                cleanup_complete: clean.is_ok(),
                _location: Some(location),
                _original: Some(original),
            });
        }
    };
    match selected.opening.complete().await {
        Ok(session) => Ok((selected.location, session)),
        Err(failure) => {
            let original = failure.error;
            let clean = failure.cleanup.wait().await;
            Err(StartupFailure {
                code: "RecoveryRequired: opening failed",
                cleanup_complete: clean.is_ok(),
                _location: Some(selected.location),
                _original: Some(original),
            })
        }
    }
}
fn inspect(parent: &OwnedParent) -> Value {
    match registry::LocationLease::acquire_detailed(&parent.root()) {
        Err(registry::LocationAcquireError::Contended) => {
            json!({"ok":true,"ownership":"contended","cleanupComplete":true,"runId":parent.run_id})
        }
        Err(registry::LocationAcquireError::LockFailed(_)) => {
            json!({"ok":false,"ownership":"lock-failed","cleanupComplete":true})
        }
        Err(registry::LocationAcquireError::OpenFailed(_)) => {
            json!({"ok":false,"ownership":"open-failed","cleanupComplete":true})
        }
        Ok(location) => {
            drop(location);
            json!({"ok":false,"ownership":"unexpectedly-available","cleanupComplete":true})
        }
    }
}
fn ownership_child(parent: &OwnedParent) -> bool {
    let Ok(exe) = std::env::current_exe() else {
        return false;
    };
    let Ok(mut child) = std::process::Command::new(exe)
        .arg("--parent")
        .arg(&parent.parent)
        .arg("--run-id")
        .arg(&parent.run_id)
        .arg("--inspect-ownership")
        .stdout(std::process::Stdio::piped())
        .spawn()
    else {
        return false;
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let Ok(output) = child.wait_with_output() else {
                    return false;
                };
                return status.success()
                    && String::from_utf8_lossy(&output.stdout)
                        .contains("\"ownership\":\"contended\"");
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return false;
            }
        }
    }
}
pub fn run() {
    let parent = match OwnedParent::arguments() {
        Ok(parent) => parent,
        Err(_) => {
            emit(
                &json!({"ok":false,"error":"owned fixture arguments or marker invalid","cleanupComplete":true}),
            );
            return;
        }
    };
    if parent.inspect {
        emit(&inspect(&parent));
        return;
    }
    eprintln!("APPLICATION_INTEGRATION_STARTUP selecting");
    let (location, session) = match tauri::async_runtime::block_on(opening(&parent)) {
        Ok(v) => v,
        Err(error) => {
            emit(
                &json!({"ok":false,"error":error.code,"cleanupComplete":error.cleanup_complete,"runId":parent.run_id}),
            );
            return;
        }
    };
    eprintln!("APPLICATION_INTEGRATION_STARTUP settings");
    let settings = match tauri::async_runtime::block_on(SettingsOwner::start(
        session.handle.clone(),
        16,
        16,
    )) {
        Ok(settings) => settings,
        Err(_) => {
            let cleanup = tauri::async_runtime::block_on(session.owner.shutdown());
            drop(location);
            emit(
                &json!({"ok":false,"error":"SettingsUnavailable","cleanupComplete":cleanup.is_ok()}),
            );
            return;
        }
    };
    let resources = match Resources::new(&parent.parent) {
        Ok(resources) => Arc::new(resources),
        Err(_) => {
            tauri::async_runtime::block_on(settings.shutdown());
            let cleanup = tauri::async_runtime::block_on(session.owner.shutdown());
            drop(location);
            emit(
                &json!({"ok":false,"error":"inert resource preparation failed","cleanupComplete":cleanup.is_ok()}),
            );
            return;
        }
    };
    let host = Host::new(settings.operations(), settings.association());
    let router = crate::router::HostRouter::new(host.clone());
    let shutdown = Arc::new(crate::shutdown::ShutdownController::new());
    let shutdown_authority = crate::shutdown_window::ShutdownWindowAuthority::new(shutdown.clone());
    let force_parent = parent.clone();
    let force_host = host.clone();
    let force_shutdown = shutdown.clone();
    let force_reporter = crate::shutdown_commands::ShutdownForceReporter::new(move |_| {
        force_host.stage("shutdown-force-confirmed", true);
        crate::shutdown_campaign::record(
            &force_parent,
            crate::shutdown_campaign::report(
                &force_parent,
                &force_host,
                &force_shutdown,
                false,
                false,
            ),
        );
    });
    host.stage("strict-schema2-owned-startup", true);
    host.stage(
        "native-inert-resource-requester-policy",
        resources.native_policy_check(),
    );
    host.stage("second-process-ownership-refusal", ownership_child(&parent));
    let cleaned = Arc::new(AtomicBool::new(false));
    let requested = Arc::new(AtomicBool::new(false));
    let route = resources.clone();
    let setup_host = host.clone();
    let setup_resources = resources.clone();
    let setup_cleaned = cleaned.clone();
    let setup_requested = requested.clone();
    let denial_policy = parent.resource_denial_policy;
    let scheduler = host.scheduler();
    let owners = Arc::new(std::sync::Mutex::new(Some((
        settings, session, location, scheduler,
    ))));
    let setup_owners = owners.clone();
    let app = tauri::Builder::default()
        .manage(router.clone())
        .manage(shutdown.clone())
        .manage(shutdown_authority)
        .manage(force_reporter)
        .register_uri_scheme_protocol("fixture-resource", move |context, request| {
            route.respond(context.webview_label(), &request)
        })
        .invoke_handler(tauri::generate_handler![
            commands::session_handshake,
            commands::bootstrap_status,
            commands::settings_read,
            commands::settings_save,
            commands::settings_result,
            commands::settings_application_status,
            commands::settings_attach,
            commands::settings_attachment_read,
            commands::settings_ack,
            commands::settings_renew,
            commands::settings_detach,
            commands::fixture_report,
            crate::shutdown_commands::shutdown_connect,
            crate::shutdown_commands::shutdown_prepare_force_quit,
            crate::shutdown_commands::shutdown_cancel_force_quit,
            crate::shutdown_commands::shutdown_confirm_force_quit
        ])
        .setup(move |app| {
            for (label, role) in [
                ("manager", Role::Manager),
                ("workspace-a", Role::Workspace),
                ("workspace-b", Role::Workspace),
                ("probe", Role::Probe),
            ] {
                crate::windows::create(
                    app.handle(),
                    &setup_host,
                    &setup_resources,
                    label,
                    role,
                    denial_policy,
                )?;
            }
            let handle = app.handle().clone();
            let (settings, session, location, scheduler) = setup_owners
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .take()
                .expect("single campaign owner");
            tauri::async_runtime::spawn(async move {
                execute_campaign(
                    handle,
                    setup_host,
                    setup_resources,
                    parent,
                    settings,
                    session,
                    location,
                    scheduler,
                    setup_cleaned,
                    setup_requested,
                )
                .await;
            });
            Ok(())
        })
        .build(tauri::generate_context!());
    let event_router = router.clone();
    match app {
        Ok(app) => app.run(move |_, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                if !cleaned.load(Ordering::Acquire) && !shutdown.is_forced() {
                    api.prevent_exit();
                    shutdown.begin();
                    requested.store(true, Ordering::Release);
                    event_router.stop_admission();
                }
            }
        }),
        Err(error) => {
            let retained = owners.lock().unwrap_or_else(|e| e.into_inner()).take();
            let cleanup = if let Some((settings, session, location, scheduler)) = retained {
                tauri::async_runtime::block_on(async {
                    host.stop_admission();
                    host.drain_attachments().await;
                    let joined = join_scheduler(scheduler).await;
                    host.stage("attachment-scheduler-joined", joined);
                    drain_settings(&host, settings).await;
                    let registry = session.owner.shutdown().await.is_ok();
                    drop(location);
                    joined && registry && resources.close_all()
                })
            } else {
                false
            };
            emit(
                &json!({"ok":false,"error":format!("Tauri setup failed: {error}"),"cleanupComplete":cleanup}),
            );
        }
    }
}
pub(crate) struct ReloadBaseline {
    pub session: String,
    pub attachment: String,
    pub sequence: i64,
    pub revision: registry::CommandResourceRevision,
}
// The reload test needs a real, newly acknowledged association. An expired,
// closing, pending or previously selected attachment is not a usable baseline.
pub(crate) fn reload_baseline(
    host: &Host,
    session: &str,
    excluded: &[String],
) -> Option<ReloadBaseline> {
    let s = host.lock();
    if s.stopping || host.association.is_closed() {
        return None;
    }
    let window = s.windows.get("workspace-b")?;
    if window.role != Role::Workspace || window.session != session {
        return None;
    }
    s.attachments.values().find_map(|a| {
        if a.label != "workspace-b" || a.session != session || excluded.contains(&a.id) {
            return None;
        }
        let state = a.lock();
        if state.closed || Instant::now() >= state.lease || state.delivery.is_some() {
            return None;
        }
        Some(ReloadBaseline {
            session: session.into(),
            attachment: a.id.clone(),
            sequence: state.sequence,
            revision: state.applied?,
        })
    })
}

pub(crate) async fn explicit_reload_reattach(
    host: &Host,
    session: &str,
    mut click: impl FnMut(&'static str) -> bool,
) -> Option<Vec<String>> {
    use std::{
        future::{poll_fn, Future},
        task::Poll,
    };
    host.authorize("workspace-b", session, 1, Some(Role::Workspace))
        .ok()?;
    let previous = host
        .lock()
        .attachments
        .values()
        .filter(|a| a.label == "workspace-b" && a.session == session)
        .cloned()
        .collect::<Vec<_>>();
    let excluded = previous.iter().map(|a| a.id.clone()).collect();
    // Detach is required even if the old native lease has already expired:
    // the frontend deliberately rejects reattachment while locally active.
    if !click("detach") {
        return None;
    }
    let cleanup = async {
        for attachment in &previous {
            attachment.drained().await;
        }
        previous
            .iter()
            .all(|a| a.lock().closed && a.finished.load(Ordering::Acquire))
    };
    let deadline = pause(5000);
    tokio::pin!(cleanup, deadline);
    let drained = poll_fn(|cx| {
        if let Poll::Ready(drained) = cleanup.as_mut().poll(cx) {
            return Poll::Ready(drained);
        }
        if deadline.as_mut().poll(cx).is_ready() {
            return Poll::Ready(false);
        }
        Poll::Pending
    })
    .await;
    if !drained {
        return None;
    }
    host.authorize("workspace-b", session, 1, Some(Role::Workspace))
        .ok()?;
    if !click("reattach") {
        return None;
    }
    Some(excluded)
}

async fn window_lifetime_campaign(
    app: &tauri::AppHandle,
    host: &Arc<Host>,
    resources: &Arc<Resources>,
    denial_policy: bool,
) {
    let before = host.popup_denials.load(Ordering::Acquire);
    if let Some(w) = app.get_webview_window("manager") {
        let _ = w.eval("window.open('https://example.invalid/fixture-popup','_blank')");
    }
    for _ in 0..20 {
        if host.popup_denials.load(Ordering::Acquire) > before {
            break;
        }
        pause(50).await;
    }
    host.stage(
        "packaged-popup-native-denial",
        host.popup_denials.load(Ordering::Acquire) > before && app.webview_windows().len() == 4,
    );
    let probe = host.lock().windows.get("probe").map(|w| w.session.clone());
    if let Some(w) = app.get_webview_window("probe") {
        let _ = w.eval("location.href='https://example.invalid/forbidden-navigation'");
    }
    for _ in 0..20 {
        if !host.lock().windows.contains_key("probe") {
            break;
        }
        pause(50).await;
    }
    let navigation_revoked = probe
        .as_ref()
        .is_some_and(|session| host.authorize("probe", session, 1, None).is_err())
        && !host.lock().windows.contains_key("probe");
    host.stage(
        "packaged-navigation-revokes-before-denial",
        navigation_revoked,
    );
    let old_session = host
        .lock()
        .windows
        .get("workspace-b")
        .map(|w| w.session.clone());
    // B may still be healthy after A's freeze. Follow the frontend's explicit
    // detach/drain/reattach contract in both healthy and expired cases.
    let previous_attachments = if let Some(session) = old_session.as_deref() {
        explicit_reload_reattach(host, session, |control| {
            app.get_webview_window("workspace-b").is_some_and(|w| {
                w.eval(format!("document.getElementById('{control}')?.click()"))
                    .is_ok()
            })
        })
        .await
    } else {
        None
    };
    host.stage(
        "packaged-explicit-detach-before-reattach",
        previous_attachments.is_some(),
    );
    let mut baseline = None;
    if let (Some(session), Some(previous)) =
        (old_session.as_deref(), previous_attachments.as_deref())
    {
        for _ in 0..100 {
            baseline = reload_baseline(host, session, previous);
            if baseline.is_some() {
                break;
            }
            pause(100).await;
        }
    }
    host.stage(
        "packaged-reload-acknowledged-attachment-baseline",
        baseline.is_some(),
    );
    let Some(baseline) = baseline else {
        host.stage("packaged-delayed-old-document-ack-denied", false);
        return;
    };
    let old_session = baseline.session;
    let old_attachment = baseline.attachment;
    if let Some(w) = app.get_webview_window("workspace-b") {
        let _ = w.eval("location.reload()");
    }
    for _ in 0..20 {
        if !host.lock().windows.contains_key("workspace-b") {
            break;
        }
        pause(50).await;
    }
    let reload_revoked = !host.lock().windows.contains_key("workspace-b");
    host.stage("packaged-reload-revokes-document-session", reload_revoked);
    if let Some(w) = app.get_webview_window("workspace-b") {
        let _ = w.close();
    }
    for _ in 0..50 {
        if app.get_webview_window("workspace-b").is_none() {
            break;
        }
        pause(50).await;
    }
    let replacement = crate::windows::create(
        app,
        host,
        resources,
        "workspace-b",
        Role::Workspace,
        denial_policy,
    );
    let Ok(new_session) = replacement else {
        host.stage("packaged-label-reuse-new-lifetime", false);
        return;
    };
    for _ in 0..50 {
        let applied = { reload_baseline(host, &new_session, &[]).is_some() };
        if applied {
            break;
        }
        pause(100).await;
    }
    let new_attachment = reload_baseline(host, &new_session, &[]).map(|a| a.attachment);
    host.stage(
        "packaged-label-reuse-new-lifetime",
        old_session != new_session
            && new_attachment
                .as_ref()
                .is_some_and(|new| new != &old_attachment),
    );
    if let Some(window) = app.get_webview_window("workspace-b") {
        let stale = json!({"version":1,"session":old_session,"epoch":host.epoch,"attachment":old_attachment,"sequence":baseline.sequence.to_string(),"revision":baseline.revision});
        let report = json!({"version":1,"session":new_session});
        let script=format!("void window.__TAURI_INTERNALS__.invoke('settings_ack',{{payload:JSON.stringify({stale})}}).then(()=>false,()=>true).then(ok=>window.__TAURI_INTERNALS__.invoke('fixture_report',{{payload:JSON.stringify({{...{report},cases:[{{name:'stale-document-ack-denied',ok}}]}})}}));");
        let _ = window.eval(script);
        for _ in 0..20 {
            let reported = {
                let s = host.lock();
                s.reports.get("workspace-b").is_some_and(|cases| {
                    cases
                        .iter()
                        .any(|c| c.name == "stale-document-ack-denied" && c.ok)
                })
            };
            if reported {
                break;
            }
            pause(50).await;
        }
        let denied = {
            let s = host.lock();
            s.reports.get("workspace-b").is_some_and(|cases| {
                cases
                    .iter()
                    .any(|c| c.name == "stale-document-ack-denied" && c.ok)
            })
        };
        host.stage(
            "packaged-delayed-old-document-ack-denied",
            denied
                && host
                    .authorize(
                        "workspace-b",
                        stale["session"].as_str().expect("native old session"),
                        1,
                        Some(Role::Workspace),
                    )
                    .is_err(),
        );
    } else {
        host.stage("packaged-delayed-old-document-ack-denied", false);
    }
}

pub(crate) struct CampaignWatchdog {
    stop: Arc<(std::sync::Mutex<bool>, std::sync::Condvar)>,
    task: std::thread::JoinHandle<bool>,
}
impl CampaignWatchdog {
    pub(crate) fn start() -> Self {
        let stop = Arc::new((std::sync::Mutex::new(false), std::sync::Condvar::new()));
        let signal = stop.clone();
        let task = std::thread::spawn(move || {
            let (lock, wake) = &*signal;
            let (finished, timeout) = wake
                .wait_timeout_while(
                    lock.lock().unwrap_or_else(|e| e.into_inner()),
                    Duration::from_secs(120),
                    |finished| !*finished,
                )
                .unwrap_or_else(|e| e.into_inner());
            if timeout.timed_out() && !*finished {
                eprintln!("APPLICATION_INTEGRATION_WATCHDOG {{\"ok\":false,\"cleanupComplete\":false,\"reason\":\"native-campaign-deadline\"}}");
                return false;
            }
            true
        });
        Self { stop, task }
    }
    pub(crate) fn finish(self) -> bool {
        let (lock, wake) = &*self.stop;
        *lock.lock().unwrap_or_else(|e| e.into_inner()) = true;
        wake.notify_all();
        self.task.join().unwrap_or(false)
    }
}
#[allow(clippy::too_many_arguments)]
async fn execute_campaign(
    app: tauri::AppHandle,
    host: Arc<Host>,
    resources: Arc<Resources>,
    parent: OwnedParent,
    settings: SettingsOwner,
    session: registry::RegistrySession,
    location: registry::LocationLease,
    scheduler: std::thread::JoinHandle<()>,
    cleaned: Arc<AtomicBool>,
    requested: Arc<AtomicBool>,
) {
    let authority = app
        .state::<Arc<crate::shutdown_window::ShutdownWindowAuthority>>()
        .inner()
        .clone();
    let status_done = Arc::new(AtomicBool::new(false));
    let status_task =
        crate::shutdown_campaign::scheduler(app.clone(), authority.clone(), status_done.clone());
    if parent.shutdown_scenario.is_some() {
        crate::shutdown_campaign::execute(
            app,
            host,
            resources,
            parent,
            settings,
            session,
            location,
            scheduler,
            cleaned,
            requested,
            status_done,
            status_task,
        )
        .await;
        return;
    }
    let shutdown = authority.controller();
    let start = Instant::now();
    let watchdog = CampaignWatchdog::start();
    let campaign = async {
        // Native eval operates fixed DOM controls. No script-exposed fixture mutator exists.
        for _ in 0..150 {
            let ready = {
                let s = host.lock();
                s.reports.contains_key("probe")
                    && s.reports.contains_key("workspace-a")
                    && s.reports.contains_key("workspace-b")
            };
            if ready || requested.load(Ordering::Acquire) {
                break;
            }
            pause(100).await;
        }
        for label in ["workspace-a", "workspace-b"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.eval("document.getElementById('report')?.click()");
            }
        }
        if let Some(w) = app.get_webview_window("manager") {
            let _=w.eval("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Report observations')?.click()");
        }
        pause(250).await;
        resources.clear_observations();
        for label in ["manager", "workspace-a", "workspace-b", "probe"] {
            let session = host.lock().windows.get(label).map(|w| w.session.clone());
            if let (Some(window), Some(session)) = (app.get_webview_window(label), session) {
                let url = serde_json::to_string(&resources.url).expect("fixed resource URL");
                let dto = serde_json::to_string(&json!({"version":1,"session":session}))
                    .expect("fixed report DTO");
                let _=window.eval(format!("void fetch({url}).then(()=>false,()=>true).then(ok=>window.__TAURI_INTERNALS__.invoke('fixture_report',{{payload:JSON.stringify({{...{dto},cases:[{{name:'resource-csp-blocked',ok}}]}})}}));"));
            }
        }
        for _ in 0..30 {
            let observed = if parent.resource_denial_policy {
                resources.observations().len() == 4
            } else {
                let s = host.lock();
                ["manager", "workspace-a", "workspace-b", "probe"]
                    .iter()
                    .all(|label| {
                        s.reports.get(*label).is_some_and(|cases| {
                            cases
                                .iter()
                                .any(|c| c.name == "resource-csp-blocked" && c.ok)
                        })
                    })
            };
            if observed {
                break;
            }
            pause(100).await;
        }
        let resource_requests = resources.observations();
        if parent.resource_denial_policy {
            host.stage(
                "packaged-actual-requester-inert-resource-access",
                resource_requests.get("workspace-a") == Some(&200)
                    && resource_requests.get("workspace-b") == Some(&200)
                    && resource_requests.get("manager") == Some(&403)
                    && resource_requests.get("probe") == Some(&403),
            );
        } else {
            let blocked = {
                let s = host.lock();
                ["manager", "workspace-a", "workspace-b", "probe"]
                    .iter()
                    .all(|label| {
                        s.reports.get(*label).is_some_and(|cases| {
                            cases
                                .iter()
                                .any(|c| c.name == "resource-csp-blocked" && c.ok)
                        })
                    })
            };
            host.stage(
                "packaged-strict-csp-blocks-resource-connectivity",
                resource_requests.is_empty() && blocked,
            );
        }
        let rows = host.application_status();
        host.stage(
            "two-native-initial-acknowledgments",
            rows.as_array().is_some_and(|rows| {
                rows.len() == 2 && rows.iter().all(|r| r["state"] == "applied")
            }),
        );
        let workspaces_denied = crate::workspace_denial::exercise(&app, &host).await;
        host.stage(
            "packaged-workspace-management-invokes-denied",
            workspaces_denied,
        );
        for label in ["workspace-a", "workspace-b"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.eval("document.getElementById('start-command')?.click()");
            }
        }
        pause(100).await;
        for label in ["workspace-a", "workspace-b"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.eval("document.getElementById('cancel-command')?.click()");
            }
        }
        pause(100).await;
        let manager = host
            .lock()
            .windows
            .get("manager")
            .map(|w| w.session.clone());
        let mut expected = None;
        if let (Some(manager), Ok(initial)) = (manager, host.operations.read().await) {
            let mut limits = wire::Limits::from(&initial.saved.settings);
            limits.max_window_pending = 1;
            let request = wire::Save {
                version: 1,
                session: manager.clone(),
                request_id: "1".into(),
                expected_revision: initial.saved.revision,
                settings: limits,
            };
            if let Ok((id, true)) = host.reserve_save("manager", request.clone(), Instant::now()) {
                let completion = commands::SaveCompletion::new(host.clone(), manager.clone(), id);
                let result = commands::execute_save(&host, &request).await;
                completion.complete(result.clone());
                let result = result.unwrap_or_else(|error| error);
                host.stage("native-admitted-save-confirmed", result["kind"] == "saved");
                host.stage(
                    "native-identical-duplicate-not-replayed",
                    matches!(
                        host.reserve_save("manager", request.clone(), Instant::now()),
                        Ok((1, false))
                    ),
                );
                let mut changed = request.clone();
                changed.settings.max_window_pending = 258;
                host.stage(
                    "native-duplicate-payload-mismatch-denied",
                    host.reserve_save("manager", changed, Instant::now())
                        .is_err(),
                );
                let mut stale = request;
                stale.request_id = "2".into();
                stale.settings.max_window_pending = 259;
                if let Ok((id, true)) = host.reserve_save("manager", stale.clone(), Instant::now())
                {
                    let completion =
                        commands::SaveCompletion::new(host.clone(), manager.clone(), id);
                    let conflict = commands::execute_save(&host, &stale).await;
                    completion.complete(conflict.clone());
                    let conflict = conflict.unwrap_or_else(|error| error);
                    host.stage(
                        "real-stale-revision-conflict",
                        conflict["kind"] == "conflict",
                    );
                } else {
                    host.stage("real-stale-revision-conflict", false);
                }
                expected = host.operations.read().await.ok().map(|s| s.saved);
                if let Some(saved) = expected {
                    let noop = wire::Save {
                        version: 1,
                        session: manager.clone(),
                        request_id: "3".into(),
                        expected_revision: saved.revision,
                        settings: wire::Limits::from(&saved.settings),
                    };
                    if let Ok((id, true)) =
                        host.reserve_save("manager", noop.clone(), Instant::now())
                    {
                        let completion =
                            commands::SaveCompletion::new(host.clone(), manager.clone(), id);
                        let result = commands::execute_save(&host, &noop).await;
                        completion.complete(result.clone());
                        let result = result.unwrap_or_else(|error| error);
                        host.stage(
                            "real-noop-preserves-revision",
                            result["kind"] == "saved"
                                && result["snapshot"]["revision"] == json!(saved.revision),
                        );
                    } else {
                        host.stage("real-noop-preserves-revision", false);
                    }
                }
            } else {
                host.stage("native-admitted-save-confirmed", false);
            }
        } else {
            host.stage("native-authoritative-read", false);
        }
        // Give genuine workspace post-application acknowledgments time to arrive.
        for _ in 0..50 {
            let rows = host.application_status();
            if rows.as_array().is_some_and(|rows| {
                rows.len() == 2
                    && rows.iter().all(|r| {
                        r["state"] == "applied"
                            && expected
                                .as_ref()
                                .is_some_and(|e| r["revision"] == json!(e.revision))
                    })
            }) {
                break;
            }
            pause(100).await;
        }
        let rows = host.application_status();
        host.stage(
            "two-native-saved-revision-acknowledgments",
            rows.as_array().is_some_and(|rows| {
                rows.len() == 2
                    && rows.iter().all(|r| {
                        r["state"] == "applied"
                            && expected
                                .as_ref()
                                .is_some_and(|e| r["revision"] == json!(e.revision))
                    })
            }),
        );
        for label in ["workspace-a", "workspace-b"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.eval("document.getElementById('report')?.click()");
            }
        }
        pause(150).await;
        let held_observations = {
            let s = host.lock();
            ["workspace-a", "workspace-b"].iter().all(|label| {
                s.reports.get(*label).is_some_and(|cases| {
                    cases.iter().any(|c| {
                        c.name == "workspace-cancelled-unfinished-retains-accounting" && c.ok
                    })
                })
            })
        };
        host.stage(
            "controlled-cancellation-retention-observations",
            held_observations,
        );
        for label in ["workspace-a", "workspace-b"] {
            if let Some(w) = app.get_webview_window(label) {
                let _ = w.eval("document.getElementById('finish-command')?.click()");
            }
        }
        pause(150).await;
        let before_attachment = {
            let s = host.lock();
            s.attachments
                .values()
                .find(|a| a.label == "workspace-a")
                .map(|a| a.id.clone())
        };
        if let Some(w) = app.get_webview_window("workspace-a") {
            let _ = w.eval("document.getElementById('freeze')?.click()");
        }
        pause(32_000).await;
        let frozen_stale = host.application_status().as_array().is_some_and(|rows| {
            rows.iter()
                .any(|r| r["window"] == "workspace-a" && r["state"] == "stale")
        });
        host.stage("native-frozen-workspace-lease-expires", frozen_stale);
        if let Some(w) = app.get_webview_window("workspace-a") {
            let _ = w.eval("document.getElementById('report')?.click()");
        }
        pause(200).await;
        let freeze_observation = {
            let s = host.lock();
            s.reports.get("workspace-a").is_some_and(|cases| {
                cases
                    .iter()
                    .any(|c| c.name == "workspace-frozen-synchronous-admission-rejected" && c.ok)
            })
        };
        host.stage("frozen-synchronous-gate-observation", freeze_observation);
        if let Some(w) = app.get_webview_window("workspace-a") {
            let _ = w.eval("document.getElementById('reattach')?.click()");
        }
        for _ in 0..50 {
            let fresh = {
                let s = host.lock();
                s.attachments.values().any(|a| {
                    a.label == "workspace-a"
                        && Some(&a.id) != before_attachment.as_ref()
                        && a.lock().applied.is_some()
                })
            };
            if fresh {
                break;
            }
            pause(100).await;
        }
        host.stage("explicit-reattach-fresh-native-identity", {
            let s = host.lock();
            s.attachments.values().any(|a| {
                a.label == "workspace-a"
                    && Some(&a.id) != before_attachment.as_ref()
                    && a.lock().applied.is_some()
            })
        });
        let observations = {
            let s = host.lock();
            serde_json::to_value(&s.reports).unwrap_or(Value::Null)
        };
        host.stage(
            "probe-raw-invoke-observations",
            observations["probe"].as_array().is_some_and(|v| {
                let probe = v
                    .iter()
                    .filter(|c| {
                        c["name"]
                            .as_str()
                            .is_some_and(|name| name.starts_with("probe-denied-"))
                    })
                    .collect::<Vec<_>>();
                probe.len() == 5 && probe.iter().all(|c| c["ok"] == true)
            }),
        );
        window_lifetime_campaign(&app, &host, &resources, parent.resource_denial_policy).await;
        let manager_visible = if let Some(saved) = expected.as_ref() {
            crate::replacement_shell::primary_manager_observation(&app, &host, saved).await
        } else {
            false
        };
        host.stage(
            "packaged-primary-manager-saved-settings-visible",
            manager_visible,
        );
        (expected, observations, resource_requests)
    };
    let outcome = until_stopped(&host, campaign).await;
    let interrupted = outcome.is_none();
    let (expected, observations, resource_requests) =
        outcome.unwrap_or_else(|| (None, Value::Null, Default::default()));
    host.stage("campaign-not-interrupted", !interrupted);
    let previous = if interrupted {
        None
    } else {
        host.operations.read().await.ok()
    };
    let retired_attachments = host
        .lock()
        .attachments
        .values()
        .cloned()
        .collect::<Vec<_>>();
    host.stop_admission();
    let cleanup_start = Instant::now();
    if interrupted {
        shutdown.begin();
        shutdown.progress("attachments", "Draining attachments after interruption");
    }
    host.drain_attachments().await;
    let scheduler_clean = join_scheduler(scheduler).await;
    host.stage("attachment-scheduler-joined", scheduler_clean);
    shutdown.progress("settings-results", "Draining settings and retained results");
    drain_settings(&host, settings).await;
    host.stage("settings-and-attachments-awaited", true);
    let retired_registry = session.handle.clone();
    shutdown.progress("registry", "Waiting for registry cleanup");
    let registry_clean = session.owner.shutdown().await.is_ok();
    if !registry_clean {
        shutdown.fail("Registry cleanup failed");
    }
    host.stage("registry-shutdown-awaited", registry_clean);
    shutdown.progress("ownership", "Releasing location ownership");
    drop(location);
    let resource_clean = resources.close_all();
    host.stage("inert-resources-released", resource_clean);
    let reopened = if interrupted {
        None
    } else {
        Some(opening(&parent).await)
    };
    let mut reopen_clean = false;
    let mut persisted = false;
    if let Some(Ok((location, session))) = reopened {
        if let Ok(saved) = session.handle.read_command_resource_settings().await {
            persisted = expected
                .as_ref()
                .is_some_and(|e| e.revision == saved.revision && e.settings == saved.settings);
        }
        reopen_clean = session.owner.shutdown().await.is_ok();
        drop(location);
    }
    host.stage("real-sqlite-clean-reopen-persistence", persisted);
    host.stage("reopened-registry-shutdown-awaited", reopen_clean);
    let router = app
        .state::<Arc<crate::router::HostRouter>>()
        .inner()
        .clone();
    let replacement =
        if !interrupted && scheduler_clean && registry_clean && reopen_clean && persisted {
            crate::replacement::exercise(
                &parent,
                &host,
                &retired_registry,
                previous.as_deref(),
                &retired_attachments,
                &requested,
                Some(crate::replacement::ReplacementShell {
                    app: &app,
                    router: &router,
                    resources: &resources,
                    denial_policy: parent.resource_denial_policy,
                }),
            )
            .await
        } else {
            crate::replacement::ReplacementResult::skipped()
        };
    host.stage("native-replacement-campaign-complete", replacement.ok);
    host.stage(
        "packaged-cross-service-explicit-reattachment",
        replacement.frontend_reattached,
    );
    // Primary retirement/reopen/replacement above is internal verification, not
    // final application shutdown. Closing the router earlier prevents replacement.
    shutdown.begin();
    router.stop_admission();
    shutdown.progress(
        "ownership",
        "Final campaign owners have released their locations",
    );
    let mut gaps = vec!["Windows, Linux and minimum macOS remain unverified"];
    if !replacement.frontend_reattached {
        gaps.push("Cross-service frontend reattachment did not complete successfully in this run");
    }
    let cleanup_complete = scheduler_clean
        && registry_clean
        && (interrupted || reopen_clean)
        && resource_clean
        && replacement.cleanup_complete;
    if !crate::shutdown_campaign::claim_clean_exit(shutdown, cleanup_complete) {
        // Force owns termination, or failed cleanup must remain available for
        // manual force. Keep the status scheduler and runtime running in either case.
        return;
    }
    host.stage("native-watchdog-not-expired", watchdog.finish());
    let stages = host.lock().native_stages.clone();
    let native_ok = stages.iter().all(|s| s["ok"] == true);
    let _ = authority.close_if_complete(&app);
    status_done.store(true, Ordering::Release);
    let _ = status_task.await;
    let report = json!({"version":1,"ok":native_ok&&!requested.load(Ordering::Acquire),"runId":parent.run_id,"cleanupComplete":cleanup_complete,"nativeStages":stages,"cases":observations,"durationMs":start.elapsed().as_millis(),"cleanupMs":cleanup_start.elapsed().as_millis(),"platform":{"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"webviewRuntime":tauri::webview_version().ok()},"fixture":{"crateVersion":env!("CARGO_PKG_VERSION"),"nativeSourceSha256":env!("FIXTURE_NATIVE_SHA256"),"frontendDistSha256":env!("FIXTURE_FRONTEND_SHA256"),"debugAssertions":cfg!(debug_assertions),"resourcePolicy":if parent.resource_denial_policy {"requester-denial"}else{"strict-baseline"},"resourceRequestStatuses":resource_requests,"preseededSchema":2,"replacement":replacement,"publicationAttempted":false,"retainedData":"runner-owned parent; no native deletion"},"gaps":gaps});
    // Evidence uses create_new outside registry storage; never overwrite previous evidence.
    let evidence = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(parent.parent.join("native-result.json"));
    let report = match evidence.and_then(|mut file| file.write_all(report.to_string().as_bytes())) {
        Ok(()) => report,
        Err(_) => {
            json!({"ok":false,"error":"native evidence write failed","cleanupComplete":cleanup_complete})
        }
    };
    emit(&report);
    cleaned.store(true, Ordering::Release);
    host.changed.notify_waiters();
    app.exit(if report["ok"] == true { 0 } else { 1 });
}
