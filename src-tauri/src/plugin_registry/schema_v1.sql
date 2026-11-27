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
