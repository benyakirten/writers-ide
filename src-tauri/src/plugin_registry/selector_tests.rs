use std::{fs, path::Path};

use super::*;

const ID_BYTES: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
// Independently calculated with Python hashlib.sha256(header + bytes(range(16))).
const EXPECTED_DIGEST: [u8; 32] = [
    0x2d, 0x9c, 0xf7, 0x2f, 0x6b, 0x9f, 0xad, 0x27, 0x09, 0x96, 0xcd, 0x25, 0x18, 0x39, 0x42, 0xe0,
    0xf5, 0x33, 0xe4, 0x0a, 0xd5, 0xbb, 0x97, 0x55, 0xa6, 0xce, 0xf2, 0xf3, 0xdd, 0x3b, 0x43, 0xb6,
];

fn fixture() -> [u8; 64] {
    let mut bytes = [0; 64];
    bytes[..16].copy_from_slice(b"WIDE-REGISTRY-1\n");
    bytes[16..32].copy_from_slice(&ID_BYTES);
    bytes[32..].copy_from_slice(&EXPECTED_DIGEST);
    bytes
}

fn owned_root() -> (tempfile::TempDir, LocationLease) {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    fs::create_dir(&root).unwrap();
    (parent, lease)
}

fn assert_recovery<T: std::fmt::Debug>(result: Result<T>) {
    assert!(
        matches!(result, Err(RegistryError::RecoveryRequired(_))),
        "expected recovery, got {result:?}"
    );
}

#[test]
fn exact_independent_record_vector() {
    let id = GenerationId::from_bytes(ID_BYTES);
    assert_eq!(encode(id), fixture());
    assert_eq!(decode(&fixture()).unwrap(), id);
    assert_eq!(id.name(), "000102030405060708090a0b0c0d0e0f");
}

#[test]
fn every_truncated_length_and_trailing_bytes_are_rejected() {
    let bytes = fixture();
    for length in 0..64 {
        assert_recovery(decode(&bytes[..length]));
    }
    for length in [65, 66, 128, 4096] {
        let mut extended = bytes.to_vec();
        extended.resize(length, 0);
        assert_recovery(decode(&extended));
    }
}

#[test]
fn every_single_bit_corruption_in_header_id_and_checksum_is_rejected() {
    for index in 0..64 {
        for bit in 0..8 {
            let mut bytes = fixture();
            bytes[index] ^= 1 << bit;
            assert_recovery(decode(&bytes));
        }
    }
}

#[test]
fn bad_magic_and_unknown_versions_fail_even_with_valid_checksum() {
    for (index, replacement) in [(0, b'X'), (14, b'0'), (14, b'2'), (15, b'\r')] {
        let mut bytes = fixture();
        bytes[index] = replacement;
        let digest = Sha256::digest(&bytes[..32]);
        bytes[32..].copy_from_slice(&digest);
        assert_recovery(decode(&bytes));
    }
}

