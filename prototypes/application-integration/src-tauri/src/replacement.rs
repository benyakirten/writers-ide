use crate::{
    campaign::{drain_settings, join_scheduler, opening_replacement, pause, until_stopped},
    owned::OwnedParent,
    plugin_registry::command_resource_settings::{SettingsOwner, SettingsSnapshot},
    policy::{Host, Role},
    resources::Resources,
    router::HostRouter,
    transport::Attachment,
    wire,
};
use serde::Serialize;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReplacementResult {
    pub scope: &'static str,
    pub frontend_reattached: bool,
    pub cases: Value,
    pub previous: Value,
    pub current: Value,
    pub exercised: bool,
    pub ok: bool,
    pub cleanup_complete: bool,
}
impl ReplacementResult {
    pub(crate) fn skipped() -> Self {
        Self {
            scope: "not exercised",
            frontend_reattached: false,
            cases: Value::Null,
            previous: Value::Null,
            current: Value::Null,
            exercised: false,
            ok: false,
            cleanup_complete: true,
        }
    }
}

// Both roots are closed inputs prepared by the separate seed executable. This
// opens only the fixed replacement root; it neither publishes nor changes selection
// in the primary root. Packaged execution explicitly replaces the fixed shells.
pub(crate) struct ReplacementShell<'a> {
    pub app: &'a tauri::AppHandle,
    pub router: &'a Arc<HostRouter>,
    pub resources: &'a Arc<Resources>,
    pub denial_policy: bool,
}

