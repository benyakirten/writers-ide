use super::*;

use plugin_registry::{
    command_resource_settings::SettingsOwner, Registry, RegistryCapacity, RegistrySession,
};
use policy::{Host, Role};
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
struct Fixture {
    _dir: tempfile::TempDir,
    session: RegistrySession,
    settings: SettingsOwner,
    host: Arc<Host>,
    manager: String,
}
impl Fixture {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let session = Registry::create(
            dir.path().join("registry.sqlite"),
            campaign::registry_limits(),
            RegistryCapacity::with_observers(16, 8, 16).unwrap(),
        )
        .await
        .unwrap();
        let settings = SettingsOwner::start(session.handle.clone(), 16, 16)
            .await
            .unwrap();
        let host = Host::new(settings.operations(), settings.association());
        let manager = host.register("manager", Role::Manager).unwrap();
        Self {
            _dir: dir,
            session,
            settings,
            host,
            manager,
        }
    }
    fn request(&self, id: i64) -> wire::Save {
        serde_json::from_value(json!({"version":1,"session":self.manager,"requestId":id.to_string(),"expectedRevision":"0","settings":wire::Limits::from(&plugin_registry::CommandResourceSettings::default())})).unwrap()
    }
    async fn finish(self) {
        self.host.drain_attachments().await;
        self.settings.shutdown().await;
        self.session.owner.shutdown().await.unwrap();
    }
}
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
}
#[test]
fn highwater_duplicates_busy_expiry_and_payload_mismatch() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        let now = Instant::now();
        let req = f.request(1);
        assert_eq!(
            f.host.reserve_save("manager", req.clone(), now).unwrap(),
            (1, true)
        );
        assert_eq!(
            f.host.reserve_save("manager", req.clone(), now).unwrap(),
            (1, false)
        );
        let mut different = req.clone();
        different.settings.max_window_pending += 1;
        assert_eq!(
            f.host.reserve_save("manager", different, now).unwrap_err()["code"],
            "payload-mismatch"
        );
        assert_eq!(
            f.host
                .reserve_save("manager", f.request(2), now)
                .unwrap_err()["code"],
            "busy"
        );
        assert!(f.host.reserve_save("manager", f.request(3), now).is_err());
        f.host.complete(&f.manager, 1, Ok(json!({"kind":"saved"})));
        let later = Instant::now() + Duration::from_secs(601);
        assert_eq!(
            f.host
                .result("manager", &f.manager, 1, 1, later)
                .unwrap_err()["code"],
            "result-expired"
        );
        assert_eq!(
            f.host.reserve_save("manager", req, later).unwrap_err()["code"],
            "result-expired"
        );
        assert_eq!(
            f.host.reserve_save("manager", f.request(2), later).unwrap(),
            (2, true)
        );
        f.host.complete(&f.manager, 2, Ok(json!({"kind":"saved"})));
        f.finish().await;
    });
}
#[test]
fn record_capacity_evicts_completed_but_not_highwater() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        for id in 1..=40 {
            assert!(
                f.host
                    .reserve_save("manager", f.request(id), Instant::now())
                    .unwrap()
                    .1
            );
            f.host.complete(&f.manager, id, Ok(json!({"kind":"saved"})));
        }
        assert_eq!(f.host.lock().records.len(), 32);
        assert_eq!(
            f.host
                .reserve_save("manager", f.request(1), Instant::now())
                .unwrap_err()["code"],
            "result-expired"
        );
        assert_eq!(
            f.host.handshake("manager").unwrap()["nextSaveSequence"],
            "41"
        );
        f.finish().await;
    });
}
#[test]
fn destroyed_manager_does_not_retarget_results_or_old_requests() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        let req = f.request(1);
        f.host
            .reserve_save("manager", req.clone(), Instant::now())
            .unwrap();
        f.host.revoke("manager");
        let replacement = f.host.register("manager", Role::Manager).unwrap();
        assert_ne!(replacement, f.manager);
        assert!(
            !f.host.revoke_lifetime("manager", &f.manager),
            "late old destruction must not revoke replacement"
        );
        assert!(f
            .host
            .authorize("manager", &replacement, 1, Some(Role::Manager))
            .is_ok());
        f.host.complete(&f.manager, 1, Ok(json!({"kind":"saved"})));
        assert!(f.host.reserve_save("manager", req, Instant::now()).is_err());
        assert_eq!(
            f.host
                .result("manager", &replacement, 1, 1, Instant::now())
                .unwrap_err()["code"],
            "result-expired"
        );
        assert_eq!(
            f.host.handshake("manager").unwrap()["nextSaveSequence"],
            "1"
        );
        f.finish().await;
    });
}
fn channel() -> (tauri::ipc::Channel<Value>, Arc<Mutex<Vec<Value>>>) {
    let messages = Arc::new(Mutex::new(Vec::new()));
    let out = messages.clone();
    (
        tauri::ipc::Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(raw) = body {
                out.lock()
                    .unwrap()
                    .push(serde_json::from_str(&raw).unwrap());
            }
            Ok(())
        }),
        messages,
    )
}
async fn delivered(messages: &Arc<Mutex<Vec<Value>>>, count: usize) {
    let deadline = Instant::now() + Duration::from_secs(2);
    while messages.lock().unwrap().len() < count {
        assert!(Instant::now() < deadline, "native delivery deadline");
        tokio::task::yield_now().await;
    }
}
fn attach(host: &Arc<Host>, label: &str, session: &str) -> (Value, Arc<Mutex<Vec<Value>>>) {
    let (events, messages) = channel();
    let identity = host
        .attach(
            label,
            wire::Attach {
                version: 1,
                session: session.into(),
                challenge: "12345678-1234-1234-1234-123456789abc".into(),
            },
            events,
        )
        .unwrap();
    (identity, messages)
}
#[test]
fn exact_ack_native_coalescing_and_foreign_identity() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        let session = f.host.register("workspace-a", Role::Workspace).unwrap();
        let (id, messages) = attach(&f.host, "workspace-a", &session);
        delivered(&messages, 1).await;
        let a = f
            .host
            .attachment(
                "workspace-a",
                1,
                &session,
                &f.host.epoch,
                id["attachment"].as_str().unwrap(),
            )
            .unwrap();
        let initial = a.lock().delivery.as_ref().unwrap().snapshot.clone();
        assert!(!a.acknowledge(2, initial.saved.revision));
        let other = f.host.register("workspace-b", Role::Workspace).unwrap();
        assert!(f
            .host
            .attachment("workspace-b", 1, &other, &f.host.epoch, &a.id)
            .is_err());
        let mut revision = initial.saved.revision;
        for n in [257, 258, 259] {
            let mut settings = initial.saved.settings;
            settings.max_window_pending = n;
            let result = f.host.operations.save(revision, settings).await.unwrap();
            if let plugin_registry::command_resource_settings::SaveOutcome::Saved(s) = result {
                revision = s.saved.revision;
            } else {
                panic!("unexpected conflict");
            }
        }
        assert_eq!(
            messages.lock().unwrap().len(),
            1,
            "send/read/save do not release native delivery"
        );
        assert!(a.acknowledge(1, initial.saved.revision));
        delivered(&messages, 2).await;
        let latest = a.lock().delivery.as_ref().unwrap().snapshot.clone();
        assert_eq!(latest.saved.revision, revision);
        assert_eq!(messages.lock().unwrap()[1]["sequence"], "2");
        assert!(!a.acknowledge(1, initial.saved.revision));
        assert!(a.acknowledge(2, revision));
        assert_eq!(f.host.application_status()[0]["state"], "applied");
        f.finish().await;
    });
}
#[test]
fn deadline_is_checked_synchronously_and_close_drains_subscription() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        let session = f.host.register("workspace-a", Role::Workspace).unwrap();
        let (id, messages) = attach(&f.host, "workspace-a", &session);
        delivered(&messages, 1).await;
        let a = f
            .host
            .attachment(
                "workspace-a",
                1,
                &session,
                &f.host.epoch,
                id["attachment"].as_str().unwrap(),
            )
            .unwrap();
        a.lock().lease = Instant::now() - Duration::from_secs(1);
        assert!(f
            .host
            .attachment("workspace-a", 1, &session, &f.host.epoch, &a.id)
            .is_err());
        a.drained().await;
        assert!(a.lock().subscription.is_none());
        assert!(a.lock().delivery.is_none());
        assert_eq!(messages.lock().unwrap().last().unwrap()["kind"], "closed");
        f.finish().await;
    });
}
#[test]
fn attachment_bounds_and_native_only_resource_authority() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        for index in 0..8 {
            let label = format!("workspace-{index}");
            let session = f.host.register(&label, Role::Workspace).unwrap();
            let _ = attach(&f.host, &label, &session);
        }
        let session = f.host.register("overflow", Role::Workspace).unwrap();
        let (events, _) = channel();
        assert!(f
            .host
            .attach(
                "overflow",
                wire::Attach {
                    version: 1,
                    session,
                    challenge: "12345678-1234-1234-1234-123456789abc".into()
                },
                events
            )
            .is_err());
        let resources = resources::Resources::new(f._dir.path()).unwrap();
        assert!(resources.native_policy_check());
        assert!(resources.close_all());
        f.finish().await;
    });
}
#[test]
fn pending_save_capacity_refuses_before_sequence_reservation() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        for _ in 0..16 {
            let session = f
                .host
                .lock()
                .windows
                .get("manager")
                .unwrap()
                .session
                .clone();
            let mut request = f.request(1);
            request.session = session;
            assert!(
                f.host
                    .reserve_save("manager", request, Instant::now())
                    .unwrap()
                    .1
            );
            f.host.revoke("manager");
            f.host.register("manager", Role::Manager).unwrap();
        }
        let session = f
            .host
            .lock()
            .windows
            .get("manager")
            .unwrap()
            .session
            .clone();
        let mut request = f.request(1);
        request.session = session.clone();
        assert_eq!(
            f.host
                .reserve_save("manager", request, Instant::now())
                .unwrap_err()["code"],
            "busy"
        );
        assert_eq!(
            f.host.handshake("manager").unwrap()["nextSaveSequence"],
            "1"
        );
        let pending = f
            .host
            .lock()
            .records
            .iter()
            .map(|r| (r.session.clone(), r.id))
            .collect::<Vec<_>>();
        for (session, id) in pending {
            f.host.complete(&session, id, Ok(json!({"kind":"saved"})));
        }
        f.finish().await;
    });
}
#[test]
fn sequence_exhaustion_never_wraps() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        f.host.lock().windows.get_mut("manager").unwrap().highwater = i64::MAX - 1;
        assert_eq!(
            f.host
                .reserve_save("manager", f.request(i64::MAX), Instant::now())
                .unwrap(),
            (i64::MAX, true)
        );
        f.host
            .complete(&f.manager, i64::MAX, Ok(json!({"kind":"saved"})));
        assert!(f.host.handshake("manager").is_err());
        assert_eq!(
            f.host
                .reserve_save("manager", f.request(1), Instant::now())
                .unwrap_err()["code"],
            "result-expired"
        );
        f.finish().await;
    });
}
#[test]
fn retained_native_failure_is_not_a_conflict_or_new_mutation() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        let request = f.request(1);
        f.host
            .reserve_save("manager", request.clone(), Instant::now())
            .unwrap();
        let error = wire::error(
            "outcome-unknown",
            "Native outcome requires controlled recovery",
        );
        f.host.complete(&f.manager, 1, Err(error.clone()));
        assert_eq!(
            f.host
                .result("manager", &f.manager, 1, 1, Instant::now())
                .unwrap_err(),
            error
        );
        assert!(
            !f.host
                .reserve_save("manager", request, Instant::now())
                .unwrap()
                .1
        );
        f.finish().await;
    });
}
#[test]
fn settings_close_has_multiple_waiters_and_stops_transport() {
    runtime().block_on(async {
        let f = Fixture::start().await;
        let session = f.host.register("workspace-a", Role::Workspace).unwrap();
        let (_, messages) = attach(&f.host, "workspace-a", &session);
        delivered(&messages, 1).await;
        let association = f.host.association.clone();
        let mut first = Box::pin(association.closed());
        let mut second = Box::pin(association.closed());
        {
            use std::future::Future;
            let mut context = std::task::Context::from_waker(std::task::Waker::noop());
            assert!(first.as_mut().poll(&mut context).is_pending());
            assert!(second.as_mut().poll(&mut context).is_pending());
        }
        f.settings.close();
        first.await;
        second.await;
        delivered(&messages, 2).await;
        assert_eq!(messages.lock().unwrap()[1]["kind"], "closed");
        f.finish().await;
    });
}

