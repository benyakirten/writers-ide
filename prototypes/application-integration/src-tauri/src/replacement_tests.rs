use super::*;
use crate::{campaign, owned::MARKER, plugin_registry::command_resource_settings::SaveOutcome};
use std::time::{Duration, Instant};
// Compile the seed executable's exact schema/codec composition for these fixtures.
#[allow(clippy::duplicate_mod)]
#[path = "seed_modules.rs"]
mod controlled_seed;

fn parent(dir: &tempfile::TempDir) -> OwnedParent {
    let path = std::fs::canonicalize(dir.path()).unwrap();
    let id = "a".repeat(32);
    std::fs::write(
        path.join(MARKER),
        format!("{{\"schema\":1,\"runId\":\"{id}\"}}"),
    )
    .unwrap();
    OwnedParent::validate(path, id, false).unwrap()
}
fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
}

#[test]
fn controlled_lower_revision_replacement_drains_and_preserves_primary() {
    runtime().block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let parent = parent(&dir);
        controlled_seed::seed(&parent.root()).unwrap();
        controlled_seed::seed(&parent.replacement_root()).unwrap();
        assert!(
            controlled_seed::seed(&parent.replacement_root()).is_err(),
            "seed never overwrites an existing root"
        );
        let (location, session) = campaign::opening(&parent)
            .await
            .unwrap_or_else(|e| panic!("{}", e.code));
        let settings = SettingsOwner::start(session.handle.clone(), 16, 16)
            .await
            .unwrap();
        let retired = Host::new(settings.operations(), settings.association());
        let initial = retired.operations.read().await.unwrap();
        let mut changed = initial.saved.settings;
        changed.max_window_pending += 1;
        let previous = match retired
            .operations
            .save(initial.saved.revision, changed)
            .await
            .unwrap()
        {
            SaveOutcome::Saved(snapshot) => snapshot,
            SaveOutcome::Conflict { .. } => panic!("fresh fixture cannot conflict"),
        };
        let document = retired.register("workspace-a", Role::Workspace).unwrap();
        let identity = retired
            .attach(
                "workspace-a",
                wire::Attach {
                    version: 1,
                    session: document,
                    challenge: "12345678-1234-1234-1234-123456789abc".into(),
                },
                tauri::ipc::Channel::new(|_| Ok(())),
            )
            .unwrap();
        let attachment =
            retired.lock().attachments[identity["attachment"].as_str().unwrap()].clone();
        let deadline = Instant::now() + Duration::from_secs(2);
        while attachment.lock().delivery.is_none() {
            assert!(
                Instant::now() < deadline,
                "initial transport delivery deadline"
            );
            tokio::task::yield_now().await;
        }
        assert!(attachment.acknowledge(1, previous.saved.revision));
        let registry_handle = session.handle.clone();
        retired.stop_admission();
        retired.drain_attachments().await;
        settings.shutdown().await;
        retired.drain_results().await;
        session.owner.shutdown().await.unwrap();
        drop(location);
        assert!(registry_handle
            .read_command_resource_settings()
            .await
            .is_err());
        // The campaign checks persistence before opening the different fixed seed.
        let (location, persisted) = campaign::opening(&parent)
            .await
            .unwrap_or_else(|e| panic!("{}", e.code));
        assert_eq!(
            persisted
                .handle
                .read_command_resource_settings()
                .await
                .unwrap(),
            previous.saved
        );
        persisted.owner.shutdown().await.unwrap();
        drop(location);
        let result = exercise(
            &parent,
            &retired,
            &registry_handle,
            Some(&previous),
            std::slice::from_ref(&attachment),
            &AtomicBool::new(false),
            None,
        )
        .await;
        assert!(result.exercised && result.ok && result.cleanup_complete);
        assert!(
            !result.frontend_reattached,
            "native-only tests cannot certify packaged frontend application"
        );
        assert_eq!(result.previous["revision"], "1");
        assert_eq!(result.current["revision"], "0");
        assert_ne!(result.previous["epoch"], result.current["epoch"]);
        assert!(attachment.lock().closed);
        assert!(retired.lock().native_stages.iter().all(|s| s["ok"] == true));
        for replacement in [false, true] {
            let (location, session) = if replacement {
                campaign::opening_replacement(&parent).await
            } else {
                campaign::opening(&parent).await
            }
            .unwrap_or_else(|e| panic!("{}", e.code));
            let saved = session
                .handle
                .read_command_resource_settings()
                .await
                .unwrap();
            if replacement {
                assert_eq!(
                    saved.revision,
                    crate::plugin_registry::CommandResourceRevision::default()
                );
                assert_eq!(saved.settings, initial.saved.settings);
            } else {
                assert_eq!(
                    saved, previous.saved,
                    "replacement leaves primary data intact"
                );
            }
            session.owner.shutdown().await.unwrap();
            drop(location);
        }
    });
}

#[test]
fn missing_malformed_and_interrupted_replacement_never_initialize_or_fallback() {
    runtime().block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let parent = parent(&dir);
        controlled_seed::seed(&parent.root()).unwrap();
        let (location, session) = campaign::opening(&parent)
            .await
            .unwrap_or_else(|e| panic!("{}", e.code));
        let settings = SettingsOwner::start(session.handle.clone(), 16, 16)
            .await
            .unwrap();
        let retired = Host::new(settings.operations(), settings.association());
        retired.stop_admission();
        settings.shutdown().await;
        let registry_handle = session.handle.clone();
        session.owner.shutdown().await.unwrap();
        drop(location);
        let missing = exercise(
            &parent,
            &retired,
            &registry_handle,
            None,
            &[],
            &AtomicBool::new(false),
            None,
        )
        .await;
        assert!(!missing.exercised && !missing.ok && missing.cleanup_complete);
        assert!(
            !parent.replacement_root().exists(),
            "absent replacement is not initialized"
        );
        std::fs::create_dir(parent.replacement_root()).unwrap();
        let malformed = exercise(
            &parent,
            &retired,
            &registry_handle,
            None,
            &[],
            &AtomicBool::new(false),
            None,
        )
        .await;
        assert!(!malformed.exercised && !malformed.ok && malformed.cleanup_complete);
        assert_eq!(
            std::fs::read_dir(parent.replacement_root())
                .unwrap()
                .count(),
            0
        );
        let stages = retired.lock().native_stages.len();
        let interrupted = exercise(
            &parent,
            &retired,
            &registry_handle,
            None,
            &[],
            &AtomicBool::new(true),
            None,
        )
        .await;
        assert!(!interrupted.exercised && !interrupted.ok && interrupted.cleanup_complete);
        assert_eq!(
            retired.lock().native_stages.len(),
            stages,
            "exit skips replacement work"
        );
    });
}
