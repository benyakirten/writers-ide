# Registry schema review

**Status: proposal. Not approved. Not implemented.** This document assembles a possible SQLite schema for the host-owned plugin registry. It is not a migration or permission to implement one. Exact mechanical names, encodings, checks, indexes and trigger definitions below are proposals unless the linked decision explicitly approves them.

The registry records accepted plugin installations and user decisions. It does not store manuscript contents, plugin-owned data, the project file index or live native credentials. Package files remain in immutable directories outside SQLite. Selection, enablement, scope acknowledgement and native approval are separate facts. None alone authorizes activation.

## Sources and review boundary

Read the [registry foundation](registry-foundation.md) for approved responsibilities and policies. Read the [artifact review](registry-artifacts.md) for individual artifact and transition approvals. That review also contains unapproved recommendations. This assembly does not promote those recommendations to approved behavior.

The SQL is for a fresh, empty review database. Run the blocks in document order on one connection. A future trusted Rust initializer would execute schema creation and required seed inserts in one transaction. Ordinary opening must not run this script or recreate missing rows. No application code calls this SQL today.

This review covers these table families:

| Family                                                 | Tables                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Registry identity and configuration                    | `registry_metadata`, `host_settings`                                                   |
| Stable identities and retained releases                | `packages`, `components`, `package_version_history`                                    |
| Accepted immutable copies                              | `accepted_artifacts`, `artifact_files`, `artifact_components`                          |
| Installation selection                                 | `package_installation_state`                                                           |
| Registered project locations                           | `project_registrations`                                                                |
| Recognized native operations and accepted requirements | `native_permissions`, `artifact_package_permissions`, `artifact_component_permissions` |
| Current and recovered permission decisions             | `permission_approvals`, `permission_denials`, `recovered_permission_approvals`         |
| Saved enablement                                       | `component_enablement_defaults`, `project_component_overrides`                         |
| Scope review                                           | `component_scope_state`, `component_scope_acknowledgements`                            |

There are no persistent management-plan, activation, ticket, token, live-opening or runtime-health tables. Management plans and authority belong in memory. Backup publication and Rust contracts are separate reviews. Physical generation selection belongs outside this database, in the approved host-owned generation layout.

## SQL conventions

- Use `STRICT` tables as a proposed physical choice. They require SQLite 3.37 or newer. The eventual pinned bundled build must support every feature used here.
- Text identity uses SQLite's default `BINARY` collation. Do not trim, case-fold or normalize identifiers, versions or paths.
- `NOT NULL` accompanies non-integer primary keys. SQLite checks can otherwise pass on null results. Nullable fields have explicit shape checks where needed.
- All foreign keys use restrictive deletion and no cascading updates. Rust performs coherent cleanup explicitly in one transaction. Child-key indexes support parent checks and scoped cleanup; they are not performance claims.
- Checks constrain stored values. SQLite may losslessly coerce bound values even in `STRICT` tables. Rust must reject incorrectly typed external input before binding it.
- Positive revision counters start at `1` in this proposal. This initialization is not yet approved. Rust must reject exhaustion before incrementing a signed 64-bit counter.
- No SQL default issues approval or enables a component. Defaults below apply only when deliberately creating a fresh settings row.

Enable foreign keys on every connection before transactions. Journal and synchronization settings are approved operating requirements, not a complete opening or publication protocol:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
```

The worker must inspect the resulting settings. An in-memory review database cannot establish WAL or filesystem durability.

## Registry namespace and typed host settings

A persistent logical namespace is approved. Its physical representation is open. **Proposal:** one required metadata row holds a random 16-byte namespace generated by trusted Rust. The generation policy and public project-ID encoding still need review. A physical registry generation is not this namespace.

`schema_version` is proposed migration metadata. `1` labels this draft schema only; it is not a shipped schema version. An existing database must be identified and checked before any attempted migration. Do not stamp an unknown database as version 1.

```sql
CREATE TABLE registry_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL CHECK (schema_version > 0),
    identity_namespace BLOB NOT NULL
        CHECK (typeof(identity_namespace) = 'blob'
               AND length(identity_namespace) = 16)
) STRICT;