fn bounded_native(test: impl FnOnce() + Send + UnwindSafe + 'static) {
    let (send, receive) = std::sync::mpsc::sync_channel(1);
    let thread = std::thread::spawn(move || {
        let result = std::panic::catch_unwind(test);
        let _ = send.send(result);
    });
    if let Err(panic) = receive
        .recv_timeout(Duration::from_secs(10))
        .expect("native test hung")
    {
        std::panic::resume_unwind(panic);
    }
    thread.join().unwrap();
}
use std::panic::UnwindSafe;

#[test]
fn native_channel_reenters_ack_and_close_status_without_locks() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            let session = f.host.register("workspace-a", Role::Workspace).unwrap();
            let host = f.host.clone();
            let caller_session = session.clone();
            let seen = Arc::new(Mutex::new(Vec::new()));
            let output = seen.clone();
            let events = tauri::ipc::Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(raw) = body else {
                    panic!("JSON")
                };
                let event: Value = serde_json::from_str(&raw).unwrap();
                let _ = host.application_status();
                if event["kind"] == "snapshot" {
                    let a = host
                        .attachment(
                            "workspace-a",
                            1,
                            &caller_session,
                            &host.epoch,
                            event["attachment"].as_str().unwrap(),
                        )
                        .unwrap();
                    let ack = a.acknowledge(
                        wire::decimal(event["sequence"].as_str().unwrap(), true).unwrap(),
                        serde_json::from_value(event["revision"].clone()).unwrap(),
                    );
                    output
                        .lock()
                        .unwrap()
                        .push(json!({"kind":"snapshot","ack":ack}));
                    // A reentrant closure is serialized after this snapshot, not recursively sent.
                    host.revoke("workspace-a");
                } else {
                    output.lock().unwrap().push(event);
                }
                Ok(())
            });
            f.host
                .attach(
                    "workspace-a",
                    wire::Attach {
                        version: 1,
                        session,
                        challenge: "12345678-1234-1234-1234-123456789abc".into(),
                    },
                    events,
                )
                .unwrap();
            delivered(&seen, 2).await;
            assert_eq!(
                seen.lock().unwrap()[0],
                json!({"kind":"snapshot","ack":true})
            );
            assert_eq!(seen.lock().unwrap()[1]["kind"], "closed");
            f.finish().await;
        })
    });
}