#[test]
fn generation_names_cannot_supply_paths_and_are_bound_to_the_supplied_lease() {
    let (_first_parent, first) = owned_root();
    let (_second_parent, second) = owned_root();
    for bytes in [ID_BYTES, [0xff; 16], [b'/'; 16], [b'.'; 16], [b'\\'; 16]] {
        let id = GenerationId::from_bytes(bytes);
        let name = id.name();
        assert_eq!(name.len(), 32);
        assert!(name
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
        assert_eq!(Path::new(&name).components().count(), 1);
        assert_eq!(id.directory(&first), first.root().join(&name));
        assert_eq!(id.directory(&second), second.root().join(&name));
        assert_eq!(
            id.database_path(&first),
            first.root().join(&name).join("registry.sqlite")
        );
        assert_eq!(decode(&encode(id)).unwrap(), id);
    }
    let id = GenerationId::random().unwrap();
    assert_eq!(decode(&encode(id)).unwrap(), id);
    assert_eq!(id.name().len(), 32);
}

#[test]
fn reads_exact_record_without_changing_it() {
    let (_parent, lease) = owned_root();
    let path = lease.root().join(ACTIVE);
    fs::write(&path, fixture()).unwrap();
    assert_eq!(read(&lease).unwrap(), GenerationId::from_bytes(ID_BYTES));
    assert_eq!(fs::read(path).unwrap(), fixture());
}

#[test]
fn missing_or_invalid_selector_never_falls_back_or_repairs_evidence() {
    let (_parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    fs::create_dir(id.directory(&lease)).unwrap();
    fs::write(id.database_path(&lease), b"candidate database").unwrap();
    fs::write(lease.root().join("active.tmp"), fixture()).unwrap();
    let active = lease.root().join(ACTIVE);
    assert_recovery(read(&lease));
    assert!(!active.exists());
    for length in 0..64 {
        fs::write(&active, &fixture()[..length]).unwrap();
        assert_recovery(read(&lease));
        assert_eq!(fs::read(&active).unwrap(), fixture()[..length]);
    }
    let mut corrupt = fixture();
    corrupt[32] ^= 1;
    fs::write(&active, corrupt).unwrap();
    assert_recovery(read(&lease));
    assert_eq!(fs::read(&active).unwrap(), corrupt);
    assert!(id.database_path(&lease).exists());
    assert_eq!(
        fs::read(lease.root().join("active.tmp")).unwrap(),
        fixture()
    );
}

#[test]
fn oversized_regular_file_is_rejected_with_a_bounded_read() {
    let (_parent, lease) = owned_root();
    let path = lease.root().join(ACTIVE);
    for length in [65, 66, 1024 * 1024] {
        let mut bytes = fixture().to_vec();
        bytes.resize(length, 0);
        fs::write(&path, bytes).unwrap();
        assert_recovery(read(&lease));
        assert_eq!(fs::metadata(&path).unwrap().len(), length as u64);
    }
}

#[test]
fn rejects_directory_selector_and_missing_or_non_directory_root() {
    let (parent, lease) = owned_root();
    fs::create_dir(lease.root().join(ACTIVE)).unwrap();
    assert_recovery(read(&lease));
    fs::remove_dir(lease.root().join(ACTIVE)).unwrap();
    fs::remove_dir(lease.root()).unwrap();
    assert_recovery(read(&lease));
    assert!(!lease.root().exists());
    fs::write(lease.root(), fixture()).unwrap();
    assert_recovery(read(&lease));
    assert_eq!(fs::read(lease.root()).unwrap(), fixture());
    assert_eq!(fs::read_dir(parent.path()).unwrap().count(), 2);
}

#[cfg(unix)]
#[test]
fn rejects_selector_symlinks_including_dangling_links_and_directory_links() {
    use std::os::unix::fs::symlink;

    let (parent, lease) = owned_root();
    let outside = parent.path().join("outside");
    fs::write(&outside, fixture()).unwrap();
    let active = lease.root().join(ACTIVE);
    for target in [
        outside,
        parent.path().join("missing"),
        parent.path().to_path_buf(),
    ] {
        symlink(&target, &active).unwrap();
        assert_recovery(read(&lease));
        assert_eq!(fs::read_link(&active).unwrap(), target);
        fs::remove_file(&active).unwrap();
    }
}

#[cfg(unix)]
#[test]
fn rejects_symlink_root_without_reading_its_valid_selector() {
    use std::os::unix::fs::symlink;

    let (parent, lease) = owned_root();
    let outside = parent.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join(ACTIVE), fixture()).unwrap();
    fs::remove_dir(lease.root()).unwrap();
    symlink(&outside, lease.root()).unwrap();
    assert_recovery(read(&lease));
    assert_eq!(fs::read_link(lease.root()).unwrap(), outside);
}

#[cfg(unix)]
#[test]
fn fifo_selector_without_a_writer_is_rejected_within_a_bounded_time() {
    use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::mpsc, time::Duration};

    let (_parent, lease) = owned_root();
    let active = lease.root().join(ACTIVE);
    let name = CString::new(active.as_os_str().as_bytes()).unwrap();
    // The path is NUL-terminated and remains alive for the entire native call.
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    let (sender, receiver) = mpsc::channel();
    let worker = std::thread::spawn(move || sender.send(read(&lease)).unwrap());
    let result = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("selector reader blocked on a FIFO with no writer");
    assert_recovery(result);
    worker.join().unwrap();
    assert!(!fs::symlink_metadata(active).unwrap().is_file());
}

