//! Pure semantic pointer calculation. Persistence, proof checks and consent are
//! owned by Store; this module never accepts arbitrary replacement pointers.
use super::{
    error::{RegistryError, Result},
    model::*,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum InstallationAction {
    Install { select_now: bool },
    ReplaceStagedInstall,
    StageUpdate,
    Repair { keep_update: bool },
    RestorePrevious,
    CancelStage,
    CancelAllPending,
    Uninstall,
    PromoteStage,
}
#[derive(Clone, Debug)]
pub(crate) enum InstallationExpectation {
    Existing(InstallationSnapshot),
    /// Acceptance and first installation reserve the identity in one transaction.
    AbsentPackage(String),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Transition {
    pub pointers: Option<InstallationPointers>,
    pub selection_changed: bool,
    pub uninstall_cleanup: bool,
}
fn conflict(message: &str) -> RegistryError {
    RegistryError::Conflict(message.into())
}

pub(crate) fn calculate(
    current: &InstallationSnapshot,
    action: InstallationAction,
    target: Option<&ArtifactFacts>,
    mut facts: impl FnMut(ArtifactId) -> Result<ArtifactFacts>,
) -> Result<Transition> {
    let before = current.pointers.as_ref();
    if let Some(pointers) = before {
        validate_pointers(current.package, pointers, &mut facts)?;
    }
    let mut after = before.cloned();
    let target_required = matches!(
        action,
        InstallationAction::Install { .. }
            | InstallationAction::ReplaceStagedInstall
            | InstallationAction::StageUpdate
            | InstallationAction::Repair { .. }
    );
    if target_required != target.is_some() {
        return Err(RegistryError::InvalidInput(
            "unexpected or missing installation target".into(),
        ));
    }
    if target.is_some_and(|t| t.package != current.package) {
        return Err(conflict("target package mismatch"));
    }
    match action {
        InstallationAction::Install { select_now } => {
            if before.is_some() {
                return Err(conflict("package already installed"));
            }
            let id = target.unwrap().id;
            after = Some(if select_now {
                InstallationPointers {
                    selected: Some(id),
                    ..Default::default()
                }
            } else {
                InstallationPointers {
                    staged: Some(id),
                    ..Default::default()
                }
            });
        }
        InstallationAction::ReplaceStagedInstall => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("no staged installation"))?;
            if p.selected.is_some() {
                return Err(conflict("not a staged-only installation"));
            }
            p.staged = Some(target.unwrap().id);
        }
        InstallationAction::StageUpdate => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("package uninstalled"))?;
            let selected = facts(
                p.selected
                    .ok_or_else(|| conflict("no selected installation"))?,
            )?;
            let target = target.unwrap();
            if target.version == selected.version {
                return Err(conflict("same-version replacement requires repair"));
            }
            p.staged = Some(target.id);
        }
        InstallationAction::Repair { keep_update } => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("package uninstalled"))?;
            let selected = facts(
                p.selected
                    .ok_or_else(|| conflict("no selected installation"))?,
            )?;
            let target = target.unwrap();
            if target.version != selected.version
                || target.fingerprint != selected.fingerprint
                || Some(target.id) == p.selected
                || Some(target.id) == p.previous
                || Some(target.id) == p.staged
                || Some(target.id) == p.pending_repair
            {
                return Err(conflict(
                    "repair must be a fresh matching copy of selected release",
                ));
            }
            let has_update = match p.staged {
                Some(id) => facts(id)?.version != selected.version,
                None => false,
            };
            if has_update && keep_update {
                p.pending_repair = Some(target.id);
            } else {
                p.staged = Some(target.id);
                p.pending_repair = None;
            }
        }
        InstallationAction::RestorePrevious => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("package uninstalled"))?;
            let selected = facts(
                p.selected
                    .ok_or_else(|| conflict("no selected installation"))?,
            )?;
            let previous = facts(
                p.previous
                    .ok_or_else(|| conflict("no previous installation"))?,
            )?;
            if selected.version == previous.version {
                return Err(conflict(
                    "same-version previous must be prepared as fresh repair",
                ));
            }
            p.staged = Some(previous.id);
        }
        InstallationAction::CancelStage => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("package uninstalled"))?;
            if p.selected.is_none() {
                after = None;
            } else {
                p.staged = p.pending_repair.take();
            }
        }
        InstallationAction::CancelAllPending => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("package uninstalled"))?;
            if p.selected.is_none() {
                after = None;
            } else {
                p.staged = None;
                p.pending_repair = None;
            }
        }
        InstallationAction::Uninstall => {
            after = None;
        }
        InstallationAction::PromoteStage => {
            let p = after
                .as_mut()
                .ok_or_else(|| conflict("package uninstalled"))?;
            let staged = facts(p.staged.ok_or_else(|| conflict("no staged target"))?)?;
            if let Some(selected) = p.selected {
                if facts(selected)?.version != staged.version {
                    p.previous = p.pending_repair.or(Some(selected));
                }
            }
            p.selected = Some(staged.id);
            p.staged = None;
            p.pending_repair = None;
        }
    }
    if let Some(p) = &after {
        validate_pointers(current.package, p, &mut facts)?;
    }
    Ok(Transition {
        selection_changed: before.and_then(|p| p.selected)
            != after.as_ref().and_then(|p| p.selected),
        uninstall_cleanup: before.is_some() && after.is_none(),
        pointers: after,
    })
}

pub(crate) fn validate_pointers(
    package: PackageId,
    p: &InstallationPointers,
    mut facts: impl FnMut(ArtifactId) -> Result<ArtifactFacts>,
) -> Result<()> {
    let invalid =
        || RegistryError::RecoveryRequired("invalid persisted installation relationships".into());
    if p.selected.is_none()
        && (p.staged.is_none() || p.previous.is_some() || p.pending_repair.is_some())
    {
        return Err(invalid());
    }
    for id in [p.selected, p.staged, p.previous, p.pending_repair]
        .into_iter()
        .flatten()
    {
        if facts(id)?.package != package {
            return Err(invalid());
        }
    }
    if let Some(selected) = p.selected {
        if p.staged == Some(selected) || p.previous == Some(selected) {
            return Err(invalid());
        }
        let selected = facts(selected)?;
        if let Some(staged) = p.staged {
            if facts(staged)?.version == selected.version && p.previous == Some(staged) {
                return Err(invalid());
            }
        }
        if let Some(repair) = p.pending_repair {
            if p.staged.is_none() || [p.selected, p.staged, p.previous].contains(&Some(repair)) {
                return Err(invalid());
            }
            let repair = facts(repair)?;
            if repair.version != selected.version
                || repair.fingerprint != selected.fingerprint
                || facts(p.staged.unwrap())?.version == selected.version
            {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