#[test]
fn host_shutdown_channel_reenters_status_and_admission_is_sticky() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            let session = f.host.register("workspace-a", Role::Workspace).unwrap();
            let host = f.host.clone();
            let seen = Arc::new(Mutex::new(Vec::new()));
            let output = seen.clone();
            let events = tauri::ipc::Channel::new(move |body| {
                let tauri::ipc::InvokeResponseBody::Json(raw) = body else {
                    panic!("JSON")
                };
                let event: Value = serde_json::from_str(&raw).unwrap();
                let _ = host.application_status();
                output.lock().unwrap().push(event);
                Ok(())
            });
            f.host
                .attach(
                    "workspace-a",
                    wire::Attach {
                        version: 1,
                        session: session.clone(),
                        challenge: "12345678-1234-1234-1234-123456789abc".into(),
                    },
                    events,
                )
                .unwrap();
            delivered(&seen, 1).await;
            f.host.stop_admission();
            assert!(f.host.authorize("workspace-a", &session, 1, None).is_err());
            assert!(f.host.register("replacement", Role::Workspace).is_err());
            assert!(f
                .host
                .reserve_save("manager", f.request(1), Instant::now())
                .is_err());
            delivered(&seen, 2).await;
            assert_eq!(seen.lock().unwrap()[1]["kind"], "closed");
            f.finish().await;
        })
    });
}

