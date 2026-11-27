use super::*;
use crate::plugin_integrity::{create_record, verify_package, IntegrityLimits};
use tempfile::TempDir;

#[test]
fn command_resource_edits_preserve_approvals_and_pending_permission_reviews() {
    let (_dir, mut s) = store();
    let artifact = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &artifact);
    let component = component(&mut s, &artifact);
    let secure = s.read_settings().unwrap();
    let trust = HostSettings {
        permission_mode: PermissionMode::Trust,
        repair_conflict_policy: RepairConflictPolicy::AskBeforeReplacingUpdate,
    };
    s.set_host_settings(secure, trust).unwrap();
    let automatic_key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    review(
        &mut s,
        &snapshot,
        artifact.id,
        automatic_key.clone(),
        PermissionEffect::ApproveAutomatic,
        false,
    )
    .unwrap();
    let project = project(&mut s, 42);
    let explicit_key = DecisionKey {
        coverage: Coverage::Project(project),
        ..automatic_key.clone()
    };
    review(
        &mut s,
        &snapshot,
        artifact.id,
        explicit_key.clone(),
        PermissionEffect::ApproveExplicit,
        false,
    )
    .unwrap();
    let automatic = decision_for(&mut s, &automatic_key);
    let explicit = decision_for(&mut s, &explicit_key);
    let pending = PermissionReview {
        installation: snapshot,
        target: Some(artifact.id),
        expected_settings: trust,
        items: vec![PermissionReviewItem {
            key: explicit_key.clone(),
            expected: explicit.clone(),
            effect: PermissionEffect::Deny,
            consume_recovered: false,
        }],
    };
    let original = s.read_command_resource_settings().unwrap();
    let changed = CommandResourceSettings {
        max_caller_pending: 1,
        ..original.settings
    };
    let saved = s
        .set_command_resource_settings(original.revision, changed)
        .unwrap();
    assert_eq!(s.read_settings().unwrap(), trust);
    assert_eq!(decision_for(&mut s, &automatic_key), automatic);
    assert_eq!(decision_for(&mut s, &explicit_key), explicit);
    s.save_permission_review(pending).unwrap();
    assert!(decision_for(&mut s, &explicit_key).denied);
    assert_eq!(decision_for(&mut s, &automatic_key), automatic);
    assert_eq!(s.read_command_resource_settings().unwrap(), saved);
    s.set_host_settings(trust, secure).unwrap();
    let explicit_after_review = decision_for(&mut s, &explicit_key);
    s.set_command_resource_settings(saved.revision, original.settings)
        .unwrap();
    assert_eq!(decision_for(&mut s, &explicit_key), explicit_after_review);
    assert_eq!(s.read_settings().unwrap(), secure);
}

fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: IntegrityLimits {
            max_files: 64,
            max_file_bytes: 65536,
            max_total_bytes: 262144,
            max_path_bytes: 256,
            max_depth: 8,
        },
        max_rows: 512,
        max_snapshot_bytes: 1048576,
        max_text_bytes: 4096,
        max_location_bytes: 1024,
        max_review_items: 32,
    }
}
fn store() -> (TempDir, Store) {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::create(&dir.path().join("registry.sqlite"), limits()).unwrap();
    (dir, store)
}
fn source(version: &str, scope: &str, required: bool) -> String {
    format!(
        r#"manifest_version = 1
[package]
name = "sample"
display_name = "Sample"
version = "{version}"
description = "Package description"
[[components]]
id = "main"
display_name = "Main"
description = "Component description"
kind = "frontend"
entry = "main.js"
runtime_profile = "writers-ide.frontend/1"
activation_scope = "{scope}"
default_enabled = true
capabilities = []
permissions = [{}]
"#,
        if required {
            "{operation = \"external.open\",resource = \"http-https\"}"
        } else {
            ""
        }
    )
}
fn prepared(text: &str) -> PreparedArtifact {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("manifest.toml"), text).unwrap();
    std::fs::write(dir.path().join("main.js"), b"export default {};").unwrap();
    let record = create_record(dir.path(), &limits().integrity).unwrap();
    let verified = verify_package(dir.path(), &record, &limits().integrity).unwrap();
    PreparedArtifact::from_verified(&verified, Path::new("/test-only-artifact-store"), &limits())
        .unwrap()
}
fn accept_source(s: &mut Store, text: &str) -> ArtifactFacts {
    let p = prepared(text);
    let r = PublicationReceipt::for_test(&p);
    s.accept_artifact(p, r).unwrap()
}
fn accept_version(s: &mut Store, version: &str) -> ArtifactFacts {
    accept_source(s, &source(version, "project", true))
}
fn details(s: &mut Store, package: PackageId) -> PackageDetails {
    s.package_details(package).unwrap()
}
fn current(s: &mut Store, package: PackageId) -> InstallationSnapshot {
    details(s, package).installation
}
fn change(
    s: &mut Store,
    expected: InstallationSnapshot,
    action: InstallationAction,
    target: Option<ArtifactId>,
) -> InstallationSnapshot {
    let mut ids: Vec<_> = expected
        .pointers
        .as_ref()
        .into_iter()
        .flat_map(|p| {
            [p.selected, p.staged, p.previous, p.pending_repair]
                .into_iter()
                .flatten()
        })
        .collect();
    ids.extend(target);
    s.change_installation(
        InstallationExpectation::Existing(expected),
        action,
        target.map(ArtifactTarget::Accepted),
        Some(InstallationPrerequisites::for_test(ids, true)),
    )
    .unwrap()
}
fn install(s: &mut Store, target: &ArtifactFacts) -> InstallationSnapshot {
    let expected = current(s, target.package);
    change(
        s,
        expected,
        InstallationAction::Install { select_now: true },
        Some(target.id),
    )
}
fn stage(
    s: &mut Store,
    expected: InstallationSnapshot,
    target: ArtifactId,
) -> InstallationSnapshot {
    change(s, expected, InstallationAction::StageUpdate, Some(target))
}
fn promote(s: &mut Store, expected: InstallationSnapshot) -> InstallationSnapshot {
    change(s, expected, InstallationAction::PromoteStage, None)
}
fn project(s: &mut Store, byte: u8) -> ProjectId {
    s.register_project(prepared_project(byte)).unwrap()
}
fn prepared_project(byte: u8) -> PreparedProject {
    PreparedProject::for_test(
        "Project".into(),
        ProjectLocation {
            path_encoding: "test-only-path/1".into(),
            path_bytes: vec![byte],
            directory_identity_scheme: "test-only-identity/1".into(),
            directory_identity_bytes: vec![byte, 0],
        },
    )
}
fn component(s: &mut Store, artifact: &ArtifactFacts) -> ComponentId {
    details(s, artifact.package)
        .artifacts
        .into_iter()
        .find(|a| a.facts.id == artifact.id)
        .unwrap()
        .components[0]
        .id
}
fn decision_for(s: &mut Store, key: &DecisionKey) -> PermissionDecision {
    decisions::decision(&s.connection, key).unwrap()
}
fn review(
    s: &mut Store,
    snapshot: &InstallationSnapshot,
    artifact: ArtifactId,
    key: DecisionKey,
    effect: PermissionEffect,
    consume_recovered: bool,
) -> Result<()> {
    let expected = decision_for(s, &key);
    let expected_settings = s.read_settings().unwrap();
    s.save_permission_review(PermissionReview {
        installation: snapshot.clone(),
        target: Some(artifact),
        expected_settings,
        items: vec![PermissionReviewItem {
            key,
            expected,
            effect,
            consume_recovered,
        }],
    })
}
fn acknowledge(
    s: &mut Store,
    snapshot: &InstallationSnapshot,
    artifact: &ArtifactFacts,
    component: ComponentId,
    scope: ActivationScope,
) -> Result<()> {
    let baseline = decisions::baseline(&s.connection, component).unwrap();
    s.acknowledge_scope(ScopeReview {
        installation: snapshot.clone(),
        target: artifact.id,
        acknowledgement: ScopeAcknowledgement {
            component,
            target_version: artifact.version.clone(),
            baseline,
            target_scope: scope,
        },
    })
}
fn assert_pointers(
    snapshot: &InstallationSnapshot,
    selected: Option<ArtifactId>,
    staged: Option<ArtifactId>,
    previous: Option<ArtifactId>,
    pending_repair: Option<ArtifactId>,
) {
    assert_eq!(
        snapshot.pointers,
        Some(InstallationPointers {
            selected,
            staged,
            previous,
            pending_repair
        })
    );
}

