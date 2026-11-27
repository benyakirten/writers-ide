use super::*;
use crate::plugin_integrity::IntegrityLimits;
use std::future::Future;
use tempfile::TempDir;

pub(super) fn limits() -> RegistryLimits {
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

pub(super) fn run<F: Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(future)
}

struct TestRoot {
    lease: LocationLease,
    directory: TempDir,
}
impl TestRoot {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let lease = LocationLease::acquire(directory.path()).unwrap();
        Self { lease, directory }
    }

    fn initialized() -> Self {
        let root = Self::new();
        root.lease.initialize().unwrap();
        root
    }
}

fn assert_recovery<T>(result: Result<T>) {
    match result {
        Err(RegistryError::RecoveryRequired(_)) => {}
        Err(error) => panic!("expected recovery required, got {error:?}"),
        Ok(_) => panic!("unexpected success"),
    }
}

#[test]
fn lease_clones_exclude_independent_owners_until_last_clone_drops() {
    let root = TestRoot::new();
    let clone = root.lease.clone();
    assert!(matches!(
        LocationLease::acquire(root.directory.path()),
        Err(RegistryError::Unavailable(_))
    ));
    drop(root.lease);
    assert!(matches!(
        LocationLease::acquire(root.directory.path()),
        Err(RegistryError::Unavailable(_))
    ));
    drop(clone);
    let next = LocationLease::acquire(root.directory.path()).unwrap();
    assert_eq!(
        next.root(),
        root.directory.path().canonicalize().unwrap().join(ROOT)
    );
}

#[test]
fn initialization_requires_absent_root_not_an_existing_empty_directory() {
    let root = TestRoot::new();
    assert!(root.lease.is_fresh().unwrap());
    root.lease.initialize().unwrap();
    assert!(root.lease.root().join("generations").is_dir());
    assert!(!root.lease.root().join(ACTIVE).exists());
    assert_recovery(root.lease.is_fresh());
    assert_recovery(root.lease.initialize());

    let empty = TestRoot::new();
    fs::create_dir(empty.lease.root()).unwrap();
    assert_recovery(empty.lease.is_fresh());
    assert_recovery(empty.lease.initialize());
    assert_eq!(fs::read_dir(empty.lease.root()).unwrap().count(), 0);
}

#[test]
fn missing_invalid_and_oversized_selectors_never_guess_a_generation() {
    let root = TestRoot::initialized();
    let generation = prepare(&root.lease, &limits(), &mut Native).unwrap();
    let database = fs::read(generation.id.database(&root.lease)).unwrap();
    let active = root.lease.root().join(ACTIVE);
    let mut bad_checksum = generation.id.encode();
    bad_checksum[SELECTOR_BYTES - 1] ^= 1;
    let mut bad_magic = generation.id.encode();
    bad_magic[0] ^= 1;
    let mut oversized = generation.id.encode();
    oversized.extend_from_slice(b"extra");
    let records = [
        None,
        Some(Vec::new()),
        Some(b"../generations/registry.sqlite".to_vec()),
        Some(bad_checksum),
        Some(bad_magic),
        Some(oversized),
        Some(vec![0; 1024 * 1024]),
    ];
    for record in records {
        if let Some(bytes) = &record {
            fs::write(&active, bytes).unwrap();
        }
        assert_recovery(read_selector(&root.lease));
        assert_recovery(root.lease.is_fresh());
        assert_recovery(root.lease.initialize());
        // Replacement validates the current selector before any publication work.
        assert_recovery(run(publish(
            root.lease.clone(),
            &generation,
            true,
            limits(),
            &mut Native,
        )));
        if let Some(bytes) = record {
            assert_eq!(fs::read(&active).unwrap(), bytes);
        } else {
            assert!(!active.exists());
        }
        assert_eq!(
            fs::read(generation.id.database(&root.lease)).unwrap(),
            database
        );
        assert!(generation.id.directory(&root.lease).is_dir());
    }
}

