//! Native-only scenario driving. No fixture mutation or observation IPC is exposed.
use crate::{
    campaign::{drain_settings, join_scheduler, pause},
    commands,
    owned::{OwnedParent, ShutdownScenario},
    plugin_registry::{self as registry, command_resource_settings::SettingsOwner},
    policy::Host,
    resources::Resources,
    router::HostRouter,
    shutdown::{Phase, ShutdownController},
    shutdown_window::{ShutdownWindowAuthority, LABEL},
    wire,
};
use serde_json::{json, Value};
use std::{
    io::Write,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};
use tauri::{Manager, WebviewWindow};

/// Only this successful controller transition authorizes normal evidence and
/// process exit. A failure stays unfinished for manual force; confirmed force
/// and successful completion compete under the controller's own state lock.
pub(crate) fn claim_clean_exit(controller: &ShutdownController, cleanup_complete: bool) -> bool {
    if !cleanup_complete {
        controller.fail("Campaign cleanup is incomplete");
        return false;
    }
    controller.complete()
}

pub(crate) fn record(parent: &OwnedParent, report: Value) -> Value {
    let result = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(parent.parent.join("native-result.json"))
        .and_then(|mut file| {
            file.write_all(report.to_string().as_bytes())?;
            file.sync_all()
        });
    let report = if result.is_ok() {
        report
    } else {
        json!({"version":1,"runId":parent.run_id,"ok":false,"cleanupComplete":report["cleanupComplete"],"shutdownScenario":report["shutdownScenario"],"shutdown":report["shutdown"],"error":"native evidence write failed"})
    };
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "APPLICATION_INTEGRATION_RESULT {report}");
    let _ = out.flush();
    report
}

pub(crate) fn report(
    parent: &OwnedParent,
    host: &Host,
    controller: &ShutdownController,
    ok: bool,
    cleanup: bool,
) -> Value {
    json!({"version":1,"runId":parent.run_id,"ok":ok,"cleanupComplete":cleanup,
        "shutdownScenario":parent.shutdown_scenario.map(ShutdownScenario::name),
        "nativeStages":host.lock().native_stages.clone(),"shutdown":controller.snapshot(),
        "fixture":{"nativeSourceSha256":env!("FIXTURE_NATIVE_SHA256"),"frontendDistSha256":env!("FIXTURE_FRONTEND_SHA256"),"publicationAttempted":false}})
}

pub(crate) fn scheduler(
    app: tauri::AppHandle,
    authority: Arc<ShutdownWindowAuthority>,
    done: Arc<AtomicBool>,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        while !done.load(Ordering::Acquire) {
            if let Err(error) = authority.show_if_due(&app) {
                authority
                    .controller()
                    .fail(&format!("Shutdown status presentation failed: {error}"));
            }
            pause(25).await;
        }
        let _ = authority.close_if_complete(&app);
    })
}

async fn evaluate(window: &WebviewWindow, script: &str) -> Option<Value> {
    let (tx, mut rx) = tokio::sync::mpsc::channel(1);
    window
        .eval_with_callback(script, move |value| {
            let _ = tx.try_send(value);
        })
        .ok()?;
    for _ in 0..100 {
        if let Ok(value) = rx.try_recv() {
            return serde_json::from_str(&value).ok();
        }
        pause(25).await;
    }
    None
}
async fn check(window: &WebviewWindow, expression: &str) -> bool {
    evaluate(window, expression).await == Some(Value::Bool(true))
}
async fn wait_check(window: &WebviewWindow, expression: &str) -> bool {
    for _ in 0..100 {
        if check(window, expression).await {
            return true;
        }
        pause(50).await;
    }
    false
}