CREATE TABLE host_settings (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    permission_mode TEXT NOT NULL DEFAULT 'secure'
        CHECK (permission_mode IN ('secure', 'trust')),
    repair_conflict_policy TEXT NOT NULL DEFAULT 'keep-update'
        CHECK (repair_conflict_policy IN ('keep-update', 'ask-before-replacing-update'))
) STRICT;
```

The two logical settings and their fresh defaults are [approved](registry-foundation.md#approved-host-settings-storage). The SQL strings are proposed encodings. `ask-before-replacing-update` means the approved **Ask before replacing the update** preference. It does not replace an update without confirmation. The repair policy is not the deferred restore-history conflict setting.

The singleton keys enforce **at most** one row. Rust must require exactly one row in each table before readiness. Fresh creation inserts both rows atomically. Ordinary opening preserves them and fails if either is missing or invalid. Restore forces Secure mode and separates recovered approvals before readiness. Namespace changes occur only at an approved recovery boundary, not ordinary startup.

Do not add a generic key/value or JSON settings column. The owner approved keeping the additional settings out of this foundation. Add them through typed migrations in their corresponding Part 4 integration slices, with persistence and controls required before those slices and Part 4 are complete. This two-field table does not implicitly implement every host preference.

## Stable package, component and version identity

The local integer key types, generated canonical identity, full-version identity and listed columns are approved. The assembled physical constraints remain proposed. Rust validates the complete manifest identifier grammar and canonical SemVer before insertion. Nonempty SQL checks are not grammar validation.

```sql
CREATE TABLE packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    namespace TEXT CHECK (namespace IS NULL OR length(namespace) > 0),
    name TEXT NOT NULL CHECK (length(name) > 0),
    installation_revision INTEGER NOT NULL DEFAULT 1
        CHECK (installation_revision > 0),
    canonical_id TEXT GENERATED ALWAYS AS (
        CASE WHEN namespace IS NULL THEN name
             ELSE '@' || namespace || '/' || name END
    ) VIRTUAL,
    UNIQUE (canonical_id)
) STRICT;

CREATE TABLE components (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
    local_id TEXT NOT NULL CHECK (length(local_id) > 0),
    UNIQUE (package_id, local_id),
    UNIQUE (package_id, id)
) STRICT;

CREATE TABLE package_version_history (
    package_id INTEGER NOT NULL REFERENCES packages(id) ON DELETE RESTRICT,
    version TEXT NOT NULL CHECK (length(version) > 0),
    fingerprint_scheme TEXT NOT NULL CHECK (length(fingerprint_scheme) > 0),
    fingerprint BLOB NOT NULL
        CHECK (typeof(fingerprint) = 'blob' AND length(fingerprint) = 32),
    PRIMARY KEY (package_id, version)
) STRICT;
```

Do not use SQL text ordering for SemVer precedence. Build metadata is part of release identity even when dependency matching ignores it. History is inserted only with successful acceptance. A duplicate package/version requires comparison using the stored recognized fingerprint scheme. A different digest is a version conflict, not an upsert. Unknown schemes cannot silently mean `writers-ide.file-set/1`.

History survives uninstall and artifact cleanup. Rust must not offer ordinary history deletion or identity reassignment. Restoration combines validated history by canonical package/version, not local numeric IDs. Preserve validated `sqlite_sequence` high-water marks for all three `AUTOINCREMENT` tables, including deleted IDs. This is restoration logic, not another application allocation table. No trigger or primary key alone preserves unknown post-backup allocations.

## Complete project registrations

The key, retained name, binary path, separate binary directory identity, single location and revision roles are approved. Physical column names and nonempty constraints below are proposed. Encoding and scheme identifiers are intentionally not invented here.

```sql
CREATE TABLE project_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    path_encoding TEXT NOT NULL CHECK (length(path_encoding) > 0),
    path_bytes BLOB NOT NULL
        CHECK (typeof(path_bytes) = 'blob' AND length(path_bytes) > 0),
    directory_identity_scheme TEXT NOT NULL
        CHECK (length(directory_identity_scheme) > 0),
    directory_identity_bytes BLOB NOT NULL
        CHECK (typeof(directory_identity_bytes) = 'blob'
               AND length(directory_identity_bytes) > 0),
    location_revision INTEGER NOT NULL CHECK (location_revision > 0)
) STRICT;
```

Insert only a complete prepared registration after trusted location validation. The initial library does not perform that filesystem validation. A complete-looking SQL row is not proof that it happened. Keep unavailable registrations and their decisions. Refresh the cached name only from a validated opening; it is not a permission key.

There is deliberately no unique path or directory-identity index. Raw byte equality is not approved as native location equivalence. Rust must reject an already-owned destination using supported native identity and alias handling. On reviewed relink, recheck that the project is closed in every window, compare the expected revision, validate the destination and increment the revision atomically with the new location. Reopening alone does not increment it. Exact encoding formats and safe platform matching remain open.

No availability flag or preparation-pending row is proposed. Availability requires current host observation. Whether any availability information should be persisted is still unresolved. Project forgetting/deletion policy is not defined by these restrictive foreign keys.

## Accepted artifacts and immutable declarations

Artifact identity, listed file/component fields, retained package labels, per-artifact record version and derived location are approved. The exact layout tag and remaining SQL are proposed.

```sql
CREATE TABLE accepted_artifacts (
    id BLOB NOT NULL PRIMARY KEY
        CHECK (typeof(id) = 'blob' AND length(id) = 16),
    package_id INTEGER NOT NULL,
    version TEXT NOT NULL CHECK (length(version) > 0),
    integrity_record_version INTEGER NOT NULL CHECK (integrity_record_version > 0),
    storage_layout TEXT NOT NULL CHECK (length(storage_layout) > 0),
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    description TEXT NOT NULL CHECK (length(description) > 0),
    UNIQUE (package_id, id),
    FOREIGN KEY (package_id, version)
        REFERENCES package_version_history(package_id, version) ON DELETE RESTRICT
) STRICT;