#[test]
fn selector_is_a_checksummed_opaque_identifier_not_a_normalized_path() {
    let root = TestRoot::initialized();
    for bytes in [*b"../a\\b/./c:xyz!?", [0; 16], [255; 16]] {
        let id = GenerationId(bytes);
        let record = id.encode();
        assert_eq!(record.len(), SELECTOR_BYTES);
        assert_eq!(GenerationId::decode(&record).unwrap(), id);
        assert_eq!(id.name().len(), 32);
        assert!(id.name().bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(
            id.directory(&root.lease).parent().unwrap(),
            root.lease.root().join("generations")
        );
        let mut appended = record.clone();
        appended.push(0);
        assert_recovery(GenerationId::decode(&appended));
        assert_recovery(GenerationId::decode(&record[..record.len() - 1]));
        for index in [0, MAGIC.len(), SELECTOR_BYTES - 1] {
            let mut damaged = record.clone();
            damaged[index] ^= 1;
            assert_recovery(GenerationId::decode(&damaged));
        }
    }
}

#[cfg(unix)]
#[test]
fn symlink_roots_and_selectors_are_refused_without_touching_targets() {
    use std::os::unix::fs::symlink;

    let root = TestRoot::new();
    let target = root.directory.path().join("target");
    fs::create_dir(&target).unwrap();
    symlink(&target, root.lease.root()).unwrap();
    assert_recovery(root.lease.is_fresh());
    assert_recovery(root.lease.initialize());
    assert_eq!(fs::read_link(root.lease.root()).unwrap(), target);
    assert_eq!(fs::read_dir(&target).unwrap().count(), 0);

    let root = TestRoot::initialized();
    let target = root.directory.path().join("selector-target");
    let record = GenerationId([7; 16]).encode();
    fs::write(&target, &record).unwrap();
    let active = root.lease.root().join(ACTIVE);
    symlink(&target, &active).unwrap();
    assert_recovery(read_selector(&root.lease));
    assert_recovery(root.lease.is_fresh());
    assert_recovery(root.lease.initialize());
    assert_eq!(fs::read_link(&active).unwrap(), target);
    assert_eq!(fs::read(&target).unwrap(), record);
    fs::remove_file(&target).unwrap();
    assert_recovery(read_selector(&root.lease));
    assert_recovery(root.lease.is_fresh());
    assert!(!target.exists());
    assert!(fs::symlink_metadata(active)
        .unwrap()
        .file_type()
        .is_symlink());
}

#[test]
fn unusable_selected_database_requires_recovery_without_picking_valid_sibling() {
    let root = TestRoot::initialized();
    let valid = prepare(&root.lease, &limits(), &mut Native).unwrap();
    let missing = GenerationId([17; 16]);
    fs::write(root.lease.root().join(ACTIVE), missing.encode()).unwrap();
    assert_recovery(run(open_selected(root.lease.clone(), limits())));
    assert_eq!(read_selector(&root.lease).unwrap(), missing);
    assert!(valid.id.database(&root.lease).is_file());
    assert!(!missing.database(&root.lease).exists());
}

#[cfg(unix)]
mod unix {
    use super::*;
    use crate::plugin_registry::model::PermissionMode;

    fn published() -> (TestRoot, SealedGeneration) {
        let root = TestRoot::initialized();
        let generation = prepare(&root.lease, &limits(), &mut Native).unwrap();
        let session = run(publish(
            root.lease.clone(),
            &generation,
            false,
            limits(),
            &mut Native,
        ))
        .unwrap();
        run(session.shutdown()).unwrap();
        (root, generation)
    }

    fn staging_selectors(lease: &LocationLease) -> Vec<PathBuf> {
        let mut paths: Vec<_> = fs::read_dir(lease.root())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| {
                let name = path.file_name().unwrap().to_str().unwrap();
                name.starts_with("selector-") && name.ends_with(".tmp")
            })
            .collect();
        paths.sort();
        paths
    }

    fn failure<T>(result: Result<T>) -> RegistryError {
        match result {
            Err(error) => error,
            Ok(_) => panic!("fault returned a usable result"),
        }
    }

    #[test]
    fn first_publication_and_replacement_return_actual_ready_registry_workers() {
        let root = TestRoot::initialized();
        let old = prepare(&root.lease, &limits(), &mut Native).unwrap();
        let session = run(publish(
            root.lease.clone(),
            &old,
            false,
            limits(),
            &mut Native,
        ))
        .unwrap();
        assert_eq!(read_selector(&root.lease).unwrap(), old.id);
        assert!(!root.lease.is_fresh().unwrap());
        let original = run(session.handle.read_settings()).unwrap();
        assert_eq!(original.permission_mode, PermissionMode::Secure);
        let mut changed = original;
        changed.permission_mode = PermissionMode::Trust;
        run(session.handle.set_host_settings(original, changed)).unwrap();
        let stale_handle = session.handle.clone();
        assert!(matches!(
            LocationLease::acquire(root.directory.path()),
            Err(RegistryError::Unavailable(_))
        ));
        run(session.shutdown()).unwrap();
        assert!(matches!(
            run(stale_handle.read_settings()),
            Err(RegistryError::Unavailable(_))
        ));

        let new = prepare(&root.lease, &limits(), &mut Native).unwrap();
        assert_ne!(old.id, new.id);
        assert!(matches!(
            run(publish(
                root.lease.clone(),
                &new,
                false,
                limits(),
                &mut Native
            )),
            Err(RegistryError::Conflict(_))
        ));
        assert_eq!(read_selector(&root.lease).unwrap(), old.id);
        let session = run(publish(
            root.lease.clone(),
            &new,
            true,
            limits(),
            &mut Native,
        ))
        .unwrap();
        assert_eq!(read_selector(&root.lease).unwrap(), new.id);
        assert_eq!(run(session.handle.read_settings()).unwrap(), original);
        run(session.shutdown()).unwrap();
        let reopened = run(Registry::open(
            old.id.database(&root.lease),
            limits(),
            crate::plugin_registry::RegistryCapacity::with_observers(8, 4, 4).unwrap(),
        ))
        .unwrap();
        assert_eq!(run(reopened.handle.read_settings()).unwrap(), changed);
        run(reopened.owner.shutdown()).unwrap();
        assert!(old.id.directory(&root.lease).is_dir());
        assert!(new.id.directory(&root.lease).is_dir());
        assert!(staging_selectors(&root.lease).is_empty());
        assert!(matches!(
            root.lease.initialize(),
            Err(RegistryError::Conflict(_))
        ));
    }

    struct Fault {
        phase: Phase,
        reached: bool,
    }
    impl Control for Fault {
        fn at(&mut self, phase: Phase) -> io::Result<()> {
            if phase == self.phase {
                self.reached = true;
                return Err(io::Error::other(format!("injected {phase:?}")));
            }
            Ok(())
        }
    }

    #[test]
    fn every_phase_fault_preserves_generations_and_respects_publication_boundary() {
        for phase in [
            Phase::GenerationCreated,
            Phase::DatabasePrepared,
            Phase::BeforeSeal,
            Phase::GenerationSealed,
            Phase::GenerationDirectorySync,
            Phase::GenerationsDirectorySync,
            Phase::RootDirectorySync,
            Phase::ParentDirectorySync,
            Phase::BeforeSelectorCreate,
            Phase::SelectorWrite,
            Phase::SelectorFileSync,
            Phase::BeforeReplace,
            Phase::AfterReplace,
            Phase::PublishedDirectorySync,
            Phase::SelectorConfirmed,
            Phase::BeforeReopen,
        ] {
            let (root, old) = published();
            let old_record = fs::read(root.lease.root().join(ACTIVE)).unwrap();
            let old_database = fs::read(old.id.database(&root.lease)).unwrap();
            let mut fault = Fault {
                phase,
                reached: false,
            };
            let result = match prepare(&root.lease, &limits(), &mut fault) {
                Ok(new) => run(publish(
                    root.lease.clone(),
                    &new,
                    true,
                    limits(),
                    &mut fault,
                )),
                Err(error) => Err(error),
            };
            let error = failure(result);
            assert!(fault.reached, "{phase:?}: {error:?}");
            let directories: Vec<_> = fs::read_dir(root.lease.root().join("generations"))
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            assert_eq!(directories.len(), 2, "{phase:?}");
            assert!(directories.iter().all(|path| path.is_dir()));
            let new_directory = directories
                .iter()
                .find(|path| **path != old.id.directory(&root.lease))
                .unwrap();
            assert_eq!(
                fs::read(old.id.database(&root.lease)).unwrap(),
                old_database
            );
            let published = matches!(
                phase,
                Phase::AfterReplace
                    | Phase::PublishedDirectorySync
                    | Phase::SelectorConfirmed
                    | Phase::BeforeReopen
            );
            if published {
                let selected = read_selector(&root.lease).unwrap();
                assert_ne!(selected, old.id, "{phase:?}");
                assert_eq!(selected.directory(&root.lease), *new_directory);
                assert_eq!(
                    fs::read(root.lease.root().join(ACTIVE)).unwrap(),
                    selected.encode()
                );
                if matches!(phase, Phase::AfterReplace | Phase::PublishedDirectorySync) {
                    assert!(
                        matches!(error, RegistryError::OutcomeUnknown(_)),
                        "{phase:?}: {error:?}"
                    );
                } else {
                    assert!(
                        matches!(error, RegistryError::RecoveryRequired(_)),
                        "{phase:?}: {error:?}"
                    );
                }
            } else {
                assert!(
                    matches!(error, RegistryError::Storage(_)),
                    "{phase:?}: {error:?}"
                );
                assert_eq!(
                    fs::read(root.lease.root().join(ACTIVE)).unwrap(),
                    old_record
                );
                assert_eq!(read_selector(&root.lease).unwrap(), old.id);
            }
            let staging = staging_selectors(&root.lease);
            if matches!(
                phase,
                Phase::SelectorWrite | Phase::SelectorFileSync | Phase::BeforeReplace
            ) {
                assert_eq!(staging.len(), 1, "{phase:?}");
                let bytes = fs::read(&staging[0]).unwrap();
                if phase == Phase::SelectorWrite {
                    assert!(bytes.is_empty());
                } else {
                    let staged = GenerationId::decode(&bytes).unwrap();
                    assert_eq!(staged.directory(&root.lease), *new_directory);
                }
            } else {
                assert!(staging.is_empty(), "{phase:?}");
            }
        }
    }

    struct ShortWrite {
        calls: usize,
    }
    struct PartialWriter<'a> {
        file: &'a mut File,
        calls: &'a mut usize,
    }
    impl Write for PartialWriter<'_> {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            *self.calls += 1;
            if *self.calls == 1 {
                self.file.write(&bytes[..bytes.len().min(3)])
            } else {
                Ok(0)
            }
        }
        fn flush(&mut self) -> io::Result<()> {
            self.file.flush()
        }
    }
    impl Control for ShortWrite {
        fn write_selector(&mut self, file: &mut File, record: &[u8]) -> io::Result<()> {
            PartialWriter {
                file,
                calls: &mut self.calls,
            }
            .write_all(record)
        }
    }

    #[test]
    fn write_all_detects_short_write_and_preserves_partial_staging_and_old_selector() {
        let (root, old) = published();
        let old_record = fs::read(root.lease.root().join(ACTIVE)).unwrap();
        let new = prepare(&root.lease, &limits(), &mut Native).unwrap();
        let mut control = ShortWrite { calls: 0 };
        let error = failure(run(publish(
            root.lease.clone(),
            &new,
            true,
            limits(),
            &mut control,
        )));
        match error {
            RegistryError::Storage(error) => assert_eq!(
                error.downcast_ref::<io::Error>().unwrap().kind(),
                io::ErrorKind::WriteZero
            ),
            error => panic!("unexpected short-write error: {error:?}"),
        }
        assert_eq!(control.calls, 2);
        assert_eq!(
            fs::read(root.lease.root().join(ACTIVE)).unwrap(),
            old_record
        );
        assert_eq!(read_selector(&root.lease).unwrap(), old.id);
        let staging = staging_selectors(&root.lease);
        assert_eq!(staging.len(), 1);
        assert_eq!(fs::read(&staging[0]).unwrap(), new.id.encode()[..3]);
        assert!(old.id.directory(&root.lease).is_dir());
        assert!(new.id.directory(&root.lease).is_dir());
    }

    struct ChangeSelector {
        active: PathBuf,
        replacement: GenerationId,
    }
    impl Control for ChangeSelector {
        fn at(&mut self, phase: Phase) -> io::Result<()> {
            if phase == Phase::SelectorConfirmed {
                fs::write(&self.active, self.replacement.encode())?;
            }
            Ok(())
        }
    }

    #[test]
    fn mismatching_confirmed_selector_requires_recovery_without_old_fallback() {
        let (root, old) = published();
        let new = prepare(&root.lease, &limits(), &mut Native).unwrap();
        let unexpected = GenerationId([42; 16]);
        assert_ne!(unexpected, old.id);
        assert_ne!(unexpected, new.id);
        let mut control = ChangeSelector {
            active: root.lease.root().join(ACTIVE),
            replacement: unexpected,
        };
        let error = failure(run(publish(
            root.lease.clone(),
            &new,
            true,
            limits(),
            &mut control,
        )));
        assert!(
            matches!(error, RegistryError::RecoveryRequired(ref message) if message.contains("selector changed")),
            "{error:?}"
        );
        assert_eq!(read_selector(&root.lease).unwrap(), unexpected);
        assert!(!unexpected.directory(&root.lease).exists());
        assert!(old.id.database(&root.lease).is_file());
        assert!(new.id.database(&root.lease).is_file());
        assert!(staging_selectors(&root.lease).is_empty());
    }

    struct CorruptBeforeReopen {
        database: PathBuf,
        reached: bool,
    }
    impl Control for CorruptBeforeReopen {
        fn at(&mut self, phase: Phase) -> io::Result<()> {
            if phase == Phase::BeforeReopen {
                let connection = Connection::open(&self.database).unwrap();
                assert_eq!(
                    connection.execute("DELETE FROM host_settings", []).unwrap(),
                    1
                );
                connection.close().unwrap();
                self.reached = true;
            }
            Ok(())
        }
    }

    #[test]
    fn actual_postpublication_readiness_failure_keeps_new_selector_and_never_falls_back() {
        let (root, old) = published();
        let old_database = fs::read(old.id.database(&root.lease)).unwrap();
        let new = prepare(&root.lease, &limits(), &mut Native).unwrap();
        let mut control = CorruptBeforeReopen {
            database: new.id.database(&root.lease),
            reached: false,
        };
        let error = failure(run(publish(
            root.lease.clone(),
            &new,
            true,
            limits(),
            &mut control,
        )));
        assert!(control.reached);
        assert!(
            matches!(error, RegistryError::RecoveryRequired(ref message) if message.contains("failed readiness")),
            "{error:?}"
        );
        assert_eq!(read_selector(&root.lease).unwrap(), new.id);
        assert_eq!(
            fs::read(root.lease.root().join(ACTIVE)).unwrap(),
            new.id.encode()
        );
        assert_eq!(
            fs::read(old.id.database(&root.lease)).unwrap(),
            old_database
        );
        let connection = Connection::open(new.id.database(&root.lease)).unwrap();
        let rows: i64 = connection
            .query_row("SELECT count(*) FROM host_settings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        connection.close().unwrap();
        assert!(old.id.directory(&root.lease).is_dir());
        assert!(new.id.directory(&root.lease).is_dir());
        assert!(staging_selectors(&root.lease).is_empty());
    }
}

#[cfg(windows)]
#[test]
fn integrated_publication_refuses_unsupported_directory_barrier_before_selector_creation() {
    let root = TestRoot::initialized();
    let generation = prepare(&root.lease, &limits(), &mut Native).unwrap();
    match run(publish(
        root.lease.clone(),
        &generation,
        false,
        limits(),
        &mut Native,
    )) {
        Err(RegistryError::Storage(error)) => assert_eq!(
            error.downcast_ref::<io::Error>().unwrap().kind(),
            io::ErrorKind::Unsupported
        ),
        Err(error) => panic!("unexpected publication error: {error:?}"),
        Ok(session) => {
            run(session.shutdown()).unwrap();
            panic!("Windows must not report durable publication success");
        }
    }
    assert!(!root.lease.root().join(ACTIVE).exists());
    assert!(generation.id.database(&root.lease).is_file());
    assert!(generation.id.directory(&root.lease).is_dir());
    let entries: Vec<_> = fs::read_dir(root.lease.root())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(entries, ["generations"]);
}