#[test]
fn creation_open_ownership_and_reopen_preserve_originals() {
    let (dir, mut s) = store();
    let path = dir.path().join("registry.sqlite");
    assert!(matches!(
        Store::open(&path, limits()),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(Store::create(&path, limits()).is_err());
    let a = accept_version(&mut s, "1.0.0+release");
    let snapshot = install(&mut s, &a);
    drop(s);
    let mut reopened = Store::open(&path, limits()).unwrap();
    assert_eq!(current(&mut reopened, a.package), snapshot);
    drop(reopened);
    let empty = dir.path().join("empty");
    std::fs::write(&empty, []).unwrap();
    assert!(Store::create(&empty, limits()).is_err());
    assert!(Store::open(&empty, limits()).is_err());
    assert_eq!(std::fs::metadata(&empty).unwrap().len(), 0);
    let missing = dir.path().join("missing");
    assert!(Store::open(&missing, limits()).is_err());
    assert!(!missing.exists());
}
#[test]
fn receipt_and_version_conflicts_leave_no_partial_acceptance() {
    let (_dir, mut s) = store();
    let a = prepared(&source("1.0.0", "project", true));
    let wrong = prepared(&source("1.0.0", "project", true));
    let r = PublicationReceipt::for_test(&wrong);
    assert!(matches!(
        s.accept_artifact(a, r),
        Err(RegistryError::InvalidInput(_))
    ));
    let count: i64 = s
        .connection
        .query_row("SELECT count(*) FROM packages", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
    let a = accept_version(&mut s, "1.0.0");
    let p = prepared(&source("1.0.0", "project", false));
    let r = PublicationReceipt::for_test(&p);
    assert!(matches!(
        s.accept_artifact(p, r),
        Err(RegistryError::VersionConflict(_))
    ));
    assert_eq!(details(&mut s, a.package).artifacts.len(), 1);
    let repair = accept_version(&mut s, "1.0.0");
    assert_ne!(a.id, repair.id);
    assert_eq!(a.fingerprint, repair.fingerprint);
    let different_build = accept_version(&mut s, "1.0.0+other");
    assert_ne!(a.version, different_build.version);
}
#[test]
fn acceptance_and_installation_are_one_transaction_even_for_new_identity() {
    let (_dir, mut s) = store();
    let p = prepared(&source("1.0.0", "project", true));
    let r = PublicationReceipt::for_test(&p);
    let result = s.change_installation(
        InstallationExpectation::AbsentPackage("sample".into()),
        InstallationAction::Install { select_now: true },
        Some(ArtifactTarget::Prepared(Box::new((p, r)))),
        None,
    );
    assert!(result.is_err());
    assert_eq!(
        s.connection
            .query_row("SELECT count(*) FROM packages", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        s.connection
            .query_row("SELECT count(*) FROM package_version_history", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let p = prepared(&source("1.0.0", "project", true));
    let id = p.id();
    let r = PublicationReceipt::for_test(&p);
    let snapshot = s
        .change_installation(
            InstallationExpectation::AbsentPackage("sample".into()),
            InstallationAction::Install { select_now: true },
            Some(ArtifactTarget::Prepared(Box::new((p, r)))),
            Some(InstallationPrerequisites::for_test([id], true)),
        )
        .unwrap();
    assert_eq!(snapshot.revision, Revision(2));
    assert_pointers(&snapshot, Some(id), None, None, None);
    let stale = snapshot.clone();
    let snapshot = change(&mut s, snapshot, InstallationAction::Uninstall, None);
    let p = prepared(&source("2.0.0", "project", true));
    let id2 = p.id();
    let r = PublicationReceipt::for_test(&p);
    assert!(matches!(
        s.change_installation(
            InstallationExpectation::Existing(stale),
            InstallationAction::StageUpdate,
            Some(ArtifactTarget::Prepared(Box::new((p, r)))),
            Some(InstallationPrerequisites::for_test([id2], true))
        ),
        Err(RegistryError::Conflict(_))
    ));
    assert_eq!(current(&mut s, snapshot.package), snapshot);
    assert_eq!(details(&mut s, snapshot.package).artifacts.len(), 1);
}
#[test]
fn all_update_repair_restore_and_cancellation_shapes() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_version(&mut s, "2.0.0");
    let c = accept_version(&mut s, "3.0.0");
    let b_repair = accept_version(&mut s, "2.0.0");
    let b_repair2 = accept_version(&mut s, "2.0.0");
    let snapshot = install(&mut s, &a);
    let snapshot = stage(&mut s, snapshot, b.id);
    let snapshot = promote(&mut s, snapshot);
    assert_pointers(&snapshot, Some(b.id), None, Some(a.id), None);
    let snapshot = stage(&mut s, snapshot, c.id);
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Repair { keep_update: true },
        Some(b_repair.id),
    );
    assert_pointers(
        &snapshot,
        Some(b.id),
        Some(c.id),
        Some(a.id),
        Some(b_repair.id),
    );
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Repair { keep_update: true },
        Some(b_repair2.id),
    );
    let snapshot = change(&mut s, snapshot, InstallationAction::CancelStage, None);
    assert_pointers(&snapshot, Some(b.id), Some(b_repair2.id), Some(a.id), None);
    let snapshot = promote(&mut s, snapshot);
    assert_pointers(&snapshot, Some(b_repair2.id), None, Some(a.id), None);
    let snapshot = change(&mut s, snapshot, InstallationAction::RestorePrevious, None);
    assert_pointers(&snapshot, Some(b_repair2.id), Some(a.id), Some(a.id), None);
    let snapshot = promote(&mut s, snapshot);
    assert_pointers(&snapshot, Some(a.id), None, Some(b_repair2.id), None);
    let a_repair = accept_version(&mut s, "1.0.0");
    let snapshot = stage(&mut s, snapshot, c.id);
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Repair { keep_update: true },
        Some(a_repair.id),
    );
    let snapshot = change(&mut s, snapshot, InstallationAction::RestorePrevious, None);
    let snapshot = promote(&mut s, snapshot);
    assert_pointers(&snapshot, Some(b_repair2.id), None, Some(a_repair.id), None);
    let snapshot = stage(&mut s, snapshot, c.id);
    let fresh = accept_version(&mut s, "2.0.0");
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Repair { keep_update: false },
        Some(fresh.id),
    );
    assert_pointers(
        &snapshot,
        Some(b_repair2.id),
        Some(fresh.id),
        Some(a_repair.id),
        None,
    );
    let snapshot = change(&mut s, snapshot, InstallationAction::CancelAllPending, None);
    assert_pointers(&snapshot, Some(b_repair2.id), None, Some(a_repair.id), None);
}
#[test]
fn promotion_with_pending_repair_uses_verified_repair_as_previous() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_version(&mut s, "2.0.0");
    let repair = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let snapshot = stage(&mut s, snapshot, b.id);
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Repair { keep_update: true },
        Some(repair.id),
    );
    let bad = s.change_installation(
        InstallationExpectation::Existing(snapshot.clone()),
        InstallationAction::PromoteStage,
        None,
        Some(InstallationPrerequisites::for_test([b.id], true)),
    );
    assert!(matches!(bad, Err(RegistryError::Conflict(_))));
    assert_eq!(current(&mut s, a.package), snapshot);
    let snapshot = promote(&mut s, snapshot);
    assert_pointers(&snapshot, Some(b.id), None, Some(repair.id), None);
}
#[test]
fn staged_only_install_replace_cancel_and_process_gate() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_version(&mut s, "2.0.0");
    let snapshot = current(&mut s, a.package);
    assert!(s
        .change_installation(
            InstallationExpectation::Existing(snapshot.clone()),
            InstallationAction::Install { select_now: true },
            Some(ArtifactTarget::Accepted(a.id)),
            Some(InstallationPrerequisites::for_test([a.id], false))
        )
        .is_err());
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Install { select_now: false },
        Some(a.id),
    );
    assert_pointers(&snapshot, None, Some(a.id), None, None);
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::ReplaceStagedInstall,
        Some(b.id),
    );
    assert_pointers(&snapshot, None, Some(b.id), None, None);
    let snapshot = change(&mut s, snapshot, InstallationAction::CancelStage, None);
    assert!(snapshot.pointers.is_none());
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Install { select_now: false },
        Some(a.id),
    );
    let snapshot = promote(&mut s, snapshot);
    assert_pointers(&snapshot, Some(a.id), None, None, None);
}
#[test]
fn away_and_back_installation_revision_and_exhaustion() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_version(&mut s, "2.0.0");
    let old = install(&mut s, &a);
    let snapshot = stage(&mut s, old.clone(), b.id);
    let snapshot = change(&mut s, snapshot, InstallationAction::CancelStage, None);
    assert_eq!(old.pointers, snapshot.pointers);
    assert!(matches!(
        s.change_installation(
            InstallationExpectation::Existing(old),
            InstallationAction::Uninstall,
            None,
            None
        ),
        Err(RegistryError::Conflict(_))
    ));
    s.connection
        .execute(
            "UPDATE packages SET installation_revision=?1 WHERE id=?2",
            params![i64::MAX, a.package.0],
        )
        .unwrap();
    let snapshot = current(&mut s, a.package);
    assert!(matches!(
        s.change_installation(
            InstallationExpectation::Existing(snapshot.clone()),
            InstallationAction::Uninstall,
            None,
            None
        ),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert_eq!(current(&mut s, a.package), snapshot);
}
#[test]
fn denied_precedence_scope_and_trust_promotion_rules() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let project = project(&mut s, 1);
    let application = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    let project_key = DecisionKey {
        coverage: Coverage::Project(project),
        ..application.clone()
    };
    review(
        &mut s,
        &snapshot,
        a.id,
        application.clone(),
        PermissionEffect::ApproveExplicit,
        false,
    )
    .unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        project_key.clone(),
        PermissionEffect::Deny,
        false,
    )
    .unwrap();
    let d = details(&mut s, a.package).decisions;
    assert!(!permission_covered(
        PermissionMode::Trust,
        component,
        NativePermission::ExternalOpen,
        Some(project),
        &d
    ));
    assert!(permission_covered(
        PermissionMode::Secure,
        component,
        NativePermission::ExternalOpen,
        None,
        &d
    ));
    assert!(review(
        &mut s,
        &snapshot,
        a.id,
        application.clone(),
        PermissionEffect::ApproveAutomatic,
        false
    )
    .is_err());
    let secure = s.read_settings().unwrap();
    let trust = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..secure
    };
    s.set_host_settings(secure, trust).unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        application.clone(),
        PermissionEffect::ApproveAutomatic,
        false,
    )
    .unwrap();
    assert_eq!(
        decision_for(&mut s, &application).approval,
        Some(ApprovalSource::Explicit)
    );
    review(
        &mut s,
        &snapshot,
        a.id,
        project_key.clone(),
        PermissionEffect::ApproveAutomatic,
        false,
    )
    .unwrap();
    assert!(decision_for(&mut s, &project_key).denied);
    s.set_host_settings(trust, secure).unwrap();
    assert_eq!(decision_for(&mut s, &project_key).approval, None);
    assert_eq!(
        decision_for(&mut s, &application).approval,
        Some(ApprovalSource::Explicit)
    );
    review(
        &mut s,
        &snapshot,
        a.id,
        project_key.clone(),
        PermissionEffect::ClearDenial,
        false,
    )
    .unwrap();
    assert!(!decision_for(&mut s, &project_key).denied);
}
#[test]
fn exact_recovered_candidate_consumption_and_failed_batch_atomicity() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let p1 = project(&mut s, 1);
    let p2 = project(&mut s, 2);
    for coverage in [
        Coverage::Application,
        Coverage::Project(p1),
        Coverage::Project(p2),
    ] {
        let (scope, p) = coverage.sql();
        s.connection.execute("INSERT INTO recovered_permission_approvals VALUES(?1,'external.open','http-https',?2,?3,1,1)",params![component.0,scope,p]).unwrap();
    }
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Project(p1),
    };
    let settings = s.read_settings().unwrap();
    let trust = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..settings
    };
    s.set_host_settings(settings, trust).unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveAutomatic,
        false,
    )
    .unwrap();
    assert!(decision_for(&mut s, &key).recovered.is_some());
    let mut stale = decision_for(&mut s, &key);
    stale.denied = true;
    let app = DecisionKey {
        coverage: Coverage::Application,
        ..key.clone()
    };
    let expected_app = decision_for(&mut s, &app);
    let batch = PermissionReview {
        installation: snapshot.clone(),
        target: Some(a.id),
        expected_settings: trust,
        items: vec![
            PermissionReviewItem {
                key: app.clone(),
                expected: expected_app,
                effect: PermissionEffect::ApproveExplicit,
                consume_recovered: true,
            },
            PermissionReviewItem {
                key: key.clone(),
                expected: stale,
                effect: PermissionEffect::ApproveExplicit,
                consume_recovered: true,
            },
        ],
    };
    assert!(matches!(
        s.save_permission_review(batch),
        Err(RegistryError::Conflict(_))
    ));
    assert!(decision_for(&mut s, &app).recovered.is_some());
    assert_eq!(decision_for(&mut s, &app).approval, None);
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveExplicit,
        true,
    )
    .unwrap();
    assert!(decision_for(&mut s, &key).recovered.is_none());
    assert!(decision_for(&mut s, &app).recovered.is_some());
    assert!(decision_for(
        &mut s,
        &DecisionKey {
            coverage: Coverage::Project(p2),
            ..key
        }
    )
    .recovered
    .is_some());
}
#[test]
fn injected_write_failure_rolls_back_whole_permission_batch() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    s.connection.execute("INSERT INTO recovered_permission_approvals VALUES(?1,'external.open','http-https','application',NULL,1,0)",[component.0]).unwrap();
    s.connection.execute_batch("CREATE TEMP TRIGGER fail_candidate_delete BEFORE DELETE ON recovered_permission_approvals BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(matches!(
        review(
            &mut s,
            &snapshot,
            a.id,
            key.clone(),
            PermissionEffect::ApproveExplicit,
            true
        ),
        Err(RegistryError::Storage(_))
    ));
    let d = decision_for(&mut s, &key);
    assert_eq!(d.approval, None);
    assert!(d.recovered.is_some());
}
#[test]
fn selection_cleanup_not_staging_and_uninstall_retention() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(&mut s, &source("2.0.0", "project", false));
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveExplicit,
        false,
    )
    .unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::Deny,
        false,
    )
    .unwrap();
    acknowledge(&mut s, &snapshot, &a, component, ActivationScope::Project).unwrap();
    s.set_enablement(EnablementChange {
        installation: snapshot.clone(),
        target: a.id,
        component,
        project: None,
        expected: Some(true),
        enabled: Some(false),
    })
    .unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    assert_eq!(
        decision_for(&mut s, &key).approval,
        Some(ApprovalSource::Explicit)
    );
    let snapshot = promote(&mut s, snapshot);
    assert_eq!(decision_for(&mut s, &key).approval, None);
    assert!(decision_for(&mut s, &key).denied);
    let snapshot = change(&mut s, snapshot, InstallationAction::Uninstall, None);
    assert!(snapshot.pointers.is_none());
    assert!(decisions::baseline(&s.connection, component)
        .unwrap()
        .is_some());
    assert!(decision_for(&mut s, &key).denied);
    let snapshot = install(&mut s, &a);
    assert!(snapshot.revision.0 > 1);
    assert_eq!(
        details(&mut s, a.package).artifacts[0].facts.package,
        a.package
    );
    let enabled: bool = s
        .connection
        .query_row(
            "SELECT enabled FROM component_enablement_defaults WHERE component_id=?1",
            [component.0],
            |r| r.get(0),
        )
        .unwrap();
    assert!(!enabled);
}
#[test]
fn scope_acknowledgement_selection_stale_away_back_and_retention() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(&mut s, &source("2.0.0", "application", true));
    let c = accept_source(&mut s, &source("3.0.0", "project", true));
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    assert_eq!(
        scope_blocker(ActivationScope::Project, None),
        Some(ScopeBlocker::InitialReview)
    );
    acknowledge(&mut s, &snapshot, &a, component, ActivationScope::Project).unwrap();
    let baseline1 = decisions::baseline(&s.connection, component)
        .unwrap()
        .unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    acknowledge(
        &mut s,
        &snapshot,
        &b,
        component,
        ActivationScope::Application,
    )
    .unwrap();
    assert_eq!(
        decisions::baseline(&s.connection, component).unwrap(),
        Some(baseline1.clone())
    );
    let snapshot = promote(&mut s, snapshot);
    let baseline2 = decisions::baseline(&s.connection, component)
        .unwrap()
        .unwrap();
    assert_eq!(baseline2.scope, ActivationScope::Application);
    assert_eq!(baseline2.revision, Revision(2));
    assert!(decisions::acknowledgement(&s.connection, component)
        .unwrap()
        .is_none());
    let snapshot = stage(&mut s, snapshot, c.id);
    acknowledge(&mut s, &snapshot, &c, component, ActivationScope::Project).unwrap();
    let snapshot = promote(&mut s, snapshot);
    let baseline3 = decisions::baseline(&s.connection, component)
        .unwrap()
        .unwrap();
    assert_eq!(baseline3.scope, baseline1.scope);
    assert_eq!(baseline3.revision, Revision(3));
    let snapshot = stage(&mut s, snapshot, b.id);
    let old = ScopeReview {
        installation: snapshot.clone(),
        target: b.id,
        acknowledgement: ScopeAcknowledgement {
            component,
            target_version: b.version.clone(),
            baseline: Some(baseline1),
            target_scope: ActivationScope::Application,
        },
    };
    assert!(matches!(
        s.acknowledge_scope(old),
        Err(RegistryError::Conflict(_))
    ));
    acknowledge(
        &mut s,
        &snapshot,
        &b,
        component,
        ActivationScope::Application,
    )
    .unwrap();
    let snapshot = change(&mut s, snapshot, InstallationAction::Uninstall, None);
    assert!(decisions::acknowledgement(&s.connection, component)
        .unwrap()
        .is_none());
    assert_eq!(
        decisions::baseline(&s.connection, component).unwrap(),
        Some(baseline3)
    );
    assert!(snapshot.pointers.is_none());
}
#[test]
fn unreviewed_scope_return_clears_derived_blocker_and_new_target_invalidates_ack() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(&mut s, &source("2.0.0", "application", true));
    let c = accept_source(&mut s, &source("3.0.0", "project", true));
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    acknowledge(&mut s, &snapshot, &a, component, ActivationScope::Project).unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    acknowledge(
        &mut s,
        &snapshot,
        &b,
        component,
        ActivationScope::Application,
    )
    .unwrap();
    let snapshot = stage(&mut s, snapshot, c.id);
    assert!(decisions::acknowledgement(&s.connection, component)
        .unwrap()
        .is_none());
    let snapshot = promote(&mut s, snapshot);
    assert_eq!(
        scope_blocker(
            ActivationScope::Project,
            decisions::baseline(&s.connection, component)
                .unwrap()
                .as_ref()
        ),
        None
    );
    let snapshot = stage(&mut s, snapshot, b.id);
    let snapshot = promote(&mut s, snapshot);
    assert_eq!(
        scope_blocker(
            ActivationScope::Application,
            decisions::baseline(&s.connection, component)
                .unwrap()
                .as_ref()
        ),
        Some(ScopeBlocker::ScopeChange)
    );
    let snapshot = stage(&mut s, snapshot, c.id);
    let _snapshot = promote(&mut s, snapshot);
    assert_eq!(
        scope_blocker(
            ActivationScope::Project,
            decisions::baseline(&s.connection, component)
                .unwrap()
                .as_ref()
        ),
        None
    );
}
#[test]
fn scope_exhaustion_and_selection_failure_are_atomic() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(&mut s, &source("2.0.0", "application", true));
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    acknowledge(&mut s, &snapshot, &a, component, ActivationScope::Project).unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    s.connection
        .execute(
            "UPDATE component_scope_state SET scope_revision=?1 WHERE component_id=?2",
            params![i64::MAX, component.0],
        )
        .unwrap();
    assert!(matches!(
        acknowledge(
            &mut s,
            &snapshot,
            &b,
            component,
            ActivationScope::Application
        ),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert_eq!(current(&mut s, a.package), snapshot);
}
#[test]
fn project_location_revision_stale_refresh_relink_and_exhaustion() {
    let (_dir, mut s) = store();
    let p = project(&mut s, 1);
    let before = s.project_details(p).unwrap();
    assert_eq!(before.revision, Revision(1));
    s.refresh_project_name(p, Revision(1), prepared_project(1))
        .unwrap();
    assert_eq!(s.project_details(p).unwrap().revision, Revision(1));
    let next = s
        .relink_project(
            p,
            Revision(1),
            prepared_project(2),
            RelinkPrerequisite::for_test(p, Revision(1)),
        )
        .unwrap();
    assert_eq!(next, Revision(2));
    assert!(matches!(
        s.refresh_project_name(p, Revision(1), prepared_project(1)),
        Err(RegistryError::Conflict(_))
    ));
    assert!(s
        .refresh_project_name(p, Revision(2), prepared_project(1))
        .is_err());
    s.connection
        .execute(
            "UPDATE project_registrations SET location_revision=?1 WHERE id=?2",
            params![i64::MAX, p.0],
        )
        .unwrap();
    assert!(matches!(
        s.relink_project(
            p,
            Revision(i64::MAX),
            prepared_project(3),
            RelinkPrerequisite::for_test(p, Revision(i64::MAX))
        ),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert_eq!(s.project_details(p).unwrap().location.path_bytes, vec![2]);
}
#[test]
fn cleanup_keeps_history_and_refuses_installed_artifacts() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    assert!(matches!(
        s.remove_unused_artifact(a.id, ArtifactUnused::for_test(a.id)),
        Err(RegistryError::Conflict(_))
    ));
    let _snapshot = change(&mut s, snapshot, InstallationAction::Uninstall, None);
    s.remove_unused_artifact(a.id, ArtifactUnused::for_test(a.id))
        .unwrap();
    assert!(details(&mut s, a.package).artifacts.is_empty());
    let history: i64 = s
        .connection
        .query_row("SELECT count(*) FROM package_version_history", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(history, 1);
    let p = prepared(&source("1.0.0", "project", false));
    let r = PublicationReceipt::for_test(&p);
    assert!(matches!(
        s.accept_artifact(p, r),
        Err(RegistryError::VersionConflict(_))
    ));
}
#[test]
fn readiness_rejects_domain_corruption_and_payload_bounds() {
    let (dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let _snapshot = install(&mut s, &a);
    s.connection
        .execute(
            "UPDATE artifact_files SET sha256=?1 WHERE artifact_id=?2 AND path='main.js'",
            params![[0u8; 32].as_slice(), a.id.0.as_slice()],
        )
        .unwrap();
    drop(s);
    assert!(matches!(
        Store::open(&dir.path().join("registry.sqlite"), limits()),
        Err(RegistryError::RecoveryRequired(_))
    ));
    let (dir, mut s) = store();
    accept_version(&mut s, "1.0.0");
    drop(s);
    let mut small = limits();
    small.max_snapshot_bytes = 32;
    assert!(matches!(
        Store::open(&dir.path().join("registry.sqlite"), small),
        Err(RegistryError::LimitExceeded(_))
    ));
}
#[test]
fn injected_acceptance_failure_rolls_back_history_components_and_artifact() {
    let (_dir, mut s) = store();
    s.connection.execute_batch("CREATE TEMP TRIGGER reject_file BEFORE INSERT ON artifact_files BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    let p = prepared(&source("1.0.0", "project", true));
    let r = PublicationReceipt::for_test(&p);
    assert!(matches!(
        s.accept_artifact(p, r),
        Err(RegistryError::Storage(_))
    ));
    for table in [
        "packages",
        "components",
        "package_version_history",
        "accepted_artifacts",
        "artifact_files",
    ] {
        assert_eq!(
            s.connection
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
#[test]
fn unsupported_profiles_do_not_prevent_acceptance_or_sibling_selection() {
    let (_dir, mut s) = store();
    let text =
        source("1.0.0", "project", true).replace("writers-ide.frontend/1", "future.profile/999");
    let sibling = source("1.0.0", "project", false)
        .split("[[components]]")
        .nth(1)
        .unwrap()
        .replace("id = \"main\"", "id = \"sibling\"");
    let a = accept_source(&mut s, &format!("{text}\n[[components]]{sibling}"));
    let snapshot = install(&mut s, &a);
    assert_eq!(snapshot.pointers.unwrap().selected, Some(a.id));
    assert_eq!(details(&mut s, a.package).artifacts[0].components.len(), 2);
    // Runtime profile eligibility/dependency propagation remains the manifest
    // resolver's responsibility; registry metadata cannot grant it.
}

#[test]
fn cancel_all_discards_both_pending_targets_and_keeps_selected() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_version(&mut s, "2.0.0");
    let r = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let snapshot = stage(&mut s, snapshot, b.id);
    let snapshot = change(
        &mut s,
        snapshot,
        InstallationAction::Repair { keep_update: true },
        Some(r.id),
    );
    let snapshot = change(&mut s, snapshot, InstallationAction::CancelAllPending, None);
    assert_pointers(&snapshot, Some(a.id), None, None, None);
    let revision = snapshot.revision;
    let snapshot = change(&mut s, snapshot, InstallationAction::CancelStage, None);
    assert_eq!(snapshot.revision, revision);
}

#[test]
fn project_overrides_inherit_and_become_inactive_without_deletion() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(&mut s, &source("2.0.0", "application", true));
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let p = project(&mut s, 1);
    s.set_enablement(EnablementChange {
        installation: snapshot.clone(),
        target: a.id,
        component,
        project: Some(p),
        expected: None,
        enabled: Some(false),
    })
    .unwrap();
    assert_eq!(
        s.project_details(p).unwrap().overrides,
        vec![(component, false)]
    );
    s.set_enablement(EnablementChange {
        installation: snapshot.clone(),
        target: a.id,
        component,
        project: Some(p),
        expected: Some(false),
        enabled: None,
    })
    .unwrap();
    assert!(s.project_details(p).unwrap().overrides.is_empty());
    s.set_enablement(EnablementChange {
        installation: snapshot.clone(),
        target: a.id,
        component,
        project: Some(p),
        expected: None,
        enabled: Some(false),
    })
    .unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    let snapshot = promote(&mut s, snapshot);
    assert_eq!(
        s.project_details(p).unwrap().overrides,
        vec![(component, false)]
    );
    assert!(s
        .set_enablement(EnablementChange {
            installation: snapshot,
            target: b.id,
            component,
            project: Some(p),
            expected: Some(false),
            enabled: Some(true)
        })
        .is_err());
}

#[test]
fn removed_components_lose_approvals_but_reuse_stable_choices_and_denials() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(
        &mut s,
        &source("2.0.0", "project", true).replace("id = \"main\"", "id = \"replacement\""),
    );
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveExplicit,
        false,
    )
    .unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::Deny,
        false,
    )
    .unwrap();
    s.connection.execute("INSERT INTO recovered_permission_approvals VALUES(?1,'external.open','http-https','application',NULL,1,0)", [component.0]).unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    assert!(decision_for(&mut s, &key).recovered.is_some());
    let snapshot = promote(&mut s, snapshot);
    let d = decision_for(&mut s, &key);
    assert!(d.approval.is_none() && d.recovered.is_none() && d.denied);
    let replacement = details(&mut s, b.package)
        .artifacts
        .into_iter()
        .find(|a| a.facts.id == b.id)
        .unwrap()
        .components
        .remove(0);
    assert_eq!(replacement.enabled, Some(false));
    let snapshot = change(&mut s, snapshot, InstallationAction::RestorePrevious, None);
    let _snapshot = promote(&mut s, snapshot);
    let original = details(&mut s, a.package)
        .artifacts
        .into_iter()
        .find(|artifact| artifact.facts.id == a.id)
        .unwrap()
        .components
        .remove(0);
    assert_eq!(original.id, component);
    assert_eq!(original.enabled, Some(true));
    assert_eq!(decision_for(&mut s, &key).approval, None);
}

#[test]
fn explicit_approval_and_deliberate_denial_clear_are_atomic() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::Deny,
        false,
    )
    .unwrap();
    s.connection.execute_batch("CREATE TEMP TRIGGER fail_denial_clear BEFORE DELETE ON permission_denials BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    assert!(review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveExplicitAndClearDenial,
        false
    )
    .is_err());
    let d = decision_for(&mut s, &key);
    assert!(d.approval.is_none() && d.denied);
    s.connection
        .execute_batch("DROP TRIGGER fail_denial_clear")
        .unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveExplicitAndClearDenial,
        false,
    )
    .unwrap();
    let d = decision_for(&mut s, &key);
    assert_eq!(d.approval, Some(ApprovalSource::Explicit));
    assert!(!d.denied);
}