CREATE TABLE artifact_files (
    artifact_id BLOB NOT NULL REFERENCES accepted_artifacts(id) ON DELETE RESTRICT,
    path TEXT NOT NULL CHECK (length(path) > 0),
    byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
    sha256 BLOB NOT NULL
        CHECK (typeof(sha256) = 'blob' AND length(sha256) = 32),
    PRIMARY KEY (artifact_id, path)
) STRICT;

CREATE TABLE artifact_components (
    artifact_id BLOB NOT NULL REFERENCES accepted_artifacts(id) ON DELETE RESTRICT,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
    display_name TEXT NOT NULL CHECK (length(display_name) > 0),
    description TEXT NOT NULL CHECK (length(description) > 0),
    kind TEXT NOT NULL CHECK (kind = 'frontend'),
    activation_scope TEXT NOT NULL CHECK (activation_scope IN ('project', 'application')),
    default_enabled INTEGER NOT NULL CHECK (default_enabled IN (0, 1)),
    PRIMARY KEY (artifact_id, component_id)
) STRICT;

CREATE INDEX accepted_artifacts_release
    ON accepted_artifacts(package_id, version);
CREATE INDEX artifact_components_component
    ON artifact_components(component_id);

CREATE TABLE native_permissions (
    operation TEXT NOT NULL CHECK (length(operation) > 0),
    resource TEXT NOT NULL CHECK (length(resource) > 0),
    PRIMARY KEY (operation, resource)
) STRICT;