pub(crate) async fn exercise(
    parent: &OwnedParent,
    retired: &Arc<Host>,
    retired_registry: &crate::plugin_registry::RegistryHandle,
    previous: Option<&SettingsSnapshot>,
    attachments: &[Arc<Attachment>],
    requested: &AtomicBool,
    shell: Option<ReplacementShell<'_>>,
) -> ReplacementResult {
    let mut result = ReplacementResult::skipped();
    if requested.load(Ordering::Acquire) {
        return result;
    }
    let (location, session) = match opening_replacement(parent).await {
        Ok(opened) => opened,
        Err(error) => {
            retired.stage("native-replacement-fixed-seed-opened", false);
            result.cleanup_complete = error.cleanup_complete;
            return result;
        }
    };
    result.exercised = true;
    result.scope = if shell.is_some() {
        "packaged cross-service explicit replacement"
    } else {
        "native-only transport regression"
    };
    retired.stage("native-replacement-fixed-seed-opened", true);
    if requested.load(Ordering::Acquire) {
        result.cleanup_complete = session.owner.shutdown().await.is_ok();
        drop(location);
        retired.stage(
            "native-replacement-cleanup-awaited",
            result.cleanup_complete,
        );
        return result;
    }
    let settings = match SettingsOwner::start(session.handle.clone(), 16, 16).await {
        Ok(settings) => settings,
        Err(_) => {
            retired.stage("native-replacement-settings-started", false);
            result.cleanup_complete = session.owner.shutdown().await.is_ok();
            drop(location);
            retired.stage(
                "native-replacement-cleanup-awaited",
                result.cleanup_complete,
            );
            return result;
        }
    };
    retired.stage("native-replacement-settings-started", true);
    let fresh = Host::new(settings.operations(), settings.association());
    let scheduler = fresh.scheduler();
    let initial = fresh.operations.read().await.ok();
    result.previous = previous
        .map(|s| wire::snapshot(&retired.epoch, s))
        .unwrap_or(Value::Null);
    result.current = initial
        .as_ref()
        .map(|s| wire::snapshot(&fresh.epoch, s))
        .unwrap_or(Value::Null);
    let zero = initial.as_ref().is_some_and(|s| {
        s.saved.revision == crate::plugin_registry::CommandResourceRevision::default()
    });
    let epochs = initial.as_ref().zip(previous).is_some_and(|(new, old)| {
        new.saved.revision < old.saved.revision
            && new.epoch != old.epoch
            && fresh.epoch != retired.epoch
    });
    retired.stage("native-replacement-preseeded-revision-zero", zero);
    retired.stage("native-replacement-lower-revision-fresh-epochs", epochs);
    let old_read_denied = retired.operations.read().await.is_err();
    let old_association_denied =
        retired.association.is_closed() && retired.association.read().await.is_err();
    let old_save_denied = if let Some(previous) = previous {
        retired
            .operations
            .save(previous.saved.revision, previous.saved.settings)
            .await
            .is_err()
    } else {
        false
    };
    let old_registry_denied = retired_registry
        .read_command_resource_settings()
        .await
        .is_err();
    let old_operations_denied =
        old_read_denied && old_association_denied && old_save_denied && old_registry_denied;
    retired.stage(
        "native-replacement-retired-operations-denied",
        old_operations_denied,
    );
    let old_ack_denied = !attachments.is_empty()
        && attachments.iter().all(|a| {
            let state = a.lock();
            let sequence = state.sequence;
            let revision = state.applied.or_else(|| previous.map(|s| s.saved.revision));
            drop(state);
            revision.is_some_and(|revision| !a.acknowledge(sequence, revision))
        });
    retired.stage("native-replacement-retired-ack-denied", old_ack_denied);

    // This native channel is deliberately not a WebView or a claim of frontend
    // application. It exercises the fresh transport and its exact native ack.
    let acknowledged = Arc::new(AtomicBool::new(false));
    let mut fresh_document = None;
    if !requested.load(Ordering::Acquire) {
        let label = "replacement-native-workspace";
        if let Ok(document) = fresh.register(label, Role::Workspace) {
            fresh_document = Some(document.clone());
            let host = Arc::downgrade(&fresh);
            let applied = acknowledged.clone();
            let caller = document.clone();
            let events = tauri::ipc::Channel::new(move |body| {
                if let tauri::ipc::InvokeResponseBody::Json(raw) = body {
                    if let Ok(event) = serde_json::from_str::<Value>(&raw) {
                        if event["kind"] == "snapshot" {
                            if let Some(host) = host.upgrade() {
                                let ack = (|| {
                                    let id = event["attachment"].as_str()?;
                                    let sequence =
                                        wire::decimal(event["sequence"].as_str()?, true).ok()?;
                                    let revision =
                                        serde_json::from_value(event["revision"].clone()).ok()?;
                                    let attachment =
                                        host.attachment(label, 1, &caller, &host.epoch, id).ok()?;
                                    Some(attachment.acknowledge(sequence, revision))
                                })();
                                applied.store(ack == Some(true), Ordering::Release);
                            }
                        }
                    }
                }
                Ok(())
            });
            let admitted = fresh
                .attach(
                    label,
                    wire::Attach {
                        version: 1,
                        session: document,
                        challenge: "12345678-1234-1234-1234-123456789abc".into(),
                    },
                    events,
                )
                .is_ok();
            if admitted {
                for _ in 0..50 {
                    if acknowledged.load(Ordering::Acquire) || requested.load(Ordering::Acquire) {
                        break;
                    }
                    pause(50).await;
                }
            }
        }
    }
    let applied = acknowledged.load(Ordering::Acquire)
        && fresh.application_status().as_array().is_some_and(|rows| {
            rows.len() == 1 && rows[0]["state"] == "applied" && rows[0]["revision"] == "0"
        });
    retired.stage("native-replacement-fresh-channel-acknowledged", applied);
    let old_identity_denied = !attachments.is_empty()
        && attachments.iter().all(|a| {
            fresh
                .attachment(&a.label, 1, &a.session, &a.epoch, &a.id)
                .is_err()
                && fresh_document.as_ref().is_some_and(|document| {
                    fresh
                        .attachment("replacement-native-workspace", 1, document, &a.epoch, &a.id)
                        .is_err()
                })
        });
    retired.stage(
        "native-replacement-old-identities-denied",
        old_identity_denied,
    );
    let frontend_ok = if let Some(shell) = shell.as_ref() {
        fresh.revoke("replacement-native-workspace");
        let native_attachments = fresh
            .lock()
            .attachments
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for attachment in native_attachments {
            attachment.drained().await;
        }
        if let Some(initial) = initial.as_deref() {
            until_stopped(
                &fresh,
                crate::replacement_shell::exercise(
                    shell,
                    retired,
                    &fresh,
                    attachments,
                    initial,
                    requested,
                ),
            )
            .await
            .unwrap_or(false)
        } else {
            false
        }
    } else {
        true
    };
    result.frontend_reattached = shell.is_some() && frontend_ok;
    result.cases = serde_json::to_value(&fresh.lock().reports).unwrap_or(Value::Null);
    let unchanged =
        fresh
            .operations
            .read()
            .await
            .ok()
            .zip(initial)
            .is_some_and(|(after, initial)| {
                after.saved == initial.saved && after.epoch == initial.epoch
            });
    retired.stage(
        "native-replacement-unmodified-by-retired-service",
        unchanged,
    );
    fresh.stop_admission();
    fresh.drain_attachments().await;
    let scheduler_clean = join_scheduler(scheduler).await;
    retired.stage("replacement-attachment-scheduler-joined", scheduler_clean);
    drain_settings(&fresh, settings).await;
    result.cleanup_complete = session.owner.shutdown().await.is_ok() && scheduler_clean;
    drop(location);
    let fresh_stages = fresh.lock().native_stages.clone();
    let fresh_stages_ok = fresh_stages.iter().all(|stage| stage["ok"] == true);
    retired.lock().native_stages.extend(fresh_stages);
    retired.stage(
        "native-replacement-cleanup-awaited",
        result.cleanup_complete,
    );
    result.ok = zero
        && epochs
        && old_operations_denied
        && old_ack_denied
        && applied
        && old_identity_denied
        && unchanged
        && frontend_ok
        && fresh_stages_ok
        && result.cleanup_complete
        && !requested.load(Ordering::Acquire);
    result
}

#[cfg(test)]
#[path = "replacement_tests.rs"]
mod tests;
