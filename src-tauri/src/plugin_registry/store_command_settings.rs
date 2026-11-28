use super::*;

impl Store {
    pub(crate) fn read_command_resource_settings(
        &mut self,
    ) -> Result<CommandResourceSettingsSnapshot> {
        self.ensure_available()?;
        let result = (|| {
            let tx = self.connection.transaction()?;
            let snapshot = read(&tx)?;
            tx.commit()?;
            Ok(snapshot)
        })();
        self.record_live_result(result)
    }

    pub(crate) fn set_command_resource_settings(
        &mut self,
        expected_revision: CommandResourceRevision,
        settings: CommandResourceSettings,
    ) -> Result<CommandResourceSettingsSnapshot> {
        self.ensure_available()?;
        // Validate before any unsigned-to-SQL conversion, including rejected edits.
        settings.validate()?;
        self.mutate(|tx, _| {
            let current = read(tx)?;
            if current.revision != expected_revision {
                return Err(RegistryError::Conflict(
                    "command resource settings changed".into(),
                ));
            }
            if current.settings == settings {
                return Ok(current);
            }
            let revision = current.revision.next()?;
            let changed = tx.execute(
                "UPDATE host_settings SET command_max_caller_pending=?1,
                 command_max_provider_pending=?2,command_max_window_pending=?3,
                 command_max_payload_bytes=?4,command_max_payload_depth=?5,
                 command_max_payload_entries=?6,command_max_component_bytes=?7,
                 command_max_window_bytes=?8,command_resource_revision=?9 WHERE singleton=1",
                params![
                    settings.max_caller_pending as i64,
                    settings.max_provider_pending as i64,
                    settings.max_window_pending as i64,
                    settings.max_payload_bytes as i64,
                    settings.max_payload_depth as i64,
                    settings.max_payload_entries as i64,
                    settings.max_component_bytes as i64,
                    settings.max_window_bytes as i64,
                    revision.value(),
                ],
            )?;
            if changed != 1 {
                return Err(corrupt("missing command resource settings"));
            }
            Ok(CommandResourceSettingsSnapshot { revision, settings })
        })
    }
}

fn read(connection: &Connection) -> Result<CommandResourceSettingsSnapshot> {
    use rusqlite::types::ValueRef;

    // Inspect borrowed values without copying malformed text or blob buffers.
    let integers: Option<Result<[i64; 9]>> = connection
        .query_row(
            "SELECT command_max_caller_pending,command_max_provider_pending,
         command_max_window_pending,command_max_payload_bytes,command_max_payload_depth,
         command_max_payload_entries,command_max_component_bytes,command_max_window_bytes,
         command_resource_revision FROM host_settings WHERE singleton=1",
            [],
            |row| {
                let mut integers = [0_i64; 9];
                for (index, integer) in integers.iter_mut().enumerate() {
                    match row.get_ref(index)? {
                        ValueRef::Integer(value) if value >= 0 => *integer = value,
                        _ => {
                            return Ok(Err(corrupt("invalid command resource settings integer")));
                        }
                    }
                }
                Ok(Ok(integers))
            },
        )
        .optional()?;
    let integers = integers.ok_or_else(|| corrupt("missing command resource settings"))??;
    let settings = CommandResourceSettings {
        max_caller_pending: integers[0] as u64,
        max_provider_pending: integers[1] as u64,
        max_window_pending: integers[2] as u64,
        max_payload_bytes: integers[3] as u64,
        max_payload_depth: integers[4] as u64,
        max_payload_entries: integers[5] as u64,
        max_component_bytes: integers[6] as u64,
        max_window_bytes: integers[7] as u64,
    };
    settings
        .validate()
        .map_err(|_| corrupt("invalid command resource limits"))?;
    let revision = CommandResourceRevision::new(integers[8])
        .map_err(|_| corrupt("invalid command resource revision"))?;
    Ok(CommandResourceSettingsSnapshot { revision, settings })
}

#[cfg(test)]
#[path = "store_command_settings_tests.rs"]
mod tests;