async fn peer_denials(app: &tauri::AppHandle, session: &str, attempt: &str) -> bool {
    let payload = json!({"version":1,"session":session,"attempt":attempt,"confirmation":"copied"});
    let mut all = true;
    for label in ["manager", "workspace-a", "workspace-b", "probe"] {
        let Some(window) = app.get_webview_window(label) else {
            return false;
        };
        // Use valid per-command DTO shapes, including copied shutdown authority.
        let script = format!(
            r#"void(async()=>{{window.__nativeShutdownDenied=null;const p={payload};const calls=[['shutdown_connect',{{version:1}}],['shutdown_prepare_force_quit',{{version:1,session:p.session,attempt:p.attempt}}],['shutdown_cancel_force_quit',{{version:1,session:p.session,attempt:p.attempt}}],['shutdown_confirm_force_quit',p]];const denied=await Promise.all(calls.map(async([command,payload])=>{{try{{await window.__TAURI_INTERNALS__.invoke(command,{{payload:JSON.stringify(payload),events:'__CHANNEL__:0'}});return false;}}catch{{return true;}}}}));window.__nativeShutdownDenied=denied.length===4&&denied.every(Boolean);}})();"#
        );
        all &= window.eval(script).is_ok()
            && wait_check(&window, "window.__nativeShutdownDenied===true").await;
    }
    all
}

fn stale_reload_authority_denied(
    controller: &ShutdownController,
    old: &crate::shutdown::SessionRequest,
    token: &str,
    fresh_session: &str,
) -> bool {
    let confirmation = crate::shutdown::ConfirmRequest {
        version: 1,
        session: old.session.clone(),
        attempt: old.attempt.clone(),
        confirmation: token.into(),
    };
    let mut denied = true;
    for caller in [old.session.as_str(), fresh_session] {
        denied &= controller.prepare(caller, old).is_err();
        denied &= controller.cancel(caller, old).is_err();
        denied &= controller.confirm(caller, &confirmation).is_err();
    }
    // Even fresh session credentials cannot reuse the retired document's token.
    let fresh_confirmation = crate::shutdown::ConfirmRequest {
        session: fresh_session.into(),
        ..confirmation
    };
    denied
        && controller
            .confirm(fresh_session, &fresh_confirmation)
            .is_err()
}

async fn reload_controls(
    app: &tauri::AppHandle,
    host: &Host,
    authority: &ShutdownWindowAuthority,
    window: WebviewWindow,
) -> Option<WebviewWindow> {
    let replacement = async {
        let controller = authority.controller();
        let old = crate::shutdown::SessionRequest {
            version: 1,
            session: authority.caller(&window).ok()?,
            attempt: controller.snapshot().attempt,
        };
        let prepared = controller.prepare(&old.session, &old).ok()?;
        let destroyed = Arc::new(AtomicBool::new(false));
        let destroyed_event = destroyed.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                destroyed_event.store(true, Ordering::Release);
            }
        });
        window.eval("location.reload()").ok()?;
        drop(window);
        // A label is reused after native destruction. Never query authority or
        // evaluate scripts through the retired handle after requesting reload.
        for _ in 0..160 {
            if destroyed.load(Ordering::Acquire) {
                break;
            }
            pause(50).await;
        }
        if !destroyed.load(Ordering::Acquire) {
            return None;
        }
        for _ in 0..160 {
            if let Some(fresh) = app.get_webview_window(LABEL) {
                if let Ok(session) = authority.caller(&fresh) {
                    if session != old.session {
                        return Some((fresh, session, old, prepared.confirmation));
                    }
                }
            }
            pause(50).await;
        }
        None
    }
    .await;
    let new_lifetime = replacement
        .as_ref()
        .is_some_and(|(_, _, old, _)| authority.controller().snapshot().attempt == old.attempt);
    host.stage("shutdown-reload-new-lifetime", new_lifetime);
    let Some((fresh, session, old, token)) = replacement else {
        host.stage("shutdown-reload-channel-connected", false);
        host.stage("shutdown-reload-default-keep-waiting", false);
        host.stage("shutdown-reload-stale-confirmation-denied", false);
        return None;
    };
    let connected = wait_check(&fresh, "!!document.getElementById('force-quit') && !document.getElementById('force-quit').disabled && document.getElementById('shutdown-error').textContent===''").await;
    host.stage("shutdown-reload-channel-connected", connected);
    let focused = check(&fresh, "document.activeElement?.id==='keep-waiting'").await;
    host.stage("shutdown-reload-default-keep-waiting", focused);
    let stale_denied =
        stale_reload_authority_denied(authority.controller(), &old, &token, &session);
    host.stage(
        "shutdown-reload-stale-confirmation-denied",
        connected && stale_denied,
    );
    if new_lifetime && connected && focused && stale_denied {
        Some(fresh)
    } else {
        None
    }
}

