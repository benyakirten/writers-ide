# Registry schema review

**Status: approved implementation baseline, implemented / unmerged.** This page explains schema version `2` of the internal host registry. Resource-settings Stage A is implemented internally / unmerged. The authoritative executable schema is [`schema.sql`](../../src-tauri/src/plugin_registry/schema.sql). The recognized `1 → 2` migration upgrades an internal unshipped baseline. Production application integration remains absent.

The registry records accepted plugin installations and user decisions. It does not store manuscript contents, plugin-owned data, the project file index or live native credentials. Package files remain in immutable directories outside SQLite. Selection, enablement, scope acknowledgement and native approval are separate facts. None alone authorizes activation.

## Sources and review boundary

Read the [registry foundation](registry-foundation.md) for responsibilities and policy. The [artifact guide](registry-artifacts.md) explains implemented installation transitions. The [implementation review](registry-implementation-review.md) describes the service and its integration limits.

The owner approved the [bounded final sign-off](registry-implementation-review.md#final-sign-off-proposal). Approval covers the internal database/integrity slice, not production publication, native location validation or external loading.

The SQL below mirrors the fresh schema. [`schema.rs`](../../src-tauri/src/plugin_registry/schema.rs) executes creation and seed insertion in one transaction. Ordinary opening validates existing storage and never recreates missing required rows. Application startup does not call the registry yet.

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

- Use `STRICT` tables for storage type enforcement. They require SQLite 3.37 or newer. The bundled SQLite build supplies the required features.
- Text identity uses SQLite's default `BINARY` collation. Do not trim, case-fold or normalize identifiers, versions or paths.
- `NOT NULL` accompanies non-integer primary keys. SQLite checks can otherwise pass on null results. Nullable fields have explicit shape checks where needed.
- All foreign keys use restrictive deletion and no cascading updates. Rust performs coherent cleanup explicitly in one transaction. Child-key indexes support parent checks and scoped cleanup; they are not performance claims.
- Checks constrain stored values. SQLite may losslessly coerce bound values even in `STRICT` tables. Rust must reject incorrectly typed external input before binding it.
- Installation and project-location revision counters start at `1`. The independent command resource revision starts at `0`. Rust rejects exhaustion before incrementing a signed 64-bit counter; a current-revision resource no-op still succeeds at the maximum.
- No SQL default issues approval or enables a component. Defaults below apply only when deliberately creating a fresh settings row.

Enable foreign keys on every connection before transactions. Journal and synchronization settings are approved operating requirements, not a complete opening or publication protocol:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
```

The worker must inspect the resulting settings. An in-memory review database cannot establish WAL or filesystem durability.

## Registry namespace and typed host settings

The required metadata row holds a random 16-byte logical namespace generated in trusted Rust with `getrandom`. A physical registry generation is not this namespace. Public project-ID string encoding and host integration remain open.

`schema_version = 2` identifies the current schema, still with 20 tables. [`schema_v1.sql`](../../src-tauri/src/plugin_registry/schema_v1.sql) retains the internal unshipped version-1 baseline byte-for-byte. Private compiled [`migration_v1_to_v2.sql`](../../src-tauri/src/plugin_registry/migration_v1_to_v2.sql) rebuilds `host_settings` to the exact current definition. Version-aware source, backup and target validators preserve identity, allocation high-water marks, permissions and unrelated data. Ordinary opening validates version 2. Version 1 requires explicit upgrade opening with a host-chosen non-overwriting backup destination. Unknown versions reject. See the [opening contract](registry-implementation-review.md#application-lifecycle-owner).

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
        CHECK (repair_conflict_policy IN ('keep-update', 'ask-before-replacing-update')),
    command_max_caller_pending INTEGER NOT NULL DEFAULT 32
        CHECK (command_max_caller_pending BETWEEN 1 AND 9007199254740991),
    command_max_provider_pending INTEGER NOT NULL DEFAULT 64
        CHECK (command_max_provider_pending BETWEEN 1 AND 9007199254740991),
    command_max_window_pending INTEGER NOT NULL DEFAULT 256
        CHECK (command_max_window_pending BETWEEN 1 AND 9007199254740991),
    command_max_payload_bytes INTEGER NOT NULL DEFAULT 8388608
        CHECK (command_max_payload_bytes BETWEEN 1 AND 9007199254740991),
    command_max_payload_depth INTEGER NOT NULL DEFAULT 64
        CHECK (command_max_payload_depth BETWEEN 1 AND 9007199254740991),
    command_max_payload_entries INTEGER NOT NULL DEFAULT 100000
        CHECK (command_max_payload_entries BETWEEN 1 AND 9007199254740991),
    command_max_component_bytes INTEGER NOT NULL DEFAULT 33554432
        CHECK (command_max_component_bytes BETWEEN 1 AND 9007199254740991),
    command_max_window_bytes INTEGER NOT NULL DEFAULT 134217728
        CHECK (command_max_window_bytes BETWEEN 1 AND 9007199254740991),
    command_resource_revision INTEGER NOT NULL DEFAULT 0
        CHECK (command_resource_revision >= 0)
) STRICT;
```

The two permission/repair settings and their fresh defaults are [approved](registry-foundation.md#approved-host-settings-storage). The SQL strings are the implemented encodings. `ask-before-replacing-update` means the approved **Ask before replacing the update** preference. It does not replace an update without confirmation. The repair policy is not the deferred restore-history conflict setting.

The singleton keys enforce **at most** one row. Rust must require exactly one row in each table before readiness. Fresh creation inserts both rows atomically. Ordinary opening preserves them and fails if either is missing or invalid. Restore forces Secure mode and separates recovered approvals before readiness. Namespace changes occur only at an approved recovery boundary, not ordinary startup.

The eight resource columns require positive JavaScript-safe integers. Their revision is a separate nonnegative SQLite integer, initially zero. Native `CommandResourceSettings` validation enforces the same bounds before SQL conversion. `CommandResourceRevision` uses canonical decimal-string serde. Reads and writes return a complete `CommandResourceSettingsSnapshot`; permission `HostSettings` still has only its original two fields. Resource edits therefore do not alter permission-review comparisons or permission cleanup. See the [implemented resource contract](resource-settings-plan.md#implemented-update-and-conflict-contract).

Restore accepts recognized version-1 and version-2 backups read-only. It upgrades only the owned target copy before history merge and permission quarantine. Version-2 saved limits/revision survive; version 1 receives defaults/revision zero. Secure mode is forced independently. Do not add generic key/value or JSON settings storage. Saved-settings loading, distribution, controls and the blocked-activation preference remain unimplemented. Stage B design is approved, but only Stage A implementation is authorized.

## Stable package, component and version identity

The local integer key types, generated canonical identity, full-version identity and listed columns are approved. The physical constraints below are implemented. Rust validates the complete manifest identifier grammar and canonical SemVer before insertion. Nonempty SQL checks are not grammar validation.

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

The key, retained name, binary path, separate binary directory identity, single location and revision roles are approved. The physical columns and constraints below are implemented. Encoding and scheme identifiers are intentionally not invented here.

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

There is no availability flag or preparation-pending row. Availability requires current host observation. Whether any availability information should be persisted is still unresolved. Project forgetting/deletion policy is not defined by these restrictive foreign keys.

## Accepted artifacts and immutable declarations

Artifact identity, listed file/component fields, retained package labels, per-artifact record version and derived location are approved. The layout tag and SQL are implemented.

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

The implemented layout tag is `writers-ide.artifact-store/1`, as in the artifact review. Rust derives a location from the supported layout and artifact ID under a host-owned root. Unknown tags must fail, not fall back. No absolute artifact path is stored.

### Same-package ownership and stable parent invariants

The ownership triggers below reject mismatched artifact/component associations. Parent identity triggers prevent reassignment. The update trigger also guards direct SQL changes, although the service never edits accepted declarations independently.

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

Ownership, staged-only representation and retained-reference responsibilities are approved. The implemented pointer-equality checks follow the [artifact review](registry-artifacts.md#implemented-installation-state-columns-and-valid-shapes).

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

The owner approved an installation revision that survives uninstall. The schema places `installation_revision` on the retained `packages` row, not the removable installation-state row. Revisions start at `1`. Every committed installation-state change advances it in the same transaction. Reads include it even when no installation row exists. Rust compares the reviewed revision before changing state and rejects a mismatch with `Conflict`, including changes away and back. Checked increments must not wrap; exhaustion rejects without mutation. Acceptance alone does not change installation state.

Rust calculates transitions from semantic actions and rechecks expected state in the committing transaction. It does not accept arbitrary pointer replacements. Approved selection-time approval cleanup and scope-state changes belong in that transaction. Failed package-fatal startup verification preserves pointers and stops the package without fallback. Unsupported component runtime profiles are not package-fatal failures: selection of an otherwise valid package can proceed while those components and their required dependents remain blocked. Compatible siblings remain eligible. A committed selection survives a crash before activation; no activation-success marker is added.

SQL cannot establish fresh-process eligibility, actual file health, runtime compatibility or retained runtime uses. A removed pointer never proves physical deletion is safe. Artifact cleanup explicitly deletes permission declarations, file rows and component declarations before the artifact, in one transaction. Restrictive references block overlooked children and retained installation pointers. This is database cleanup, not filesystem deletion.

## Permission decisions and recovered review data

Coverage shapes, separate approval/denial tables, source distinction, decision identity and partial uniqueness are approved. SQL names and encodings are implemented. Recovered review flags describe past records and never supply coverage.

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

At selection, remove current and recovered approvals for dropped effective requirements or removed components. Do not do this at staging. Uninstall, including cancellation of staged-only installation, removes current and recovered approvals but preserves denials and enablement. Restore places recovered approvals only in the review table, merging source facts for the same identity. Secure mode must never evaluate automatic approvals as effective coverage. Returning from Trust mode removes automatic coverage under the implemented policy. Database cleanup is implemented; live-authority coordination remains absent.

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

The scope table roles, acknowledgement columns and composite relationships are approved. Their assembled SQL and revision initialization remain baselines.

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

## Approved mechanics and remaining integration

The assembled 20-table schema, `STRICT` storage, restrictive foreign keys, required singleton rows, partial permission-coverage indexes and ownership/identity triggers are approved and implemented. Artifact IDs and namespaces are 16-byte BLOBs. Registry identity and installation revisions start at `1`. The independent command-resource revision starts at `0`. Revisions use checked signed-64-bit increments and reject exhaustion. Installation revision remains on the retained package row after uninstall.

Project columns store versioned binary fields, but supported native path/identity formats and alias matching remain open. `PreparedProject` and the closed-project prerequisite have only test constructors. Byte equality is not a production native identity check. Public project-ID string encoding and mapping remain open.

The settings row stores permission mode, repair-conflict policy, eight command-resource limits and their independent revision. Typed persistence and the real internal `1 → 2` migration are implemented in [Stage A](resource-settings-plan.md). Command/runtime integration still needs saved-settings loading, change distribution and a settings menu. Lifecycle/management integration must persist the blocked-activation preference, wire activation behavior and add its toggle. Both are Part 4 completion gates.

The private migration helper backs up before a reviewed static chain and rolls back failed transactional upgrades. Schema 2 is current. A real internal `1 → 2` migration preserves the unshipped baseline. Ordinary opening accepts version 2; recognized version 1 requires the explicit backup-requiring upgrade opener. Unknown schemas reject. Synthetic failure-chain tests supplement the real migration tests. Production startup remains unwired.

Production numerical defaults, checkpoint scheduling, backup retention, generation selector encoding, durable publication and crash-safe switching remain separate integration work. Tests inject explicit finite bounds. Startup cost and production capacity are not measured. Project forgetting, cross-registry import and interactive history-conflict recovery remain outside this slice.

## Validation scope

Checked-in [`schema_tests.rs`](../../src-tauri/src/plugin_registry/schema_tests.rs), store, worker and recovery tests replace ad hoc SQL probes as the implementation evidence. They exercise constraints, required rows/objects, domain corruption, transactions, reopen/WAL behavior and restore staging. See the [test map and Cargo commands](registry-implementation-review.md#source-tests-and-validation) and [cumulative validation record](change-log.md#native-registry-design).

Library and real-file SQLite tests do not prove filesystem generation publication, cross-platform durability or packaged Tauri authorization. Application integration remains unimplemented.