#[test]
fn sqlite_backup_reopens_with_the_same_domain_snapshot() {
    let (dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let p = project(&mut s, 1);
    let identity = s.project_details(p).unwrap().public_id;
    let backup = dir.path().join("backup.sqlite");
    s.backup(&backup).unwrap();
    let mut copied = Store::open(&backup, limits()).unwrap();
    assert_eq!(current(&mut copied, a.package), snapshot);
    assert_eq!(copied.project_details(p).unwrap().public_id, identity);
    assert!(s.backup(&backup).is_err());
}

#[test]
fn rollback_failure_reports_unknown_and_disables_every_operation() {
    let (dir, mut s) = store();
    s.connection.execute_batch("CREATE TEMP TRIGGER reject_file BEFORE INSERT ON artifact_files BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
    s.fail_rollback = true;
    let p = prepared(&source("1.0.0", "project", true));
    let receipt = PublicationReceipt::for_test(&p);
    assert!(matches!(
        s.accept_artifact(p, receipt),
        Err(RegistryError::OutcomeUnknown(_))
    ));
    assert!(!s.connection.is_autocommit());
    assert!(matches!(
        s.read_settings(),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        s.package_details(PackageId(1)),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        s.project_details(ProjectId(1)),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        s.backup(&dir.path().join("blocked-backup")),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        s.register_project(prepared_project(1)),
        Err(RegistryError::Unavailable(_))
    ));
    drop(s);
    let reopened = Store::open(&dir.path().join("registry.sqlite"), limits()).unwrap();
    assert_eq!(
        reopened
            .connection
            .query_row("SELECT count(*) FROM packages", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn automatic_processing_cannot_consume_recovered_candidates() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    s.connection.execute("INSERT INTO recovered_permission_approvals VALUES(?1,'external.open','http-https','application',NULL,1,1)", [component.0]).unwrap();
    let secure = s.read_settings().unwrap();
    let trust = HostSettings {
        permission_mode: PermissionMode::Trust,
        ..secure
    };
    s.set_host_settings(secure, trust).unwrap();
    for effect in [
        PermissionEffect::ApproveAutomatic,
        PermissionEffect::ClearApproval,
        PermissionEffect::ClearDenial,
    ] {
        assert!(matches!(
            review(&mut s, &snapshot, a.id, key.clone(), effect, true),
            Err(RegistryError::InvalidInput(_))
        ));
        assert!(decision_for(&mut s, &key).recovered.is_some());
    }
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::Deny,
        true,
    )
    .unwrap();
    let d = decision_for(&mut s, &key);
    assert!(d.denied && d.recovered.is_none() && d.approval.is_none());
}

#[test]
fn old_artifact_cannot_restore_dropped_approval_and_retained_denial_needs_no_artifact() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let b = accept_source(&mut s, &source("2.0.0", "project", false));
    let snapshot = install(&mut s, &a);
    let component = component(&mut s, &a);
    let key = DecisionKey {
        component,
        permission: NativePermission::ExternalOpen,
        coverage: Coverage::Application,
    };
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::ApproveExplicit,
        false,
    )
    .unwrap();
    review(
        &mut s,
        &snapshot,
        a.id,
        key.clone(),
        PermissionEffect::Deny,
        false,
    )
    .unwrap();
    let snapshot = stage(&mut s, snapshot, b.id);
    let snapshot = promote(&mut s, snapshot);
    assert!(matches!(
        review(
            &mut s,
            &snapshot,
            a.id,
            key.clone(),
            PermissionEffect::ApproveExplicit,
            false
        ),
        Err(RegistryError::Conflict(_))
    ));
    let snapshot = change(&mut s, snapshot, InstallationAction::Uninstall, None);
    s.remove_unused_artifact(a.id, ArtifactUnused::for_test(a.id))
        .unwrap();
    s.remove_unused_artifact(b.id, ArtifactUnused::for_test(b.id))
        .unwrap();
    let expected = decision_for(&mut s, &key);
    let expected_settings = s.read_settings().unwrap();
    s.save_permission_review(PermissionReview {
        installation: snapshot,
        target: None,
        expected_settings,
        items: vec![PermissionReviewItem {
            key: key.clone(),
            expected,
            effect: PermissionEffect::ClearDenial,
            consume_recovered: false,
        }],
    })
    .unwrap();
    assert!(!decision_for(&mut s, &key).denied);
}

#[test]
fn startup_preflight_rejects_oversized_payload_before_schema_domain_reads() {
    let (dir, s) = store();
    s.connection
        .execute(
            "INSERT INTO packages(name) VALUES(?1)",
            ["x".repeat(limits().max_text_bytes + 1)],
        )
        .unwrap();
    drop(s);
    // Schema identifier validation would report RecoveryRequired. LimitExceeded
    // demonstrates that scalar preflight rejected the oversized value first.
    assert!(matches!(
        Store::open(&dir.path().join("registry.sqlite"), limits()),
        Err(RegistryError::LimitExceeded(_))
    ));
}

#[test]
fn multiline_manifest_display_metadata_survives_acceptance_and_reopen() {
    let (dir, mut s) = store();
    let text = source("1.0.0", "project", true)
        .replace(
            "display_name = \"Sample\"",
            "display_name = \"Sample\\nPackage\\tName\"",
        )
        .replace(
            "description = \"Package description\"",
            "description = \"\"\"Package description\nSecond line\twith tab\"\"\"",
        )
        .replace(
            "display_name = \"Main\"",
            "display_name = \"Main\\nComponent\\tName\"",
        )
        .replace(
            "description = \"Component description\"",
            "description = \"\"\"Component description\nSecond line\twith tab\"\"\"",
        );
    let a = accept_source(&mut s, &text);
    let snapshot = install(&mut s, &a);
    drop(s);
    let mut reopened = Store::open(&dir.path().join("registry.sqlite"), limits()).unwrap();
    let package = details(&mut reopened, a.package);
    assert_eq!(package.installation, snapshot);
    let artifact = &package.artifacts[0];
    assert_eq!(artifact.display_name, "Sample\nPackage\tName");
    assert_eq!(
        artifact.description,
        "Package description\nSecond line\twith tab"
    );
    assert_eq!(artifact.components[0].display_name, "Main\nComponent\tName");
    assert_eq!(
        artifact.components[0].description,
        "Component description\nSecond line\twith tab"
    );
}

#[test]
fn small_data_row_budget_does_not_restrict_fixed_schema_objects() {
    let dir = tempfile::tempdir().unwrap();
    let mut small = limits();
    small.max_rows = 3;
    let path = dir.path().join("small.sqlite");
    let mut s = Store::create(&path, small.clone()).unwrap();
    let tx = s.connection.transaction().unwrap();
    validate_snapshot(&tx, &small).unwrap();
    tx.commit().unwrap();
    drop(s);
    Store::open(&path, small).unwrap();
}

#[test]
fn snapshot_validation_uses_callers_transaction_and_rejects_file_hash_mismatch() {
    let (_dir, mut s) = store();
    let a = accept_version(&mut s, "1.0.0");
    let tx = s.connection.transaction().unwrap();
    validate_snapshot(&tx, &limits()).unwrap();
    assert!(!tx.is_autocommit());
    tx.execute(
        "UPDATE artifact_files SET sha256=?1 WHERE artifact_id=?2 AND path='main.js'",
        params![[0u8; 32].as_slice(), a.id.0.as_slice()],
    )
    .unwrap();
    assert!(matches!(
        validate_snapshot(&tx, &limits()),
        Err(RegistryError::RecoveryRequired(_))
    ));
    assert!(!tx.is_autocommit());
    tx.rollback().unwrap();
    assert_eq!(details(&mut s, a.package).artifacts[0].facts, a);
}

#[test]
fn bounded_write_rejection_rolls_back_the_entire_prepared_acceptance() {
    let (_dir, mut s) = store();
    s.limits.max_snapshot_bytes = 128;
    let p = prepared(&source("1.0.0", "project", true));
    let r = PublicationReceipt::for_test(&p);
    assert!(matches!(
        s.accept_artifact(p, r),
        Err(RegistryError::LimitExceeded(_))
    ));
    assert_eq!(
        s.connection
            .query_row("SELECT count(*) FROM packages", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        0
    );
}