#[test]
fn attachment_unpolled_cancelled_and_panicking_tasks_release_state() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            for mode in 0..3 {
                let (events, _) = channel();
                let a = transport::Attachment::new(
                    "detached",
                    "session".into(),
                    f.host.epoch.clone(),
                    events,
                );
                {
                    let snapshot = f.host.operations.read().await.unwrap();
                    let mut state = a.lock();
                    state.subscription = Some(f.host.association.subscribe(|_| {}).unwrap());
                    state.delivery = Some(transport::Delivery {
                        snapshot,
                        sequence: 1,
                        deadline: Instant::now() + Duration::from_secs(10),
                    });
                }
                a.activate();
                if mode == 0 {
                    // The guard is captured before the future is ever polled.
                    drop(transport::attachment_task(
                        a.clone(),
                        f.host.association.clone(),
                    ));
                } else if mode == 1 {
                    let task = tokio::spawn(transport::attachment_task(
                        a.clone(),
                        f.host.association.clone(),
                    ));
                    tokio::task::yield_now().await;
                    task.abort();
                    assert!(task.await.unwrap_err().is_cancelled());
                } else {
                    let guard = transport::AttachmentCompletion(a.clone());
                    let task = tokio::spawn(async move {
                        let _guard = guard;
                        panic!("attachment task fixture panic");
                    });
                    assert!(task.await.unwrap_err().is_panic());
                }
                a.drained().await;
                let state = a.lock();
                assert!(state.closed);
                assert!(state.subscription.is_none());
                assert!(state.delivery.is_none());
            }
            f.finish().await;
        })
    });
}

#[test]
fn channel_and_observer_destructor_panics_are_isolated() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            let session = f.host.register("workspace-a", Role::Workspace).unwrap();
            struct PanicPayload;
            impl Drop for PanicPayload {
                fn drop(&mut self) {
                    panic!("panic payload destructor fixture panic");
                }
            }
            let events = tauri::ipc::Channel::new(|_| std::panic::panic_any(PanicPayload));
            let identity = f
                .host
                .attach(
                    "workspace-a",
                    wire::Attach {
                        version: 1,
                        session,
                        challenge: "12345678-1234-1234-1234-123456789abc".into(),
                    },
                    events,
                )
                .unwrap();
            let a = f.host.lock().attachments[identity["attachment"].as_str().unwrap()].clone();
            a.drained().await;
            assert!(a.lock().closed);
            assert!(a.lock().subscription.is_none());
            struct ObserverDrop(Arc<Host>);
            impl Drop for ObserverDrop {
                fn drop(&mut self) {
                    let _ = self.0.application_status();
                    panic!("observer destructor fixture panic");
                }
            }
            let capture = ObserverDrop(f.host.clone());
            let subscription = f
                .host
                .association
                .subscribe(move |_| {
                    let _ = &capture;
                })
                .unwrap();
            let (events, _) = channel();
            let a = transport::Attachment::new(
                "detached",
                "session".into(),
                f.host.epoch.clone(),
                events,
            );
            a.lock().subscription = Some(subscription);
            a.activate();
            drop(transport::attachment_task(
                a.clone(),
                f.host.association.clone(),
            ));
            a.drained().await;
            assert!(a.lock().subscription.is_none());
            let capture = ObserverDrop(f.host.clone());
            let events = tauri::ipc::Channel::new(move |_| {
                let _ = &capture;
                Ok(())
            });
            let a = transport::Attachment::new(
                "channel-drop",
                "session".into(),
                f.host.epoch.clone(),
                events,
            );
            a.activate();
            drop(transport::attachment_task(
                a.clone(),
                f.host.association.clone(),
            ));
            a.drained().await;
            f.finish().await;
        })
    });
}