CREATE TABLE artifact_package_permissions (
    artifact_id BLOB NOT NULL REFERENCES accepted_artifacts(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL,
    resource TEXT NOT NULL,
    PRIMARY KEY (artifact_id, operation, resource),
    FOREIGN KEY (operation, resource)
        REFERENCES native_permissions(operation, resource) ON DELETE RESTRICT
) STRICT;

CREATE TABLE artifact_component_permissions (
    artifact_id BLOB NOT NULL,
    component_id INTEGER NOT NULL,
    operation TEXT NOT NULL,
    resource TEXT NOT NULL,
    PRIMARY KEY (artifact_id, component_id, operation, resource),
    FOREIGN KEY (artifact_id, component_id)
        REFERENCES artifact_components(artifact_id, component_id) ON DELETE RESTRICT,
    FOREIGN KEY (operation, resource)
        REFERENCES native_permissions(operation, resource) ON DELETE RESTRICT
) STRICT;

CREATE INDEX artifact_package_permissions_permission
    ON artifact_package_permissions(operation, resource);
CREATE INDEX artifact_component_permissions_permission
    ON artifact_component_permissions(operation, resource);

INSERT INTO native_permissions(operation, resource) VALUES
    ('project.files.list', 'project'),
    ('project.files.read', 'project'),
    ('external.open', 'http-https');
```

Catalog maintenance is host-owned initialization/migration work. Do not insert manifest-supplied permissions into it. Rust must independently recognize and implement each pair. Catalog membership is not authority.

Rust derives file rows, fingerprint and declarations from the same verified package snapshot. Acceptance requires a matching trusted publication receipt and one atomic insert transaction. Reconstruct integrity records through bounded reads and the database-independent integrity validator. Validate paths, exact digests, supported format/layout identifiers, counts, byte budgets and declaration binding. Recompute and compare the approved file-set fingerprint. SQL cannot prove that a complete set matches `manifest.toml` or that files were durably published.

Effective requirements are the deduplicated union of package and component requirements. Keys reject duplicates within each level and allow overlap between levels. Rust also rejects project-file requirements on application-scoped components, including inherited package requirements. This scope rule is not encoded by catalog membership or the foreign keys.

The proposed initial layout tag is `writers-ide.artifact-store/1`, as in the artifact review. Rust derives a location from the supported layout and artifact ID under a host-owned root. Unknown tags must fail, not fall back. No absolute artifact path is stored.

### Same-package ownership and stable parent invariants

The child ownership trigger is approved in principle. These concrete definitions are proposals. The update trigger is included even though normal service operations do not update accepted declarations. Restricting only child changes would leave a hole if a parent could change its package.

```sql
CREATE TRIGGER artifact_components_owner_insert
BEFORE INSERT ON artifact_components
WHEN EXISTS (
    SELECT 1 FROM accepted_artifacts a, components c
    WHERE a.id = NEW.artifact_id AND c.id = NEW.component_id
      AND a.package_id <> c.package_id
)
BEGIN
    SELECT RAISE(ABORT, 'artifact/component package mismatch');
END;

CREATE TRIGGER artifact_components_owner_update
BEFORE UPDATE OF artifact_id, component_id ON artifact_components
WHEN EXISTS (
    SELECT 1 FROM accepted_artifacts a, components c
    WHERE a.id = NEW.artifact_id AND c.id = NEW.component_id
      AND a.package_id <> c.package_id
)
BEGIN
    SELECT RAISE(ABORT, 'artifact/component package mismatch');
END;

CREATE TRIGGER packages_identity_immutable
BEFORE UPDATE OF id, namespace, name ON packages
WHEN NEW.id IS NOT OLD.id OR NEW.namespace IS NOT OLD.namespace
     OR NEW.name IS NOT OLD.name
BEGIN
    SELECT RAISE(ABORT, 'package identity is immutable');
END;

CREATE TRIGGER components_identity_immutable
BEFORE UPDATE OF id, package_id, local_id ON components
WHEN NEW.id IS NOT OLD.id OR NEW.package_id IS NOT OLD.package_id
     OR NEW.local_id IS NOT OLD.local_id
BEGIN
    SELECT RAISE(ABORT, 'component identity is immutable');
END;

CREATE TRIGGER accepted_artifacts_immutable
BEFORE UPDATE ON accepted_artifacts
BEGIN
    SELECT RAISE(ABORT, 'accepted artifact is immutable');
END;

CREATE TRIGGER package_version_history_immutable
BEFORE UPDATE ON package_version_history
BEGIN
    SELECT RAISE(ABORT, 'accepted version history is immutable');
END;
```

Missing parents fail foreign keys even when the ownership trigger finds no pair. The stable component composite unique key also supports scope-acknowledgement ownership below.

These triggers do not claim complete SQL-level immutability. Rust exposes no independent file/declaration edit or append operation after acceptance. It inserts complete sets and deletes complete sets during explicit cleanup. Row triggers cannot distinguish a legitimate acceptance insert from a later append without adding a new lifecycle model. No such model is approved here. External database writers can also remove triggers; this is not a security boundary against them. Startup domain validation remains required.

## Package installation state

Ownership, staged-only representation and retained-reference responsibilities are approved. The additional pointer-equality checks assemble recommendations from the [artifact review](registry-artifacts.md#proposed-installation-state-columns-and-valid-shapes); they remain proposed.

```sql
CREATE TABLE package_installation_state (
    package_id INTEGER PRIMARY KEY REFERENCES packages(id) ON DELETE RESTRICT,
    selected_artifact_id BLOB,
    staged_artifact_id BLOB,
    previous_artifact_id BLOB,
    pending_repair_artifact_id BLOB,
    FOREIGN KEY (package_id, selected_artifact_id)
        REFERENCES accepted_artifacts(package_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (package_id, staged_artifact_id)
        REFERENCES accepted_artifacts(package_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (package_id, previous_artifact_id)
        REFERENCES accepted_artifacts(package_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (package_id, pending_repair_artifact_id)
        REFERENCES accepted_artifacts(package_id, id) ON DELETE RESTRICT,
    CHECK (selected_artifact_id IS NOT NULL OR
           (staged_artifact_id IS NOT NULL AND previous_artifact_id IS NULL
            AND pending_repair_artifact_id IS NULL)),
    CHECK (selected_artifact_id IS NULL OR staged_artifact_id IS NULL
           OR staged_artifact_id <> selected_artifact_id),
    CHECK (selected_artifact_id IS NULL OR previous_artifact_id IS NULL
           OR previous_artifact_id <> selected_artifact_id),
    CHECK (pending_repair_artifact_id IS NULL OR
           (selected_artifact_id IS NOT NULL AND staged_artifact_id IS NOT NULL
            AND pending_repair_artifact_id <> selected_artifact_id
            AND pending_repair_artifact_id <> staged_artifact_id
            AND (previous_artifact_id IS NULL
                 OR pending_repair_artifact_id <> previous_artifact_id)))
) STRICT;

CREATE INDEX installation_selected ON package_installation_state(selected_artifact_id);
CREATE INDEX installation_staged ON package_installation_state(staged_artifact_id);
CREATE INDEX installation_previous ON package_installation_state(previous_artifact_id);
CREATE INDEX installation_repair ON package_installation_state(pending_repair_artifact_id);
```

A non-null pointer must match an existing 16-byte artifact key through its composite foreign key. Null pointers do not create an ownership relationship. No row means uninstalled; an all-null row is invalid. Staged may equal previous for explicit restoration, so there is no all-pointers-distinct check.

Rust validates version relationships. A pending repair matches selected's complete release and fingerprint; its staged target has a different complete version. A same-version staged repair uses a fresh accepted artifact and preserves previous on promotion. These cross-row rules are not enforced by the row checks.

The owner approved an installation revision that survives uninstall. This draft places `installation_revision` on the retained `packages` row, not the removable installation-state row. Starting at `1` is a proposed mechanical choice. Every committed installation-state change advances it in the same transaction. Reads include it even when no installation row exists. Rust compares the reviewed revision before changing state and rejects a mismatch with `Conflict`, including changes away and back. Checked increments must not wrap; exhaustion rejects without mutation. Acceptance alone does not change installation state.

Rust calculates transitions from semantic actions and rechecks expected state in the committing transaction. It does not accept arbitrary pointer replacements. Approved selection-time approval cleanup and scope-state changes belong in that transaction. Failed startup verification preserves pointers and stops the package without fallback. A committed selection survives a crash before activation; no activation-success marker is added.

SQL cannot establish fresh-process eligibility, actual file health, runtime compatibility or retained runtime uses. A removed pointer never proves physical deletion is safe. Artifact cleanup explicitly deletes permission declarations, file rows and component declarations before the artifact, in one transaction. Restrictive references block overlooked children and retained installation pointers. This is database cleanup, not filesystem deletion.

## Permission decisions and recovered review data

Coverage shapes, separate approval/denial tables, source distinction, decision identity and partial uniqueness are approved. The exact SQL names and encodings are proposed. Recovered review flags describe past records and never supply coverage.

```sql
CREATE TABLE permission_approvals (
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL,
    resource TEXT NOT NULL,
    coverage_scope TEXT NOT NULL CHECK (coverage_scope IN ('application', 'project')),
    project_registration_id INTEGER REFERENCES project_registrations(id) ON DELETE RESTRICT,
    source TEXT NOT NULL CHECK (source IN ('explicit', 'automatic')),
    CHECK ((coverage_scope = 'application' AND project_registration_id IS NULL)
        OR (coverage_scope = 'project' AND project_registration_id IS NOT NULL)),
    FOREIGN KEY (operation, resource)
        REFERENCES native_permissions(operation, resource) ON DELETE RESTRICT
) STRICT;

CREATE TABLE permission_denials (
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL,
    resource TEXT NOT NULL,
    coverage_scope TEXT NOT NULL CHECK (coverage_scope IN ('application', 'project')),
    project_registration_id INTEGER REFERENCES project_registrations(id) ON DELETE RESTRICT,
    CHECK ((coverage_scope = 'application' AND project_registration_id IS NULL)
        OR (coverage_scope = 'project' AND project_registration_id IS NOT NULL)),
    FOREIGN KEY (operation, resource)
        REFERENCES native_permissions(operation, resource) ON DELETE RESTRICT
) STRICT;

CREATE TABLE recovered_permission_approvals (
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
    operation TEXT NOT NULL,
    resource TEXT NOT NULL,
    coverage_scope TEXT NOT NULL CHECK (coverage_scope IN ('application', 'project')),
    project_registration_id INTEGER REFERENCES project_registrations(id) ON DELETE RESTRICT,
    had_explicit_approval INTEGER NOT NULL CHECK (had_explicit_approval IN (0, 1)),
    had_automatic_approval INTEGER NOT NULL CHECK (had_automatic_approval IN (0, 1)),
    CHECK (had_explicit_approval = 1 OR had_automatic_approval = 1),
    CHECK ((coverage_scope = 'application' AND project_registration_id IS NULL)
        OR (coverage_scope = 'project' AND project_registration_id IS NOT NULL)),
    FOREIGN KEY (operation, resource)
        REFERENCES native_permissions(operation, resource) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX approvals_application
    ON permission_approvals(component_id, operation, resource)
    WHERE coverage_scope = 'application';
CREATE UNIQUE INDEX approvals_project
    ON permission_approvals(component_id, operation, resource, project_registration_id)
    WHERE coverage_scope = 'project';
CREATE UNIQUE INDEX denials_application
    ON permission_denials(component_id, operation, resource)
    WHERE coverage_scope = 'application';
CREATE UNIQUE INDEX denials_project
    ON permission_denials(component_id, operation, resource, project_registration_id)
    WHERE coverage_scope = 'project';
CREATE UNIQUE INDEX recovered_approvals_application
    ON recovered_permission_approvals(component_id, operation, resource)
    WHERE coverage_scope = 'application';
CREATE UNIQUE INDEX recovered_approvals_project
    ON recovered_permission_approvals(component_id, operation, resource, project_registration_id)
    WHERE coverage_scope = 'project';

CREATE INDEX approvals_component ON permission_approvals(component_id);
CREATE INDEX denials_component ON permission_denials(component_id);
CREATE INDEX recovered_approvals_component ON recovered_permission_approvals(component_id);
CREATE INDEX approvals_permission ON permission_approvals(operation, resource);
CREATE INDEX denials_permission ON permission_denials(operation, resource);
CREATE INDEX recovered_approvals_permission ON recovered_permission_approvals(operation, resource);
CREATE INDEX approvals_project_reference ON permission_approvals(project_registration_id);
CREATE INDEX denials_project_reference ON permission_denials(project_registration_id);
CREATE INDEX recovered_approvals_project_reference
    ON recovered_permission_approvals(project_registration_id);
```

No persistent decision ID is added. Internal row IDs are not service identities. A matching approval and denial may coexist. Rust evaluates applicable denials before granting coverage. A project denial can block an application-wide approval for that project; clearing one scope does not clear another. Requirements and catalog membership do not create consent.

Rust validates applicable component scope and project association. Retained decisions must not be rejected merely because a component is currently absent or an old project override is inactive. Explicit approval can promote an automatic row at the same identity after durable save. Automatic processing must never downgrade explicit consent. SQL uniqueness alone does not enforce that transition.

At selection, remove current and recovered approvals for dropped effective requirements or removed components. Do not do this at staging. Uninstall, including cancellation of staged-only installation, removes current and recovered approvals but preserves denials and enablement. Restore places recovered approvals only in the review table, merging source facts for the same identity. Secure mode must never evaluate automatic approvals as effective coverage. Returning from Trust mode must remove automatic coverage under approved policy; exact row cleanup and live-authority coordination need the Rust transaction review.

Do not join recovered review data into an effective-access query. Explicit review consumes only the matching recovered candidate, atomically with saving the current decision. Match component, operation/resource, coverage scope and project registration when project-specific. Failed saves preserve the candidate. Automatic Trust-mode processing alone preserves candidates. Rust owns this transaction; inserting an approval through SQL does not prove that explicit review occurred. No trigger infers review or clears denials.

## Saved enablement and scope review

Enablement belongs to stable identities. It does not reference an artifact because choices survive uninstall and removed components. Absence of a project override means Inherit. Absence of an application-level choice means not yet configured, not an instruction to follow each new manifest default.

```sql
CREATE TABLE component_enablement_defaults (
    component_id INTEGER PRIMARY KEY REFERENCES components(id) ON DELETE RESTRICT,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
) STRICT;

CREATE TABLE project_component_overrides (
    project_registration_id INTEGER NOT NULL
        REFERENCES project_registrations(id) ON DELETE RESTRICT,
    component_id INTEGER NOT NULL REFERENCES components(id) ON DELETE RESTRICT,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    PRIMARY KEY (project_registration_id, component_id)
) STRICT;

CREATE INDEX project_overrides_component ON project_component_overrides(component_id);

CREATE TABLE component_scope_state (
    component_id INTEGER PRIMARY KEY REFERENCES components(id) ON DELETE RESTRICT,
    last_reviewed_scope TEXT NOT NULL
        CHECK (last_reviewed_scope IN ('project', 'application')),
    scope_revision INTEGER NOT NULL CHECK (scope_revision > 0)
) STRICT;

CREATE TABLE component_scope_acknowledgements (
    component_id INTEGER PRIMARY KEY,
    package_id INTEGER NOT NULL,
    target_version TEXT NOT NULL CHECK (length(target_version) > 0),
    review_kind TEXT NOT NULL CHECK (review_kind IN ('initial', 'scope-change')),
    previous_scope TEXT CHECK (previous_scope IN ('project', 'application')),
    expected_scope_revision INTEGER,
    target_scope TEXT NOT NULL CHECK (target_scope IN ('project', 'application')),
    CHECK ((review_kind = 'initial' AND previous_scope IS NULL
            AND expected_scope_revision IS NULL)
        OR (review_kind = 'scope-change' AND previous_scope IS NOT NULL
            AND expected_scope_revision IS NOT NULL AND expected_scope_revision > 0
            AND previous_scope <> target_scope)),
    FOREIGN KEY (package_id, component_id)
        REFERENCES components(package_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (package_id, target_version)
        REFERENCES package_version_history(package_id, version) ON DELETE RESTRICT
) STRICT;

CREATE INDEX scope_acknowledgements_component_owner
    ON component_scope_acknowledgements(package_id, component_id);
CREATE INDEX scope_acknowledgements_release
    ON component_scope_acknowledgements(package_id, target_version);
```

The scope table roles, acknowledgement columns and composite relationships are approved. Their assembled SQL and revision initialization remain proposals.

Rust checks the applicable accepted declaration before changing project overrides. Preserve stored overrides but leave them inactive when the component is application-scoped. Manifest defaults apply under first-configuration policy only. Updates must not silently enable newly introduced components.

A baseline row exists only after scope acknowledgement and selection of its matching release. A missing baseline blocks activation until initial acknowledgement. A pending acknowledgement records a review already completed for an unapplied target. It is not the outstanding-review blocker itself.

**Approved derivation:** for an installed component, determine the scope-review blocker from the selected artifact's declaration and retained reviewed baseline. No baseline means initial review is needed. A different selected scope requires change review; a matching scope has no scope-review blocker. Do not add a separate mutable blocked flag. A return to the reviewed scope clears only this blocker. Applicable acknowledgement updates the baseline atomically. Pending acknowledgements are completed reviews awaiting their target selection, not blocker flags. The assembled SQL still requires final sign-off.

For an initial acknowledgement, Rust verifies baseline absence. For a change, it verifies both scope and revision. It also checks the exact target release, actual component declaration, reviewed installation action and target scope. History existence alone is insufficient. A different target release invalidates the pending acknowledgement; matching-content repair of the same release can retain it. Apply and remove the pending row in the same transaction as baseline advancement once the matching release is selected. Selection alone and successful activation are not substitutes for review. Uninstall preserves the baseline and removes pending acknowledgements.

## Validation responsibilities that remain in Rust

The SQL protects row shape and references. Trusted Rust domain operations must also provide:

1. Strict input parsing, manifest grammar, canonical SemVer, UTF-8 byte limits and supported format recognition. SQL nonempty checks do not establish plain-text safety or reject embedded null characters.
2. Bounded integrity reconstruction, the approved binary fingerprint algorithm and binding of complete accepted declarations to exact verified manifest bytes. Never accept independent caller-supplied hashes and declarations as a trusted bundle.
3. Semantic installation transitions, expected-state comparison and atomic acceptance/selection/cleanup. Partial sets must not escape a failed transaction.
4. Native location preparation, encoding/identity interpretation, ownership conflict checks and stale relink rejection. The first library depends on trusted prepared inputs rather than claiming filesystem enforcement.
5. Effective requirement unions, coverage and denial precedence, non-downgrading approval promotion, scope review and first-configuration enablement rules.
6. Restore validation, history conflict rejection, key remapping, allocation-counter preservation, namespace boundaries and inactive recovered approvals. Foreign keys cannot reconcile two databases.
7. Required singleton and catalog validation, full `integrity_check`, `foreign_key_check` and application-specific cross-row checks before readiness. Validate schema version and required schema objects, not just row contents. Do not repair unsafe state by silently inserting defaults.
8. Dedicated bounded worker operation, consistent read transactions and completed-commit reporting. The approved worker, lifecycle and error categories remain in the foundation guide; this document does not choose contract signatures.

Permissions also require synchronization with private live authorization state. Restrictions may take effect before persistence; expansions require durable approval. No SQL trigger can revoke a native credential or make an unsafe authorization cache coherent. Filesystem publication, process-wide import tracking, safe resource delivery and physical cleanup remain integration boundaries, not features of this schema.

## Behavioral gaps and decisions still needed

The remaining work falls into three groups. Owner questions concern behavior or scope, not every physical schema choice. All SQL remains a draft pending final review. Nothing in this section supplies approval.

### Resolved focused behavioral questions

All four focused questions in the consolidated review are resolved. The owner approved implementing the additional preferences in their feature-integration slices, not this foundation. The [blocked-activation preference](context.md#package-loading-updates-and-defaults) requires persistence, activation wiring and a management toggle during plugin lifecycle/management integration. [Command resource settings](command-contract.md#user-settings-and-changes) require typed persistence, dispatcher loading, distribution and the settings menu during command/runtime integration. Both are Part 4 completion requirements. This does not approve the remaining draft SQL or claim these settings already exist.

Some installation shape and transition recommendations also remain unapproved in the artifact review. Reconcile the proposed pointer checks and cross-row version rules with the individual decisions before final sign-off. Ask about any actual behavioral mismatch; do not reopen already approved transitions or turn every SQL predicate into a new A/B question.

### Draft mechanical choices for final review

The singleton metadata row, random 128-bit namespace, namespace encoding, and public-ID encoding are draft mechanical choices within the approved identity boundary. Likewise, starting location, scope and installation revisions at `1` and using checked signed-64-bit increments are proposed mechanics for the approved stale-review rules. Counters must not wrap. These choices belong in the assembled review, not a separate owner A/B question for each detail.

Review `STRICT`, foreign-key actions, singleton keys, exact enum strings, trigger behavior and index coverage together for consistency. Routine plumbing that preserves approved behavior does not need an unbounded sequence of owner questions. Escalate a mechanical choice only if it changes identity, authority, retention or another approved contract. Final review does not make this draft SQL approved or implemented.

Project forgetting can remain outside this slice. Its omission does not require a decision now. Restrictive foreign keys do not introduce a deletion workflow.

### Deferred integration and limits

Native project path and directory-identity formats still need supported encodings and platform matching rules before registration integration. Nonempty BLOBs do not establish valid identity. Unknown schemes cannot recover grants, and byte-based uniqueness must not substitute for native location matching.

Production budget defaults are already deferred. Future implementation tests may inject small limits to exercise bounded work and failure paths. Such test limits are not production defaults. The SQL probe establishes no production capacity or startup timing. Startup-validation reporting bounds remain worker/integration work.

Migration tracking, backup retention, active-generation publication and crash-safe switching remain separate work. This document supplies no publication protocol and no new Rust API.

## Validation scope

Review validation should execute every SQL block in order in a disposable SQLite database with foreign keys enabled. Exercise valid relationships and rejection paths, including nullable coverage uniqueness, cross-package references, parent reassignment, staged-only shapes, acknowledgement null checks and restrictive artifact deletion. Check local Markdown links and formatting too.

Validation of the initial assembly, before adding the installation revision, used an in-memory SQLite **3.54.1** database. All **9 SQL blocks** executed in document order. All **76 valid-state and rejection probes** passed. `foreign_key_check` returned no violations, and `integrity_check` returned `ok`. Six local links and heading anchors passed checks. Oxfmt and whitespace checks also passed. These were ad hoc review checks; this document does not include or claim a checked-in reproducible probe script.

After adding the installation revision, all nine SQL blocks executed again. Focused probes checked its initial value, invalid stored values, conditional stale-update rejection and retention without an installation-state row. Integrity and foreign-key checks passed. This checks draft SQL, not the unimplemented Rust transition or uninstall methods.

Passing those checks demonstrates only that this draft SQL executes and the exercised constraints behave as described. It does not validate Rust behavior, accepted-content completeness, filesystem safety, WAL durability, restoration publication or packaged-app authorization. There is no registry implementation to test in this change.