#[cfg(unix)]
#[test]
fn socket_selector_is_rejected_without_removing_it() {
    // macOS's default temporary path can exceed the Unix socket path limit.
    let parent = tempfile::tempdir_in("/tmp").unwrap();
    let lease = LocationLease::acquire(&parent.path().join("registry")).unwrap();
    fs::create_dir(lease.root()).unwrap();
    let path = lease.root().join(ACTIVE);
    let _listener = std::os::unix::net::UnixListener::bind(&path).unwrap();
    assert_recovery(read(&lease));
    assert!(path.exists());
}

#[test]
fn validates_only_the_bound_generation_and_releases_handles_before_sqlite_open() {
    let (_parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    fs::create_dir(id.directory(&lease)).unwrap();
    let database = id.database_path(&lease);
    let connection = rusqlite::Connection::open(&database).unwrap();
    connection
        .execute_batch("CREATE TABLE example(value TEXT)")
        .unwrap();
    connection.close().unwrap();
    let path = validate_generation(&lease, id).unwrap();
    assert_eq!(path, database);
    assert!(path.starts_with(lease.root()));
    assert!(!lease.root().join(ACTIVE).exists());
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection
        .execute_batch("BEGIN EXCLUSIVE; INSERT INTO example VALUES ('ready'); COMMIT;")
        .unwrap();
    connection.close().unwrap();

    let other = GenerationId::from_bytes([0xff; 16]);
    fs::write(lease.root().join(ACTIVE), encode(id)).unwrap();
    assert_recovery(validate_generation(&lease, other));
    assert!(!other.directory(&lease).exists());
    assert_eq!(fs::read(lease.root().join(ACTIVE)).unwrap(), encode(id));
}

#[test]
fn validation_rejects_missing_and_nonregular_generation_or_database_without_repair() {
    let (_parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    let directory = id.directory(&lease);
    let database = id.database_path(&lease);
    assert_recovery(validate_generation(&lease, id));
    assert!(!directory.exists());
    fs::write(&directory, b"not a directory").unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert_eq!(fs::read(&directory).unwrap(), b"not a directory");
    fs::remove_file(&directory).unwrap();
    fs::create_dir(&directory).unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert!(!database.exists());
    fs::create_dir(&database).unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert!(database.is_dir());
    assert_eq!(fs::read_dir(&database).unwrap().count(), 0);
}

#[test]
fn generation_validation_rejects_missing_or_non_directory_root() {
    let (_parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    fs::remove_dir(lease.root()).unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert!(!lease.root().exists());
    fs::write(lease.root(), b"not a root").unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert_eq!(fs::read(lease.root()).unwrap(), b"not a root");
}

#[cfg(unix)]
#[test]
fn generation_validation_rejects_root_generation_and_database_symlinks() {
    use std::os::unix::fs::symlink;

    let (parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    let outside = parent.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let target = outside.join("registry.sqlite");
    fs::write(&target, b"otherwise valid regular database").unwrap();
    let directory = id.directory(&lease);
    let database = id.database_path(&lease);
    symlink(&outside, &directory).unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert_eq!(fs::read_link(&directory).unwrap(), outside);
    fs::remove_file(&directory).unwrap();
    fs::create_dir(&directory).unwrap();
    for target in [&target, &outside.join("missing")] {
        symlink(target, &database).unwrap();
        assert_recovery(validate_generation(&lease, id));
        assert_eq!(fs::read_link(&database).unwrap(), *target);
        fs::remove_file(&database).unwrap();
    }
    fs::remove_dir(&directory).unwrap();
    fs::rename(lease.root(), outside.join("root")).unwrap();
    fs::create_dir(outside.join("root").join(id.name())).unwrap();
    fs::write(
        outside.join("root").join(id.name()).join("registry.sqlite"),
        b"database",
    )
    .unwrap();
    symlink(outside.join("root"), lease.root()).unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert_eq!(
        fs::read(&target).unwrap(),
        b"otherwise valid regular database"
    );
}

#[cfg(unix)]
#[test]
fn fifo_database_without_a_writer_is_rejected_within_a_bounded_time() {
    use std::{ffi::CString, os::unix::ffi::OsStrExt, sync::mpsc, time::Duration};

    let (_parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    fs::create_dir(id.directory(&lease)).unwrap();
    let database = id.database_path(&lease);
    let name = CString::new(database.as_os_str().as_bytes()).unwrap();
    // The path is NUL-terminated and remains alive for the entire native call.
    assert_eq!(unsafe { libc::mkfifo(name.as_ptr(), 0o600) }, 0);
    let (sender, receiver) = mpsc::channel();
    let worker = std::thread::spawn(move || sender.send(validate_generation(&lease, id)).unwrap());
    let result = receiver
        .recv_timeout(Duration::from_secs(2))
        .expect("generation validation blocked on a FIFO with no writer");
    assert_recovery(result);
    worker.join().unwrap();
    assert!(!fs::symlink_metadata(database).unwrap().is_file());
}

#[cfg(windows)]
#[test]
fn generation_validation_rejects_windows_generation_and_database_symlinks() {
    use std::os::windows::fs::{symlink_dir, symlink_file};

    let (parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    let outside = parent.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let target = outside.join("registry.sqlite");
    fs::write(&target, b"otherwise valid regular database").unwrap();
    let directory = id.directory(&lease);
    if let Err(error) = symlink_dir(&outside, &directory) {
        if error.raw_os_error() == Some(1314) {
            eprintln!("symlink coverage unavailable: Windows symlink privilege is required");
            return;
        }
        panic!("cannot create generation symlink: {error}");
    }
    assert_recovery(validate_generation(&lease, id));
    fs::remove_dir(&directory).unwrap();
    fs::create_dir(&directory).unwrap();
    let database = id.database_path(&lease);
    symlink_file(&target, &database).unwrap();
    assert_recovery(validate_generation(&lease, id));
    assert_eq!(
        fs::read(&target).unwrap(),
        b"otherwise valid regular database"
    );
}

#[cfg(windows)]
#[test]
fn generation_validation_rejects_windows_junctions() {
    let (parent, lease) = owned_root();
    let id = GenerationId::from_bytes(ID_BYTES);
    let outside = parent.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("registry.sqlite"), b"database").unwrap();
    let directory = id.directory(&lease);
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&directory)
        .arg(&outside)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "cannot create junction: {output:?}"
    );
    assert_recovery(validate_generation(&lease, id));
    fs::remove_dir(&directory).unwrap();
    fs::create_dir(&directory).unwrap();
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(id.database_path(&lease))
        .arg(&outside)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "cannot create junction: {output:?}"
    );
    assert_recovery(validate_generation(&lease, id));
    assert_eq!(
        fs::read(outside.join("registry.sqlite")).unwrap(),
        b"database"
    );
}

#[cfg(windows)]
#[test]
fn rejects_windows_selector_and_root_symlinks() {
    use std::os::windows::fs::{symlink_dir, symlink_file};

    let (parent, lease) = owned_root();
    let outside = parent.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join(ACTIVE), fixture()).unwrap();
    let active = lease.root().join(ACTIVE);
    if let Err(error) = symlink_file(outside.join(ACTIVE), &active) {
        if error.raw_os_error() == Some(1314) {
            eprintln!("symlink coverage unavailable: Windows symlink privilege is required");
            return;
        }
        panic!("cannot create selector symlink: {error}");
    }
    assert_recovery(read(&lease));
    fs::remove_file(active).unwrap();
    fs::remove_dir(lease.root()).unwrap();
    symlink_dir(&outside, lease.root()).unwrap();
    assert_recovery(read(&lease));
    assert_eq!(fs::read(outside.join(ACTIVE)).unwrap(), fixture());
}