async fn controls(
    app: &tauri::AppHandle,
    host: &Host,
    authority: &ShutdownWindowAuthority,
) -> bool {
    let mut window = None;
    for _ in 0..160 {
        window = app.get_webview_window(LABEL);
        if window.is_some() {
            break;
        }
        pause(50).await;
    }
    let Some(window) = window else {
        host.stage("shutdown-window-connected", false);
        return false;
    };
    let connected = wait_check(&window, "!!document.getElementById('force-quit') && !document.getElementById('force-quit').disabled && document.getElementById('shutdown-error').textContent===''").await;
    host.stage("shutdown-window-connected", connected);
    host.stage(
        "shutdown-default-keep-waiting",
        check(&window, "document.activeElement?.id==='keep-waiting'").await,
    );
    let copied = authority.caller(&window).ok();
    let denied = if let Some(session) = copied {
        peer_denials(app, &session, &authority.controller().snapshot().attempt).await
    } else {
        false
    };
    host.stage("shutdown-peer-authority-denied", denied);
    let manager = host
        .lock()
        .windows
        .get("manager")
        .map(|w| w.session.clone())
        .unwrap_or_default();
    let payload = json!({"version":1,"session":manager});
    let _ = window.eval(format!("void(async()=>{{window.__nativeSettingsDenied=null;try{{await window.__TAURI_INTERNALS__.invoke('settings_read',{{payload:JSON.stringify({payload})}});window.__nativeSettingsDenied=false;}}catch{{window.__nativeSettingsDenied=true;}}}})()"));
    host.stage(
        "shutdown-settings-authority-denied",
        wait_check(&window, "window.__nativeSettingsDenied===true").await,
    );
    let _ = window.eval("document.getElementById('force-quit').click()");
    let prepared = wait_check(&window, "document.getElementById('force-dialog').open && !document.getElementById('confirm-force').disabled").await;
    let warning = json!("Unfinished changes may not be saved. A transaction may already have committed without a delivered response.");
    host.stage("shutdown-exact-force-warning", prepared && check(&window, &format!("document.getElementById('force-warning').textContent==={warning} && document.activeElement?.id==='cancel-force'")).await);
    let _ = window.eval("document.getElementById('cancel-force').click()");
    let cancelled = wait_check(&window, "!document.getElementById('force-dialog').open && !document.getElementById('force-quit').disabled && document.activeElement?.id==='keep-waiting'").await;
    let _ = window.eval("document.getElementById('force-quit').click()");
    let prepared_again = wait_check(&window, "document.getElementById('force-dialog').open && !document.getElementById('confirm-force').disabled").await;
    // Dispatch the dialog's browser Escape/cancel event through its real handler.
    let _ = window.eval("document.getElementById('force-dialog').dispatchEvent(new Event('cancel',{cancelable:true}))");
    let escaped = wait_check(&window, "!document.getElementById('force-dialog').open && !document.getElementById('force-quit').disabled && document.activeElement?.id==='keep-waiting'").await;
    host.stage(
        "shutdown-confirmation-cancelled",
        cancelled && prepared_again && escaped && authority.controller().unfinished(),
    );
    let Some(window) = reload_controls(app, host, authority, window).await else {
        return false;
    };
    let close_requested = window.close().is_ok();
    pause(200).await;
    host.stage(
        "shutdown-close-prevented",
        close_requested
            && app.get_webview_window(LABEL).is_some()
            && authority.caller(&window).is_ok(),
    );
    pause(2200).await;
    host.stage(
        "shutdown-no-automatic-force",
        authority.controller().unfinished() && !authority.controller().is_forced(),
    );
    connected
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn execute(
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
    status_done: Arc<AtomicBool>,
    status_task: tauri::async_runtime::JoinHandle<()>,
) {
    let scenario = parent.shutdown_scenario.expect("native scenario branch");
    let authority = app.state::<Arc<ShutdownWindowAuthority>>().inner().clone();
    let controller = authority.controller();
    let watchdog = crate::campaign::CampaignWatchdog::start();
    // Establish real native document owners before closing ordinary admission.
    for _ in 0..150 {
        if host.lock().windows.values().all(|w| w.handshaken) {
            break;
        }
        pause(50).await;
    }
    let mut save = None;
    let mut release = None;
    if scenario == ShutdownScenario::ActiveSave {
        let manager = host
            .lock()
            .windows
            .get("manager")
            .map(|w| w.session.clone());
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
                let (tx, rx) = tokio::sync::oneshot::channel();
                release = Some(tx);
                let completion = commands::SaveCompletion::new(host.clone(), manager, id);
                let save_host = host.clone();
                save = Some(tauri::async_runtime::spawn(async move {
                    // Native delay holds an admitted real save, never a script mutation hook.
                    let _ = rx.await;
                    let result = commands::execute_save(&save_host, &request).await;
                    let saved = result.as_ref().is_ok_and(|r| r["kind"] == "saved");
                    completion.complete(result);
                    saved
                }));
            }
        }
        let admitted = save.is_some() && host.lock().records.iter().any(|r| r.result.is_none());
        host.stage("shutdown-active-save-admitted", admitted);
    }
    controller.begin();
    app.state::<Arc<HostRouter>>().stop_admission();
    controller.progress(
        "attachments",
        "Closing attachments and draining admitted work",
    );
    if scenario == ShutdownScenario::Failure {
        controller.fail("Simulated native finalization failure");
        let failure_at = Instant::now();
        let _ = authority.show_if_due(&app);
        for _ in 0..20 {
            if app.get_webview_window(LABEL).is_some() {
                break;
            }
            pause(25).await;
        }
        host.stage(
            "shutdown-failure-immediate",
            app.get_webview_window(LABEL).is_some()
                && failure_at.elapsed() < crate::shutdown::DISPLAY_DELAY,
        );
    }
    let controls_ok = controls(&app, &host, &authority).await;
    if scenario == ShutdownScenario::Force && controls_ok {
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.eval("document.getElementById('force-quit').click()");
            let prepared = wait_check(&window, "document.getElementById('force-dialog').open && !document.getElementById('confirm-force').disabled").await;
            if prepared {
                // The reporter records the confirmed transition, not this click.
                let _ = window.eval("document.getElementById('confirm-force').click()");
                for _ in 0..100 {
                    pause(50).await;
                }
            }
        }
        host.stage("shutdown-force-confirmed", false);
    }
    if let Some(release) = release {
        let _ = release.send(());
    }
    host.drain_attachments().await;
    let joined = join_scheduler(scheduler).await;
    controller.progress(
        "settings-results",
        "Waiting for admitted settings saves and result cleanup",
    );
    drain_settings(&host, settings).await;
    if let Some(save) = save {
        host.stage("shutdown-active-save-drained", save.await.unwrap_or(false));
    }
    controller.progress("registry", "Waiting for registry worker cleanup");
    let registry_clean = session.owner.shutdown().await.is_ok();
    if !registry_clean {
        controller.fail("Registry cleanup failed");
    }
    controller.progress("ownership", "Releasing application location ownership");
    drop(location);
    let resources_clean = resources.close_all();
    let cleanup = joined && registry_clean && resources_clean;
    if !claim_clean_exit(controller, cleanup) {
        // Do not stop the status scheduler or mark exit as clean. Failed cleanup
        // remains visible and can only terminate through confirmed manual force.
        return;
    }
    let _ = authority.close_if_complete(&app);
    host.stage(
        "shutdown-cleanup-awaited",
        cleanup && controller.snapshot().phase == Phase::Complete,
    );
    if scenario == ShutdownScenario::Failure {
        host.stage(
            "shutdown-original-failure-preserved",
            controller.snapshot().failure.as_deref()
                == Some("Simulated native finalization failure"),
        );
    }
    status_done.store(true, Ordering::Release);
    host.stage(
        "shutdown-status-scheduler-awaited",
        status_task.await.is_ok(),
    );
    host.stage("native-watchdog-not-expired", watchdog.finish());
    let ok = cleanup
        && scenario != ShutdownScenario::Force
        && !requested.load(Ordering::Acquire)
        && host.lock().native_stages.iter().all(|s| s["ok"] == true);
    let report = record(&parent, report(&parent, &host, controller, ok, cleanup));
    cleaned.store(true, Ordering::Release);
    host.changed.notify_waiters();
    app.exit(if report["ok"] == true { 0 } else { 1 });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn force_request(controller: &ShutdownController) -> crate::shutdown::ConfirmRequest {
        let session = controller.register_document().unwrap();
        let connected = controller
            .connect(
                &session,
                crate::shutdown::ConnectRequest { version: 1 },
                Arc::new(|_| true),
            )
            .unwrap();
        let request = crate::shutdown::SessionRequest {
            version: 1,
            session: session.clone(),
            attempt: connected.attempt.clone(),
        };
        let token = controller.prepare(&session, &request).unwrap();
        crate::shutdown::ConfirmRequest {
            version: 1,
            session,
            attempt: connected.attempt,
            confirmation: token.confirmation,
        }
    }

    #[test]
    fn reload_checks_deny_retired_authority_without_disrupting_fresh_confirmation() {
        let controller = ShutdownController::new();
        controller.begin();
        controller.fail("controlled reload eligibility");
        let retired = force_request(&controller);
        let old = crate::shutdown::SessionRequest {
            version: 1,
            session: retired.session.clone(),
            attempt: retired.attempt.clone(),
        };
        controller.revoke_document(&retired.session);
        let fresh = force_request(&controller);
        assert_ne!(fresh.session, retired.session);
        assert_eq!(fresh.attempt, retired.attempt);
        assert!(stale_reload_authority_denied(
            &controller,
            &old,
            &retired.confirmation,
            &fresh.session
        ));
        assert!(controller.unfinished());
        assert!(controller.confirm(&fresh.session, &fresh).is_ok());
    }

    #[test]
    fn failed_cleanup_does_not_claim_normal_exit_and_remains_manually_forceable() {
        let controller = ShutdownController::new();
        controller.begin();
        controller.fail("original cleanup failure");
        assert!(!claim_clean_exit(&controller, false));
        assert!(controller.unfinished());
        assert_eq!(controller.snapshot().phase, Phase::Failed);
        assert_eq!(
            controller.snapshot().failure.as_deref(),
            Some("original cleanup failure")
        );
        let request = force_request(&controller);
        assert!(controller.confirm(&request.session, &request).is_ok());
        assert!(!claim_clean_exit(&controller, false));
        assert!(!claim_clean_exit(&controller, true));
        assert_eq!(controller.snapshot().phase, Phase::Forced);
    }

    #[test]
    fn native_exit_claim_and_force_authorize_exactly_one_reporter() {
        for cleanup in [true, false] {
            for _ in 0..64 {
                let controller = ShutdownController::new();
                controller.begin();
                controller.fail("controlled eligibility");
                let request = force_request(&controller);
                let barrier = std::sync::Barrier::new(2);
                let (normal, forced) = std::thread::scope(|scope| {
                    let normal = scope.spawn(|| {
                        barrier.wait();
                        claim_clean_exit(&controller, cleanup)
                    });
                    let forced = scope.spawn(|| {
                        barrier.wait();
                        controller.confirm(&request.session, &request).is_ok()
                    });
                    (normal.join().unwrap(), forced.join().unwrap())
                });
                assert_ne!(normal, forced);
                assert_eq!(
                    controller.snapshot().phase,
                    if normal {
                        Phase::Complete
                    } else {
                        Phase::Forced
                    }
                );
                if !cleanup {
                    assert!(!normal);
                }
            }
        }
    }

    #[test]
    fn admitted_save_survives_shutdown_admission_and_is_really_persisted() {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap()
            .block_on(async {
                let dir = tempfile::tempdir().unwrap();
                let session = registry::Registry::create(
                    dir.path().join("registry.sqlite"),
                    crate::campaign::registry_limits(),
                    registry::RegistryCapacity::with_observers(16, 8, 16).unwrap(),
                )
                .await
                .unwrap();
                let settings = SettingsOwner::start(session.handle.clone(), 16, 16)
                    .await
                    .unwrap();
                let host = Host::new(settings.operations(), settings.association());
                let manager = host
                    .register("manager", crate::policy::Role::Manager)
                    .unwrap();
                let initial = host.operations.read().await.unwrap();
                let mut limits = wire::Limits::from(&initial.saved.settings);
                limits.max_window_pending = 1;
                let request = wire::Save {
                    version: 1,
                    session: manager.clone(),
                    request_id: "1".into(),
                    expected_revision: initial.saved.revision,
                    settings: limits,
                };
                let (id, admitted) = host
                    .reserve_save("manager", request.clone(), Instant::now())
                    .unwrap();
                assert!(admitted);
                let completion = commands::SaveCompletion::new(host.clone(), manager.clone(), id);
                host.stop_admission();
                assert!(host
                    .reserve_save("manager", request.clone(), Instant::now())
                    .is_err());
                let (release, admitted) = tokio::sync::oneshot::channel();
                let save_host = host.clone();
                let save = tokio::spawn(async move {
                    admitted.await.unwrap();
                    let result = commands::execute_save(&save_host, &request).await;
                    let saved = result
                        .as_ref()
                        .is_ok_and(|result| result["kind"] == "saved");
                    completion.complete(result);
                    saved
                });
                let drain = drain_settings(&host, settings);
                tokio::pin!(drain);
                // Poll the same helper used by normal, setup and replacement
                // cleanup while the wire-reserved task cannot enter settings.
                let pending = std::future::poll_fn(|cx| {
                    use std::future::Future;
                    std::task::Poll::Ready(drain.as_mut().poll(cx).is_pending())
                })
                .await;
                assert!(pending);
                assert!(host
                    .lock()
                    .records
                    .iter()
                    .any(|record| record.result.is_none()));
                release.send(()).unwrap();
                drain.await;
                assert!(
                    save.await.unwrap(),
                    "shutdown must not reject a previously reserved save"
                );
                // The result route is closed. This does not mean the committed write rolled back.
                assert!(host
                    .result("manager", &manager, 1, id, Instant::now())
                    .is_err());
                assert_eq!(
                    session
                        .handle
                        .read_command_resource_settings()
                        .await
                        .unwrap()
                        .settings
                        .max_window_pending,
                    1
                );
                session.owner.shutdown().await.unwrap();
            });
    }

    #[test]
    fn forced_evidence_is_failed_incomplete_and_never_overwrites_existing_evidence() {
        let dir = tempfile::tempdir().unwrap();
        let parent = OwnedParent {
            parent: dir.path().to_owned(),
            run_id: "a".repeat(32),
            inspect: false,
            resource_denial_policy: false,
            shutdown_scenario: Some(ShutdownScenario::Force),
        };
        let controller = ShutdownController::new();
        controller.begin();
        controller.fail("native controlled failure");
        let session = controller.register_document().unwrap();
        let connected = controller
            .connect(
                &session,
                crate::shutdown::ConnectRequest { version: 1 },
                Arc::new(|_| true),
            )
            .unwrap();
        let request = crate::shutdown::SessionRequest {
            version: 1,
            session: session.clone(),
            attempt: connected.attempt.clone(),
        };
        let confirmation = controller.prepare(&session, &request).unwrap();
        let evidence = controller
            .confirm(
                &session,
                &crate::shutdown::ConfirmRequest {
                    version: 1,
                    session: session.clone(),
                    attempt: connected.attempt,
                    confirmation: confirmation.confirmation,
                },
            )
            .unwrap();
        let report = json!({"version":1,"runId":parent.run_id,"ok":evidence.ok,"cleanupComplete":evidence.cleanup_complete,"shutdownScenario":"force","nativeStages":[{"name":"shutdown-force-confirmed","ok":true}],"shutdown":controller.snapshot(),"fixture":{"nativeSourceSha256":env!("FIXTURE_NATIVE_SHA256"),"frontendDistSha256":env!("FIXTURE_FRONTEND_SHA256"),"publicationAttempted":false}});
        let recorded = record(&parent, report.clone());
        assert_eq!(recorded, report);
        let path = dir.path().join("native-result.json");
        let bytes = std::fs::read(&path).unwrap();
        let saved: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(saved["ok"], false);
        assert_eq!(saved["cleanupComplete"], false);
        assert_eq!(saved["shutdown"]["phase"], "forced");
        assert_eq!(saved["shutdown"]["failure"], "native controlled failure");
        assert_eq!(
            record(&parent, json!({"ok":true,"cleanupComplete":false}))["ok"],
            false
        );
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn scenario_inventory_is_closed() {
        for name in ["slow", "failure", "active-save", "force"] {
            assert_eq!(ShutdownScenario::parse(name).unwrap().name(), name);
        }
        for name in ["", "save", "Force", "slow,force"] {
            assert!(ShutdownScenario::parse(name).is_err());
        }
    }
}
