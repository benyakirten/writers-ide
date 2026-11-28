CREATE TEMP TABLE host_settings_v1_snapshot AS
SELECT singleton, permission_mode, repair_conflict_policy FROM host_settings;
DROP TABLE host_settings;
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
INSERT INTO host_settings(singleton, permission_mode, repair_conflict_policy)
SELECT singleton, permission_mode, repair_conflict_policy FROM temp.host_settings_v1_snapshot;
DROP TABLE temp.host_settings_v1_snapshot;
