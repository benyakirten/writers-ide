use super::*;

pub(super) fn baseline(c: &Connection, component: ComponentId) -> Result<Option<ScopeBaseline>> {
    c.query_row("SELECT last_reviewed_scope,scope_revision FROM component_scope_state WHERE component_id=?1",[component.0],|r| Ok((r.get::<_,String>(0)?,r.get::<_,i64>(1)?))).optional()?
        .map(|(scope, revision)| {
            if revision < 1 {
                return Err(corrupt("invalid scope revision"));
            }
            Ok(ScopeBaseline { scope: parse_scope(&scope)?, revision: Revision(revision) })
        }).transpose()
}
pub(super) fn acknowledgement(
    c: &Connection,
    component: ComponentId,
) -> Result<Option<ScopeAcknowledgement>> {
    let row = c.query_row("SELECT target_version,review_kind,previous_scope,expected_scope_revision,target_scope FROM component_scope_acknowledgements WHERE component_id=?1",[component.0],|r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<i64>>(3)?,r.get::<_,String>(4)?))).optional()?;
    row.map(|(version, kind, scope, revision, target)| {
        let baseline = match (kind.as_str(), scope, revision) {
            ("initial", None, None) => None,
            ("scope-change", Some(scope), Some(revision)) if revision > 0 => Some(ScopeBaseline {
                scope: parse_scope(&scope)?,
                revision: Revision(revision),
            }),
            _ => return Err(corrupt("scope acknowledgement shape")),
        };
        Ok(ScopeAcknowledgement {
            component,
            target_version: version,
            baseline,
            target_scope: parse_scope(&target)?,
        })
    })
    .transpose()
}
fn target_component(
    c: &Connection,
    expected: &InstallationSnapshot,
    target: ArtifactId,
    component: ComponentId,
) -> Result<(ArtifactFacts, ActivationScope)> {
    let facts = artifact_facts(c, target)?;
    if facts.package != expected.package {
        return Err(RegistryError::InvalidInput(
            "target package mismatch".into(),
        ));
    }
    let scope: String = c.query_row("SELECT activation_scope FROM artifact_components WHERE artifact_id=?1 AND component_id=?2",params![target.0.as_slice(),component.0],|r| r.get(0)).optional()?.ok_or_else(|| RegistryError::Conflict("target component declaration absent".into()))?;
    Ok((facts, parse_scope(&scope)?))
}
fn scope_target_current(expected: &InstallationSnapshot, target: ArtifactId) -> bool {
    expected
        .pointers
        .as_ref()
        .is_some_and(|p| p.selected == Some(target) || p.staged == Some(target))
}
pub(super) fn acknowledge(
    c: &Connection,
    review: ScopeReview,
    limits: &RegistryLimits,
) -> Result<()> {
    check_installation(c, &review.installation)?;
    if !scope_target_current(&review.installation, review.target) {
        return Err(RegistryError::Conflict(
            "scope review target is not selected or staged".into(),
        ));
    }
    let a = review.acknowledgement;
    check_text(&a.target_version, limits.max_text_bytes)?;
    let (facts, scope) = target_component(c, &review.installation, review.target, a.component)?;
    if a.target_version != facts.version
        || scope != a.target_scope
        || baseline(c, a.component)? != a.baseline
    {
        return Err(RegistryError::Conflict(
            "scope review baseline or target changed".into(),
        ));
    }
    if a.baseline.as_ref().is_some_and(|b| b.scope == scope) {
        return Err(RegistryError::InvalidInput("scope already reviewed".into()));
    }
    // Detect exhausted baselines when review is saved, not only at promotion.
    if let Some(b) = &a.baseline {
        b.revision.next()?;
    }
    let package = review.installation.package;
    c.execute("INSERT INTO component_scope_acknowledgements(component_id,package_id,target_version,review_kind,previous_scope,expected_scope_revision,target_scope) VALUES(?1,?2,?3,?4,?5,?6,?7)
        ON CONFLICT(component_id) DO UPDATE SET package_id=excluded.package_id,target_version=excluded.target_version,review_kind=excluded.review_kind,previous_scope=excluded.previous_scope,expected_scope_revision=excluded.expected_scope_revision,target_scope=excluded.target_scope",
        params![a.component.0,package.0,a.target_version,if a.baseline.is_none() { "initial" } else { "scope-change" },a.baseline.as_ref().map(|b| scope_sql(b.scope)),a.baseline.as_ref().map(|b| b.revision.0),scope_sql(a.target_scope)])?;
    if review
        .installation
        .pointers
        .as_ref()
        .and_then(|p| p.selected)
        == Some(review.target)
    {
        apply_acknowledgements(c, package, review.target, limits)?;
    }
    Ok(())
}
pub(super) fn apply_acknowledgements(
    c: &Connection,
    package: PackageId,
    selected: ArtifactId,
    limits: &RegistryLimits,
) -> Result<()> {
    let facts = artifact_facts(c, selected)?;
    let mut q = c.prepare("SELECT component_id FROM component_scope_acknowledgements WHERE package_id=?1 ORDER BY component_id LIMIT ?2")?;
    let ids = q
        .query_map(params![package.0, limits.max_rows as i64 + 1], |r| {
            Ok(ComponentId(r.get(0)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if ids.len() > limits.max_rows {
        return Err(RegistryError::LimitExceeded(
            "scope acknowledgement count".into(),
        ));
    }
    for component in ids {
        let a = acknowledgement(c, component)?.unwrap();
        if a.target_version != facts.version {
            continue;
        }
        let scope: Option<String> = c.query_row("SELECT activation_scope FROM artifact_components WHERE artifact_id=?1 AND component_id=?2",params![selected.0.as_slice(),component.0],|r| r.get(0)).optional()?;
        if scope.as_deref() != Some(scope_sql(a.target_scope))
            || baseline(c, component)? != a.baseline
        {
            return Err(RegistryError::Conflict(
                "pending scope review no longer applies".into(),
            ));
        }
        let revision = match a.baseline {
            Some(b) => b.revision.next()?,
            None => Revision(1),
        };
        c.execute("INSERT INTO component_scope_state(component_id,last_reviewed_scope,scope_revision) VALUES(?1,?2,?3)
            ON CONFLICT(component_id) DO UPDATE SET last_reviewed_scope=excluded.last_reviewed_scope,scope_revision=excluded.scope_revision",params![component.0,scope_sql(a.target_scope),revision.0])?;
        c.execute(
            "DELETE FROM component_scope_acknowledgements WHERE component_id=?1",
            [component.0],
        )?;
    }
    Ok(())
}
pub(super) fn invalidate_acknowledgements(
    c: &Connection,
    package: PackageId,
    target: Option<ArtifactId>,
) -> Result<()> {
    match target {
        Some(target) => {
            let version = artifact_facts(c, target)?.version;
            c.execute("DELETE FROM component_scope_acknowledgements WHERE package_id=?1 AND target_version<>?2",params![package.0,version])?;
        }
        None => {
            c.execute(
                "DELETE FROM component_scope_acknowledgements WHERE package_id=?1",
                [package.0],
            )?;
        }
    }
    Ok(())
}
pub(super) fn selection_cleanup(
    c: &Connection,
    package: PackageId,
    selected: ArtifactId,
) -> Result<()> {
    for table in ["permission_approvals", "recovered_permission_approvals"] {
        c.execute(&format!("DELETE FROM {table} AS d WHERE component_id IN (SELECT id FROM components WHERE package_id=?1)
            AND (NOT EXISTS(SELECT 1 FROM artifact_components ac WHERE ac.artifact_id=?2 AND ac.component_id=d.component_id)
            OR NOT (EXISTS(SELECT 1 FROM artifact_package_permissions p WHERE p.artifact_id=?2 AND p.operation=d.operation AND p.resource=d.resource)
                OR EXISTS(SELECT 1 FROM artifact_component_permissions p WHERE p.artifact_id=?2 AND p.component_id=d.component_id AND p.operation=d.operation AND p.resource=d.resource)))"),params![package.0,selected.0.as_slice()])?;
    }
    Ok(())
}
pub(super) fn uninstall_cleanup(c: &Connection, package: PackageId) -> Result<()> {
    for table in [
        "permission_approvals",
        "recovered_permission_approvals",
        "component_scope_acknowledgements",
    ] {
        c.execute(&format!("DELETE FROM {table} WHERE component_id IN (SELECT id FROM components WHERE package_id=?1)"),[package.0])?;
    }
    Ok(())
}
pub(super) fn set_enablement(c: &Connection, change: EnablementChange) -> Result<()> {
    check_installation(c, &change.installation)?;
    if !scope_target_current(&change.installation, change.target) {
        return Err(RegistryError::Conflict(
            "enablement target is not selected or staged".into(),
        ));
    }
    let (_, scope) = target_component(c, &change.installation, change.target, change.component)?;
    match change.project {
        Some(project) => {
            if scope != ActivationScope::Project {
                return Err(RegistryError::InvalidInput(
                    "project override is inapplicable to application scope".into(),
                ));
            }
            let current: Option<bool> = c.query_row("SELECT enabled FROM project_component_overrides WHERE project_registration_id=?1 AND component_id=?2",params![project.0,change.component.0],|r| r.get(0)).optional()?;
            if current != change.expected {
                return Err(RegistryError::Conflict("project enablement changed".into()));
            }
            require_project(c, project)?;
            if let Some(enabled) = change.enabled {
                c.execute("INSERT INTO project_component_overrides(project_registration_id,component_id,enabled) VALUES(?1,?2,?3) ON CONFLICT(project_registration_id,component_id) DO UPDATE SET enabled=excluded.enabled",params![project.0,change.component.0,enabled])?;
            } else {
                c.execute("DELETE FROM project_component_overrides WHERE project_registration_id=?1 AND component_id=?2",params![project.0,change.component.0])?;
            }
        }
        None => {
            let current: Option<bool> = c
                .query_row(
                    "SELECT enabled FROM component_enablement_defaults WHERE component_id=?1",
                    [change.component.0],
                    |r| r.get(0),
                )
                .optional()?;
            if current != change.expected {
                return Err(RegistryError::Conflict(
                    "application enablement changed".into(),
                ));
            }
            let enabled = change.enabled.ok_or_else(|| {
                RegistryError::InvalidInput("application enablement cannot inherit".into())
            })?;
            c.execute("INSERT INTO component_enablement_defaults(component_id,enabled) VALUES(?1,?2) ON CONFLICT(component_id) DO UPDATE SET enabled=excluded.enabled",params![change.component.0,enabled])?;
        }
    }
    Ok(())
}
fn require_project(c: &Connection, project: ProjectId) -> Result<()> {
    let exists: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM project_registrations WHERE id=?1)",
        [project.0],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(RegistryError::NotFound("project registration".into()));
    }
    Ok(())
}
pub(super) fn decision(c: &Connection, key: &DecisionKey) -> Result<PermissionDecision> {
    let (operation, resource) = key.permission.sql();
    let (scope, project) = key.coverage.sql();
    let args = params![key.component.0, operation, resource, scope, project];
    let predicate = "component_id=?1 AND operation=?2 AND resource=?3 AND coverage_scope=?4 AND project_registration_id IS ?5";
    let source: Option<String> = c
        .query_row(
            &format!("SELECT source FROM permission_approvals WHERE {predicate}"),
            args,
            |r| r.get(0),
        )
        .optional()?;
    let approval = source
        .map(|s| match s.as_str() {
            "explicit" => Ok(ApprovalSource::Explicit),
            "automatic" => Ok(ApprovalSource::Automatic),
            _ => Err(corrupt("approval source")),
        })
        .transpose()?;
    let denied: bool = c.query_row(
        &format!("SELECT EXISTS(SELECT 1 FROM permission_denials WHERE {predicate})"),
        args,
        |r| r.get(0),
    )?;
    let recovered = c.query_row(&format!("SELECT had_explicit_approval,had_automatic_approval FROM recovered_permission_approvals WHERE {predicate}"),args,|r| Ok((r.get(0)?,r.get(1)?))).optional()?;
    Ok(PermissionDecision {
        key: key.clone(),
        approval,
        denied,
        recovered,
    })
}
pub(super) fn save_review(
    c: &Connection,
    review: PermissionReview,
    limits: &RegistryLimits,
) -> Result<()> {
    if review.items.len() > limits.max_review_items {
        return Err(RegistryError::LimitExceeded(
            "permission review item count".into(),
        ));
    }
    check_installation(c, &review.installation)?;
    if let Some(target) = review.target {
        if artifact_facts(c, target)?.package != review.installation.package {
            return Err(RegistryError::InvalidInput(
                "review target package mismatch".into(),
            ));
        }
    }
    if read_settings(c)? != review.expected_settings {
        return Err(RegistryError::Conflict(
            "reviewed permission mode changed".into(),
        ));
    }
    // Validate the entire batch against the original state before changing any row.
    let mut keys = Vec::new();
    for item in &review.items {
        if keys.contains(&item.key) {
            return Err(RegistryError::InvalidInput(
                "duplicate permission review identity".into(),
            ));
        }
        keys.push(item.key.clone());
        let key = &item.key;
        if item.expected.key != *key || decision(c, key)? != item.expected {
            return Err(RegistryError::Conflict(
                "permission decision changed".into(),
            ));
        }
        let owner: i64 = c
            .query_row(
                "SELECT package_id FROM components WHERE id=?1",
                [key.component.0],
                |r| r.get(0),
            )
            .optional()?
            .ok_or_else(|| RegistryError::NotFound("component".into()))?;
        if owner != review.installation.package.0 {
            return Err(RegistryError::InvalidInput(
                "review component ownership mismatch".into(),
            ));
        }
        if let Coverage::Project(project) = key.coverage {
            require_project(c, project)?;
        }
        if matches!(
            item.effect,
            PermissionEffect::ApproveExplicit
                | PermissionEffect::ApproveExplicitAndClearDenial
                | PermissionEffect::ApproveAutomatic
        ) {
            let target = review.target.ok_or_else(|| {
                RegistryError::InvalidInput("approval requires a current declaration target".into())
            })?;
            if !scope_target_current(&review.installation, target) {
                return Err(RegistryError::Conflict(
                    "approval target is not selected or staged".into(),
                ));
            }
            let (_, scope) = target_component(c, &review.installation, target, key.component)?;
            if !requirements(c, target, key.component)?.contains(&key.permission) {
                return Err(RegistryError::Conflict(
                    "permission no longer required by reviewed declaration".into(),
                ));
            }
            if scope == ActivationScope::Application && matches!(key.coverage, Coverage::Project(_))
            {
                return Err(RegistryError::InvalidInput(
                    "application component requires application-wide approval".into(),
                ));
            }
        }
        if item.effect == PermissionEffect::ApproveAutomatic
            && review.expected_settings.permission_mode != PermissionMode::Trust
        {
            return Err(RegistryError::Conflict(
                "automatic approval requires Trust mode".into(),
            ));
        }
        if item.consume_recovered
            && (!matches!(
                item.effect,
                PermissionEffect::ApproveExplicit
                    | PermissionEffect::ApproveExplicitAndClearDenial
                    | PermissionEffect::Deny
            ) || item.expected.recovered.is_none())
        {
            return Err(RegistryError::InvalidInput(
                "candidate consumption requires explicit matching review".into(),
            ));
        }
    }
    for item in review.items {
        let key = item.key;
        let (op, res) = key.permission.sql();
        let (scope, project) = key.coverage.sql();
        let args = params![key.component.0, op, res, scope, project];
        let predicate = "component_id=?1 AND operation=?2 AND resource=?3 AND coverage_scope=?4 AND project_registration_id IS ?5";
        match item.effect {
            PermissionEffect::ApproveExplicit
            | PermissionEffect::ApproveExplicitAndClearDenial
            | PermissionEffect::ApproveAutomatic => {
                // Delete/insert avoids partial-index conflict-target ambiguity, and
                // preserves an explicit approval during automatic processing.
                let explicit = item.effect != PermissionEffect::ApproveAutomatic
                    || item.expected.approval == Some(ApprovalSource::Explicit);
                c.execute(
                    &format!("DELETE FROM permission_approvals WHERE {predicate}"),
                    args,
                )?;
                c.execute("INSERT INTO permission_approvals(component_id,operation,resource,coverage_scope,project_registration_id,source) VALUES(?1,?2,?3,?4,?5,?6)",params![key.component.0,op,res,scope,project,if explicit { "explicit" } else { "automatic" }])?;
            }
            PermissionEffect::Deny => {
                c.execute("INSERT OR IGNORE INTO permission_denials(component_id,operation,resource,coverage_scope,project_registration_id) VALUES(?1,?2,?3,?4,?5)",args)?;
            }
            PermissionEffect::ClearApproval => {
                c.execute(
                    &format!("DELETE FROM permission_approvals WHERE {predicate}"),
                    args,
                )?;
            }
            PermissionEffect::ClearDenial => {
                c.execute(
                    &format!("DELETE FROM permission_denials WHERE {predicate}"),
                    args,
                )?;
            }
        }
        if item.effect == PermissionEffect::ApproveExplicitAndClearDenial {
            c.execute(
                &format!("DELETE FROM permission_denials WHERE {predicate}"),
                args,
            )?;
        }
        if item.consume_recovered {
            c.execute(
                &format!("DELETE FROM recovered_permission_approvals WHERE {predicate}"),
                args,
            )?;
        }
    }
    Ok(())
}
fn decisions_where(
    c: &Connection,
    filter: &str,
    id: i64,
    limits: &RegistryLimits,
) -> Result<Vec<PermissionDecision>> {
    let mut q = c.prepare(&format!("SELECT component_id,operation,resource,coverage_scope,project_registration_id FROM (
        SELECT component_id,operation,resource,coverage_scope,project_registration_id FROM permission_approvals
        UNION SELECT component_id,operation,resource,coverage_scope,project_registration_id FROM permission_denials
        UNION SELECT component_id,operation,resource,coverage_scope,project_registration_id FROM recovered_permission_approvals)
        WHERE {filter} ORDER BY component_id,operation,resource,coverage_scope,project_registration_id LIMIT ?2"))?;
    let mut rows = q.query(params![id, limits.max_rows as i64 + 1])?;
    let mut result = Vec::new();
    loop {
        let row = rows.next()?;
        let Some(row) = row else {
            break;
        };
        if result.len() == limits.max_rows {
            return Err(RegistryError::LimitExceeded(
                "decision snapshot rows".into(),
            ));
        }
        let scope: String = row.get(3)?;
        let project: Option<i64> = row.get(4)?;
        let coverage = match (scope.as_str(), project) {
            ("application", None) => Coverage::Application,
            ("project", Some(p)) => Coverage::Project(ProjectId(p)),
            _ => return Err(corrupt("decision coverage")),
        };
        let key = DecisionKey {
            component: ComponentId(row.get(0)?),
            permission: NativePermission::parse(
                &row.get::<_, String>(1)?,
                &row.get::<_, String>(2)?,
            )?,
            coverage,
        };
        result.push(decision(c, &key)?);
    }
    Ok(result)
}
pub(super) fn package_decisions(
    c: &Connection,
    package: PackageId,
    limits: &RegistryLimits,
) -> Result<Vec<PermissionDecision>> {
    decisions_where(
        c,
        "component_id IN (SELECT id FROM components WHERE package_id=?1)",
        package.0,
        limits,
    )
}
pub(super) fn project_decisions(
    c: &Connection,
    project: ProjectId,
    limits: &RegistryLimits,
) -> Result<Vec<PermissionDecision>> {
    decisions_where(c, "project_registration_id=?1", project.0, limits)
}