#[test]
fn lost_save_completion_is_terminal_unknown_and_never_replayed() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            for id in 1..=3 {
                let request = f.request(id);
                assert!(
                    f.host
                        .reserve_save("manager", request.clone(), Instant::now())
                        .unwrap()
                        .1
                );
                let guard = commands::SaveCompletion::new(f.host.clone(), f.manager.clone(), id);
                if id == 1 {
                    drop(async move {
                        let _guard = guard;
                        std::future::pending::<()>().await;
                    });
                } else if id == 2 {
                    let task = tokio::spawn(async move {
                        let _guard = guard;
                        std::future::pending::<()>().await;
                    });
                    tokio::task::yield_now().await;
                    task.abort();
                    assert!(task.await.unwrap_err().is_cancelled());
                } else {
                    let task = tokio::spawn(async move {
                        let _guard = guard;
                        panic!("save fixture panic");
                    });
                    assert!(task.await.unwrap_err().is_panic());
                }
                f.host.drain_results().await;
                assert!(!f.host.lock().windows["manager"].active_save);
                assert_eq!(
                    f.host
                        .result("manager", &f.manager, 1, id, Instant::now())
                        .unwrap_err()["code"],
                    "outcome-unknown"
                );
                assert!(
                    !f.host
                        .reserve_save("manager", request, Instant::now())
                        .unwrap()
                        .1
                );
            }
            f.finish().await;
        })
    });
}

#[test]
fn shutdown_wakes_frozen_campaign_and_skips_later_stages() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            let host = f.host.clone();
            let after_pause = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let after = after_pause.clone();
            let task = tokio::spawn(async move {
                campaign::until_stopped(&host, async {
                    campaign::pause(32_000).await;
                    after.store(true, std::sync::atomic::Ordering::Release);
                })
                .await
            });
            tokio::task::yield_now().await;
            let start = Instant::now();
            f.host.stop_admission();
            assert!(task.await.unwrap().is_none());
            assert!(start.elapsed() < Duration::from_secs(1));
            assert!(!after_pause.load(std::sync::atomic::Ordering::Acquire));
            assert!(f.host.register("recreated", Role::Workspace).is_err());
            f.finish().await;
        })
    });
}

#[test]
fn scheduler_join_and_campaign_panic_cannot_report_success() {
    bounded_native(|| {
        runtime().block_on(async {
            assert!(campaign::join_scheduler(std::thread::spawn(|| {})).await);
            assert!(
                !campaign::join_scheduler(std::thread::spawn(|| panic!("scheduler fixture panic")))
                    .await
            );
            assert!(
                !campaign::scheduler_task_result(tauri::async_runtime::spawn_blocking(|| panic!(
                    "join wrapper fixture panic"
                )))
                .await
            );
            let f = Fixture::start().await;
            assert!(
                campaign::until_stopped(&f.host, async { panic!("campaign fixture panic") })
                    .await
                    .is_none()
            );
            assert!(f
                .host
                .lock()
                .native_stages
                .iter()
                .any(|s| s["name"] == "campaign-task-panicked" && s["ok"] == false));
            f.finish().await;
        })
    });
}

