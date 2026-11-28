#[path = "../../../../src-tauri/src/plugin_registry/error.rs"]
mod error;
#[path = "../../../../src-tauri/src/plugin_registry/location.rs"]
mod location;
#[path = "../../../../src-tauri/src/plugin_registry/model.rs"]
mod model;
#[path = "../../../../src-tauri/src/plugin_registry/schema.rs"]
mod schema;
#[path = "../../../../src-tauri/src/plugin_registry/selector.rs"]
mod selector;

pub fn seed(root: &std::path::Path) -> error::Result<()> {
    let lease = location::LocationLease::acquire(root)?;
    // create_dir refuses any prior root, including an empty or malformed seed.
    std::fs::create_dir(lease.root())?;
    let id = selector::GenerationId::random()?;
    std::fs::create_dir(id.directory(&lease))?;
    let path = id.database_path(&lease);
    let mut connection = rusqlite::Connection::open_with_flags(
        path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_CREATE,
    )?;
    schema::initialize(&mut connection)?;
    schema::validate(&connection)?;
    connection
        .close()
        .map_err(|(_, e)| error::RegistryError::from(e))?;
    use std::io::Write;
    let mut active = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lease.root().join(selector::ACTIVE))?;
    active.write_all(&selector::encode(id))?;
    active.sync_all()?;
    Ok(())
}