#[test]
fn bootstrap_raw_body_retains_size_duplicate_and_unknown_field_checks() {
    assert!(wire::parse::<wire::Base>(r#"{"version":1,"session":"s"}"#).is_ok());
    let oversized = format!("{}{}", " ".repeat(4096), r#"{"version":1,"session":"s"}"#);
    assert!(wire::parse::<wire::Base>(&oversized).is_err());
    assert!(wire::parse::<wire::Base>(r#"{"version":1,"version":1,"session":"s"}"#).is_err());
    assert!(wire::parse::<wire::Base>(r#"{"version":1,"session":"s","role":"manager"}"#).is_err());
}

#[test]
fn expired_attachment_and_scheduler_close_reenter_native_status() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            for mode in 0..2 {
                let label = format!("deadline-{mode}");
                let session = f.host.register(&label, Role::Workspace).unwrap();
                let host = f.host.clone();
                let messages = Arc::new(Mutex::new(Vec::new()));
                let output = messages.clone();
                let events = tauri::ipc::Channel::new(move |body| {
                    let tauri::ipc::InvokeResponseBody::Json(raw) = body else {
                        panic!("JSON")
                    };
                    let event: Value = serde_json::from_str(&raw).unwrap();
                    let _ = host.application_status();
                    output.lock().unwrap().push(event);
                    Ok(())
                });
                let id = f
                    .host
                    .attach(
                        &label,
                        wire::Attach {
                            version: 1,
                            session: session.clone(),
                            challenge: "12345678-1234-1234-1234-123456789abc".into(),
                        },
                        events,
                    )
                    .unwrap();
                delivered(&messages, 1).await;
                let a = f.host.lock().attachments[id["attachment"].as_str().unwrap()].clone();
                a.lock().lease = Instant::now() - Duration::from_secs(1);
                if mode == 0 {
                    assert!(f
                        .host
                        .attachment(&label, 1, &session, &f.host.epoch, &a.id)
                        .is_err());
                } else {
                    let scheduler = f.host.scheduler();
                    delivered(&messages, 2).await;
                    f.host.stop_admission();
                    assert!(campaign::join_scheduler(scheduler).await);
                }
                delivered(&messages, 2).await;
                a.drained().await;
                assert_eq!(messages.lock().unwrap()[1]["kind"], "closed");
            }
            f.finish().await;
        })
    });
}

#[test]
fn concurrent_close_is_serialized_after_inflight_snapshot() {
    bounded_native(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .build()
            .unwrap()
            .block_on(async {
                let f = Fixture::start().await;
                let session = f.host.register("workspace-a", Role::Workspace).unwrap();
                let (entered, receiver) = std::sync::mpsc::sync_channel(1);
                let release = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
                let wait = release.clone();
                let messages = Arc::new(Mutex::new(Vec::new()));
                let output = messages.clone();
                let events = tauri::ipc::Channel::new(move |body| {
                    let tauri::ipc::InvokeResponseBody::Json(raw) = body else {
                        panic!("JSON")
                    };
                    let event: Value = serde_json::from_str(&raw).unwrap();
                    if event["kind"] == "snapshot" {
                        entered.send(()).unwrap();
                        let (lock, wake) = &*wait;
                        let released = wake
                            .wait_timeout_while(
                                lock.lock().unwrap(),
                                Duration::from_secs(2),
                                |released| !*released,
                            )
                            .unwrap();
                        assert!(*released.0, "test did not release snapshot handler");
                    }
                    output.lock().unwrap().push(event);
                    Ok(())
                });
                let host = f.host.clone();
                let attaching = std::thread::spawn(move || {
                    host.attach(
                        "workspace-a",
                        wire::Attach {
                            version: 1,
                            session,
                            challenge: "12345678-1234-1234-1234-123456789abc".into(),
                        },
                        events,
                    )
                    .unwrap()
                });
                receiver.recv_timeout(Duration::from_secs(2)).unwrap();
                f.host.revoke("workspace-a");
                assert!(
                    messages.lock().unwrap().is_empty(),
                    "close must not overtake the in-flight handler"
                );
                *release.0.lock().unwrap() = true;
                release.1.notify_one();
                attaching.join().unwrap();
                delivered(&messages, 2).await;
                assert_eq!(messages.lock().unwrap()[0]["kind"], "snapshot");
                assert_eq!(messages.lock().unwrap()[1]["kind"], "closed");
                f.finish().await;
                assert_eq!(messages.lock().unwrap().len(), 2);
            })
    });
}

#[test]
fn router_captured_hosts_and_delayed_sessions_never_retarget() {
    bounded_native(|| {
        runtime().block_on(async {
            let old = Fixture::start().await;
            let fresh = Fixture::start().await;
            let router = router::HostRouter::new(old.host.clone());
            let captured = router.capture();
            let delayed = old.request(1);
            assert!(
                router.replace(&old.host, fresh.host.clone()).is_err(),
                "live admission cannot be replaced"
            );
            let document = old.host.register("workspace-a", Role::Workspace).unwrap();
            let (identity, messages) = attach(&old.host, "workspace-a", &document);
            delivered(&messages, 1).await;
            let attachment =
                old.host.lock().attachments[identity["attachment"].as_str().unwrap()].clone();
            let association = captured.association.clone();
            let mut closure = Box::pin(association.closed());
            {
                use std::future::Future;
                let mut context = std::task::Context::from_waker(std::task::Waker::noop());
                assert!(closure.as_mut().poll(&mut context).is_pending());
            }
            old.host.stop_admission();
            old.settings.close();
            closure.await;
            attachment.drained().await;
            assert!(attachment.lock().subscription.is_none());
            router.replace(&old.host, fresh.host.clone()).unwrap();
            assert!(Arc::ptr_eq(&captured, &old.host));
            assert!(Arc::ptr_eq(&router.capture(), &fresh.host));
            let handshake = router.capture().handshake("manager").unwrap();
            assert_eq!(handshake["session"], fresh.manager);
            assert_ne!(handshake["session"], old.manager);
            assert_eq!(handshake["nextSaveSequence"], "1");
            assert!(captured
                .authorize("manager", &old.manager, 1, Some(Role::Manager))
                .is_err());
            assert!(captured
                .reserve_save("manager", delayed.clone(), Instant::now())
                .is_err());
            assert!(router
                .capture()
                .reserve_save("manager", delayed, Instant::now())
                .is_err());
            assert!(router
                .capture()
                .attachment("workspace-a", 1, &document, &old.host.epoch, &attachment.id)
                .is_err());
            assert!(fresh.host.lock().records.is_empty());
            assert_eq!(fresh.host.lock().windows["manager"].highwater, 0);
            assert!(
                router.replace(&old.host, fresh.host.clone()).is_err(),
                "expected-host recheck must reject a stale replacement"
            );
            router.stop_admission();
            assert!(fresh
                .host
                .authorize("manager", &fresh.manager, 1, None)
                .is_err());
            assert!(
                router.replace(&fresh.host, old.host.clone()).is_err(),
                "exit closure is sticky across swaps"
            );
            old.finish().await;
            fresh.finish().await;
        })
    });
}

#[test]
fn router_replacement_preserves_attachment_cap_and_draining() {
    bounded_native(|| {
        runtime().block_on(async {
            let old = Fixture::start().await;
            let fresh = Fixture::start().await;
            let router = router::HostRouter::new(old.host.clone());
            old.host.stop_admission();
            router.replace(&old.host, fresh.host.clone()).unwrap();
            for index in 0..8 {
                let label = format!("workspace-{index}");
                let host = router.capture();
                let document = host.register(&label, Role::Workspace).unwrap();
                let _ = attach(&host, &label, &document);
            }
            let host = router.capture();
            let document = host.register("overflow", Role::Workspace).unwrap();
            let (events, _) = channel();
            let error = host
                .attach(
                    "overflow",
                    wire::Attach {
                        version: 1,
                        session: document,
                        challenge: "12345678-1234-1234-1234-123456789abc".into(),
                    },
                    events,
                )
                .unwrap_err();
            assert_eq!(error["code"], "busy");
            assert_eq!(fresh.host.lock().attachments.len(), 8);
            assert!(old.host.lock().attachments.is_empty());
            router.stop_admission();
            host.drain_attachments().await;
            assert!(host.lock().attachments.is_empty());
            old.finish().await;
            fresh.finish().await;
        })
    });
}

#[test]
fn application_status_prefers_current_attachment_over_delayed_closed_cleanup() {
    bounded_native(|| {
        runtime().block_on(async {
            for old_sorts_last in [true, false] {
                let f = Fixture::start().await;
                let session = f.host.register("workspace-a", Role::Workspace).unwrap();
                let (old_events, _) = channel();
                let (fresh_events, _) = channel();
                let mut old = transport::Attachment::new(
                    "workspace-a",
                    session.clone(),
                    f.host.epoch.clone(),
                    old_events,
                );
                let mut fresh = transport::Attachment::new(
                    "workspace-a",
                    session,
                    f.host.epoch.clone(),
                    fresh_events,
                );
                let (old_id, fresh_id) = if old_sorts_last {
                    ("f".repeat(32), "0".repeat(32))
                } else {
                    ("0".repeat(32), "f".repeat(32))
                };
                Arc::get_mut(&mut old).unwrap().id = old_id;
                Arc::get_mut(&mut fresh).unwrap().id = fresh_id;
                old.activate();
                fresh.activate();
                {
                    let mut state = old.lock();
                    state.closed = true;
                    state.applied = Some(plugin_registry::CommandResourceRevision::new(9).unwrap());
                }
                {
                    let mut state = f.host.lock();
                    state.attachments.insert(old.id.clone(), old.clone());
                    state.attachments.insert(fresh.id.clone(), fresh.clone());
                }
                assert!(
                    !old.finished.load(std::sync::atomic::Ordering::Acquire),
                    "retain the closed task to model delayed cleanup"
                );
                assert_eq!(
                    f.host.application_status()[0],
                    json!({"window":"workspace-a","state":"pending","revision":null})
                );
                fresh.lock().applied =
                    Some(plugin_registry::CommandResourceRevision::new(1).unwrap());
                assert_eq!(
                    f.host.application_status()[0],
                    json!({"window":"workspace-a","state":"applied","revision":"1"})
                );
                fresh.close("fixture-close");
                assert_eq!(
                    f.host.application_status()[0]["state"],
                    "stale",
                    "closed fallback remains available without an active association"
                );
                old.finish();
                fresh.finish();
                f.finish().await;
            }
        })
    });
}

#[test]
fn reload_baseline_requires_new_native_ack_after_a_stale_workspace() {
    bounded_native(|| {
        runtime().block_on(async {
            let f = Fixture::start().await;
            let session = f.host.register("workspace-b", Role::Workspace).unwrap();
            let (old_id, old_messages) = attach(&f.host, "workspace-b", &session);
            delivered(&old_messages, 1).await;
            let old = f.host.lock().attachments[old_id["attachment"].as_str().unwrap()].clone();
            assert!(
                campaign::reload_baseline(&f.host, &session, &[]).is_none(),
                "send success is not acknowledgment"
            );
            let revision = old
                .lock()
                .delivery
                .as_ref()
                .unwrap()
                .snapshot
                .saved
                .revision;
            assert!(old.acknowledge(1, revision));
            assert_eq!(
                campaign::reload_baseline(&f.host, &session, &[])
                    .unwrap()
                    .attachment,
                old.id
            );
            let excluded = vec![old.id.clone()];
            assert!(
                campaign::reload_baseline(&f.host, &session, &excluded).is_none(),
                "preexisting acknowledged association cannot prove explicit reattachment"
            );
            old.lock().lease = Instant::now() - Duration::from_secs(1);
            assert!(
                campaign::reload_baseline(&f.host, &session, &[]).is_none(),
                "expired but previously applied association is not a baseline"
            );
            assert!(f
                .host
                .attachment("workspace-b", 1, &session, &f.host.epoch, &old.id)
                .is_err());
            old.drained().await;
            let (fresh_id, fresh_messages) = attach(&f.host, "workspace-b", &session);
            delivered(&fresh_messages, 1).await;
            let fresh = f.host.lock().attachments[fresh_id["attachment"].as_str().unwrap()].clone();
            assert!(campaign::reload_baseline(&f.host, &session, &excluded).is_none());
            assert!(fresh.acknowledge(1, revision));
            let baseline = campaign::reload_baseline(&f.host, &session, &excluded).unwrap();
            assert_eq!(baseline.session, session);
            assert_eq!(baseline.attachment, fresh.id);
            assert_ne!(baseline.attachment, old.id);
            assert_eq!(baseline.sequence, 1);
            assert_eq!(baseline.revision, revision);
            f.host.revoke("workspace-b");
            assert!(
                campaign::reload_baseline(&f.host, &session, &[]).is_none(),
                "revoked document cannot supply a stale test baseline"
            );
            f.finish().await;
        })
    });
}

async fn explicit_reload_reattach_case(expired: bool) {
    let f = Fixture::start().await;
    let session = f.host.register("workspace-b", Role::Workspace).unwrap();
    let (old_id, old_messages) = attach(&f.host, "workspace-b", &session);
    delivered(&old_messages, 1).await;
    let old = f.host.lock().attachments[old_id["attachment"].as_str().unwrap()].clone();
    let revision = old
        .lock()
        .delivery
        .as_ref()
        .unwrap()
        .snapshot
        .saved
        .revision;
    assert!(old.acknowledge(1, revision));
    if expired {
        old.lock().lease = Instant::now() - Duration::from_secs(1);
        assert!(campaign::reload_baseline(&f.host, &session, &[]).is_none());
    } else {
        assert!(campaign::reload_baseline(&f.host, &session, &[]).is_some());
    }
    let mut controls = Vec::new();
    let mut fresh = None;
    let excluded = campaign::explicit_reload_reattach(&f.host, &session, |control| {
        controls.push(control);
        match control {
            "detach" => {
                // Model the button reaching the existing detach handler. Expired
                // admission closes the attachment itself and returns closed.
                match f
                    .host
                    .attachment("workspace-b", 1, &session, &f.host.epoch, &old.id)
                {
                    Ok(a) => a.close("explicit-detach"),
                    Err(error) => assert_eq!(error["code"], "closed"),
                }
            }
            "reattach" => {
                assert!(old.lock().closed);
                assert!(old.finished.load(std::sync::atomic::Ordering::Acquire));
                assert!(old.lock().subscription.is_none());
                assert!(old.lock().delivery.is_none());
                fresh = Some(attach(&f.host, "workspace-b", &session));
            }
            _ => panic!("unexpected campaign control"),
        }
        true
    })
    .await
    .unwrap();
    assert_eq!(controls, ["detach", "reattach"]);
    assert_eq!(excluded.as_slice(), std::slice::from_ref(&old.id));
    assert!(
        campaign::reload_baseline(&f.host, &session, &excluded).is_none(),
        "reattach still needs a real native acknowledgment"
    );
    let (fresh_id, messages) = fresh.unwrap();
    delivered(&messages, 1).await;
    let fresh = f.host.lock().attachments[fresh_id["attachment"].as_str().unwrap()].clone();
    assert!(fresh.acknowledge(1, revision));
    let baseline = campaign::reload_baseline(&f.host, &session, &excluded).unwrap();
    assert_eq!(baseline.attachment, fresh.id);
    assert_ne!(baseline.attachment, old.id);
    assert_eq!(baseline.session, session);
    assert_eq!(baseline.sequence, 1);
    assert_eq!(baseline.revision, revision);
    f.finish().await;
}

#[test]
fn reload_campaign_detaches_and_drains_a_healthy_baseline_before_reattach() {
    bounded_native(|| runtime().block_on(explicit_reload_reattach_case(false)));
}

#[test]
fn reload_campaign_detaches_and_drains_an_expired_baseline_before_reattach() {
    bounded_native(|| runtime().block_on(explicit_reload_reattach_case(true)));
}
