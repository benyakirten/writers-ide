use super::*;
use crate::plugin_integrity::IntegrityLimits;
use tempfile::TempDir;

fn limits() -> RegistryLimits {
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

fn id(byte: u8) -> GenerationId {
    GenerationId::from_bytes([byte; 16])
}

fn fixture() -> (TempDir, LocationLease, InitialRoot) {
    let temporary = tempfile::tempdir().unwrap();
    let lease = LocationLease::acquire(&temporary.path().join("registry")).unwrap();
    let initial = InitialRoot::claim_for_test(&lease).unwrap();
    (temporary, lease, initial)
}

fn sealed(lease: &LocationLease, byte: u8) -> SealedGeneration {
    PreparedGeneration::create_id(lease, id(byte), limits())
        .unwrap()
        .seal()
        .unwrap()
}

fn old_selection(lease: &LocationLease) -> PathBuf {
    let old = sealed(lease, 1);
    let database = old.database_path().to_path_buf();
    drop(old);
    fs::write(lease.root().join(selector::ACTIVE), selector::encode(id(1))).unwrap();
    database
}

fn temporaries(root: &Path) -> Vec<PathBuf> {
    let mut paths: Vec<_> = fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| {
            let name = path.file_name().unwrap().to_string_lossy();
            name.starts_with("active-") && name.ends_with(".tmp")
        })
        .collect();
    paths.sort();
    paths
}

fn assert_owned(root: &Path, database: &Path) {
    assert!(matches!(
        LocationLease::acquire(root),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        Store::open(database, limits()),
        Err(RegistryError::Unavailable(_))
    ));
}

// With native=false this models sequencing only: barriers are no-ops and selection
// is forbidden. It supplies no platform qualification or durability evidence.
#[derive(Default)]
struct TestAdapter {
    native: bool,
    fault: Option<Phase>,
    phases: Vec<Phase>,
    directories: Vec<PathBuf>,
    selections: usize,
    selection_error: bool,
    final_barrier_error: bool,
    short_write: bool,
    change_before: Option<(PathBuf, Vec<u8>)>,
    unexpected_at_select: Option<PathBuf>,
    #[cfg(unix)]
    symlink_at_select: Option<PathBuf>,
}

impl Adapter for TestAdapter {
    fn at(&mut self, phase: Phase) -> io::Result<()> {
        self.phases.push(phase);
        if phase == Phase::BeforeSelection {
            if let Some((path, bytes)) = self.change_before.take() {
                fs::write(path, bytes)?;
            }
        }
        if self.fault == Some(phase) {
            return Err(io::Error::other(format!("injected {phase:?}")));
        }
        Ok(())
    }

    fn sync_directory(&mut self, path: &Path) -> io::Result<()> {
        self.directories.push(path.to_path_buf());
        if self.final_barrier_error && self.selections != 0 {
            return Err(io::Error::other("injected final directory barrier"));
        }
        if self.native {
            NativeCandidate.sync_directory(path)
        } else {
            Ok(())
        }
    }

    fn select(&mut self, temporary: &Path, active: &Path, replace: bool) -> io::Result<()> {
        assert!(self.native, "model tests must stop before native selection");
        self.selections += 1;
        if let Some(path) = self.unexpected_at_select.take() {
            fs::write(path, b"unexpected destination")?;
        }
        #[cfg(unix)]
        if let Some(target) = self.symlink_at_select.take() {
            std::os::unix::fs::symlink(target, active)?;
        }
        if self.selection_error {
            return Err(io::Error::other("injected selection failure"));
        }
        NativeCandidate.select(temporary, active, replace)
    }

    fn write_record(&mut self, file: &mut File, record: &[u8]) -> io::Result<()> {
        if self.short_write {
            struct ShortThenZero<'a> {
                file: &'a mut File,
                wrote: bool,
            }
            impl Write for ShortThenZero<'_> {
                fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                    if self.wrote {
                        return Ok(0);
                    }
                    self.wrote = true;
                    self.file.write(&bytes[..7.min(bytes.len())])
                }
                fn flush(&mut self) -> io::Result<()> {
                    self.file.flush()
                }
            }
            ShortThenZero { file, wrote: false }.write_all(record)
        } else {
            file.write_all(record)
        }
    }
}

#[test]
fn random_and_fixed_constructors_bind_codec_identity_to_owned_paths() {
    let (_temporary, lease, _initial) = fixture();
    let random = PreparedGeneration::create(&lease, limits()).unwrap();
    let random_id = random.generation.id;
    assert_eq!(random.generation.directory, random_id.directory(&lease));
    assert_eq!(random.generation.database, random_id.database_path(&lease));
    assert_eq!(random_id.name().len(), 32);
    assert!(random_id
        .name()
        .bytes()
        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
    assert_eq!(
        selector::decode(&selector::encode(random_id)).unwrap(),
        random_id
    );

    let fixed = PreparedGeneration::create_id(&lease, id(0xab), limits()).unwrap();
    assert_eq!(
        fixed.generation.directory,
        lease.root().join("abababababababababababababababab")
    );
    assert_eq!(
        fixed.generation.database,
        fixed.generation.directory.join("registry.sqlite")
    );
    assert_eq!(
        selector::decode(&selector::encode(fixed.generation.id)).unwrap(),
        id(0xab)
    );
    let before = fs::read(&fixed.generation.database).unwrap();
    assert!(PreparedGeneration::create_id(&lease, id(0xab), limits()).is_err());
    assert_eq!(fs::read(&fixed.generation.database).unwrap(), before);
}

#[test]
fn production_preflight_and_initial_claim_never_create_absent_root() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("registry");
    let lease = LocationLease::acquire(&root).unwrap();
    assert!(matches!(
        platform::production_preflight(&lease),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(matches!(
        InitialRoot::claim(&lease),
        Err(RegistryError::Unavailable(_))
    ));
    assert!(!root.exists());
    assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 1);
}

#[test]
fn production_refusal_retains_location_and_database_until_failure_drop() {
    let (_temporary, lease, initial) = fixture();
    let root = lease.root().to_path_buf();
    let candidate = sealed(&lease, 2);
    let database = candidate.database_path().to_path_buf();
    drop(lease);
    let failure = publish(candidate, PublicationMode::First(initial)).unwrap_err();
    assert!(matches!(failure.error(), RegistryError::Unavailable(_)));
    assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
    assert_eq!(failure.database_path(), database);
    assert_owned(&root, &database);
    assert!(!root.join(selector::ACTIVE).exists());
    assert!(temporaries(&root).is_empty());
    drop(failure);
    let _lease = LocationLease::acquire(&root).unwrap();
    let _store = Store::open(&database, limits()).unwrap();
}

#[test]
fn initial_claim_is_exclusive_and_wrong_owner_proof_cannot_publish() {
    let (_temporary, lease, initial) = fixture();
    assert!(InitialRoot::claim_for_test(&lease).is_err());
    let (_other_temporary, other, other_initial) = fixture();
    drop(initial);
    let mut adapter = TestAdapter::default();
    let failure = publish_with(
        sealed(&lease, 2),
        PublicationMode::First(other_initial),
        &mut adapter,
    )
    .unwrap_err();
    assert!(matches!(failure.error(), RegistryError::InvalidInput(_)));
    assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
    assert!(adapter.phases.is_empty());
    assert!(!lease.root().join(selector::ACTIVE).exists());
    assert!(!other.root().join(selector::ACTIVE).exists());
}

#[test]
fn first_publication_rejects_existing_regular_or_directory_selection() {
    for directory in [false, true] {
        let (_temporary, lease, initial) = fixture();
        let active = lease.root().join(selector::ACTIVE);
        if directory {
            fs::create_dir(&active).unwrap();
        } else {
            fs::write(&active, b"preserve").unwrap();
        }
        let mut adapter = TestAdapter::default();
        let failure = publish_with(
            sealed(&lease, 2),
            PublicationMode::First(initial),
            &mut adapter,
        )
        .unwrap_err();
        assert!(matches!(
            failure.error(),
            RegistryError::RecoveryRequired(_)
        ));
        assert!(adapter.phases.is_empty());
        assert!(temporaries(lease.root()).is_empty());
        if directory {
            assert!(active.is_dir());
        } else {
            assert_eq!(fs::read(active).unwrap(), b"preserve");
        }
    }
}

#[cfg(unix)]
#[test]
fn first_publication_rejects_even_dangling_active_symlink() {
    let (_temporary, lease, initial) = fixture();
    let active = lease.root().join(selector::ACTIVE);
    std::os::unix::fs::symlink("missing", &active).unwrap();
    let mut adapter = TestAdapter::default();
    let failure = publish_with(
        sealed(&lease, 2),
        PublicationMode::First(initial),
        &mut adapter,
    )
    .unwrap_err();
    assert!(matches!(
        failure.error(),
        RegistryError::RecoveryRequired(_)
    ));
    assert_eq!(fs::read_link(active).unwrap(), Path::new("missing"));
    assert!(adapter.phases.is_empty());
}

#[test]
fn replacement_missing_malformed_or_mismatched_selection_never_switches() {
    for bytes in [
        None,
        Some(b"malformed".to_vec()),
        Some(selector::encode(id(3)).to_vec()),
    ] {
        let (_temporary, lease, _initial) = fixture();
        let old = old_selection(&lease);
        let active = lease.root().join(selector::ACTIVE);
        fs::remove_file(&active).unwrap();
        if let Some(bytes) = &bytes {
            fs::write(&active, bytes).unwrap();
        }
        let mut adapter = TestAdapter::default();
        let failure = publish_with(
            sealed(&lease, 2),
            PublicationMode::Replace { expected: id(1) },
            &mut adapter,
        )
        .unwrap_err();
        assert!(matches!(
            failure.error(),
            RegistryError::RecoveryRequired(_)
        ));
        assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
        assert!(adapter.phases.is_empty());
        assert_eq!(fs::read(active).ok(), bytes);
        assert!(old.exists());
        assert!(failure.database_path().exists());
        assert!(temporaries(lease.root()).is_empty());
    }
}

#[test]
fn second_revalidation_detects_changed_selection_before_native_call() {
    let (_temporary, lease, _initial) = fixture();
    let old = old_selection(&lease);
    let active = lease.root().join(selector::ACTIVE);
    let changed = selector::encode(id(3)).to_vec();
    let mut adapter = TestAdapter {
        change_before: Some((active.clone(), changed.clone())),
        ..Default::default()
    };
    let failure = publish_with(
        sealed(&lease, 2),
        PublicationMode::Replace { expected: id(1) },
        &mut adapter,
    )
    .unwrap_err();
    assert!(matches!(
        failure.error(),
        RegistryError::RecoveryRequired(_)
    ));
    assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
    assert_eq!(adapter.selections, 0);
    assert_eq!(adapter.phases.last(), Some(&Phase::BeforeSelection));
    assert_eq!(fs::read(active).unwrap(), changed);
    assert!(old.exists());
    let evidence = temporaries(lease.root());
    assert_eq!(evidence.len(), 1);
    assert_eq!(fs::read(&evidence[0]).unwrap(), selector::encode(id(2)));
}

const PRESELECTION: [Phase; 7] = [
    Phase::GenerationDirectory,
    Phase::RootDirectory,
    Phase::StableParent,
    Phase::TemporaryCreate,
    Phase::SelectorWrite,
    Phase::SelectorFileSync,
    Phase::BeforeSelection,
];

fn check_preselection_faults(native: bool) {
    for (index, phase) in PRESELECTION.into_iter().enumerate() {
        let (_temporary, lease, initial) = fixture();
        let old = old_selection(&lease);
        let old_bytes = fs::read(&old).unwrap();
        let root = lease.root().to_path_buf();
        let candidate = sealed(&lease, 2);
        let database = candidate.database_path().to_path_buf();
        let mut adapter = TestAdapter {
            native,
            fault: Some(phase),
            ..Default::default()
        };
        drop(initial);
        drop(lease);
        let failure = publish_with(
            candidate,
            PublicationMode::Replace { expected: id(1) },
            &mut adapter,
        )
        .unwrap_err();
        assert_eq!(
            failure.stage(),
            PublicationStage::BeforeSelection,
            "{phase:?}"
        );
        assert!(!matches!(failure.error(), RegistryError::OutcomeUnknown(_)));
        assert_eq!(adapter.phases, PRESELECTION[..=index]);
        assert_eq!(adapter.selections, 0);
        assert_eq!(
            fs::read(root.join(selector::ACTIVE)).unwrap(),
            selector::encode(id(1))
        );
        assert_eq!(fs::read(&old).unwrap(), old_bytes);
        assert_owned(&root, &database);
        let evidence = temporaries(&root);
        assert_eq!(evidence.len(), usize::from(index >= 4), "{phase:?}");
        let expected = if phase == Phase::SelectorWrite {
            Vec::new()
        } else {
            selector::encode(id(2)).to_vec()
        };
        if let Some(path) = evidence.first() {
            assert_eq!(fs::read(path).unwrap(), expected);
        }
        drop(failure);
        assert!(database.exists());
        assert!(old.exists());
        assert_eq!(temporaries(&root), evidence);
        let _lease = LocationLease::acquire(&root).unwrap();
        let _store = Store::open(&database, limits()).unwrap();
    }
}

#[test]
fn model_preselection_phase_faults_preserve_storage_and_failure_ownership() {
    check_preselection_faults(false);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn native_preselection_phase_faults_preserve_storage_and_failure_ownership() {
    check_preselection_faults(true);
}

#[test]
fn short_selector_write_reports_write_zero_and_preserves_partial_evidence() {
    let (_temporary, lease, _initial) = fixture();
    let old = old_selection(&lease);
    let mut adapter = TestAdapter {
        short_write: true,
        ..Default::default()
    };
    let failure = publish_with(
        sealed(&lease, 2),
        PublicationMode::Replace { expected: id(1) },
        &mut adapter,
    )
    .unwrap_err();
    assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
    match failure.error() {
        RegistryError::Storage(error) => assert_eq!(
            error.downcast_ref::<io::Error>().unwrap().kind(),
            io::ErrorKind::WriteZero
        ),
        error => panic!("expected WriteZero, got {error:?}"),
    }
    assert_eq!(adapter.selections, 0);
    assert_eq!(selector::read(&lease).unwrap(), id(1));
    let evidence = temporaries(lease.root());
    assert_eq!(evidence.len(), 1);
    assert_eq!(
        fs::read(&evidence[0]).unwrap(),
        selector::encode(id(2))[..7]
    );
    assert!(old.exists());
    drop(failure);
    assert!(evidence[0].exists());
}

#[test]
fn identity_directory_database_and_legacy_name_mismatches_are_rejected() {
    for mismatch in 0..4 {
        let (_temporary, lease, initial) = fixture();
        let mut candidate = if mismatch == 3 {
            PreparedGeneration::create_named_for_test(&lease, Path::new("legacy-name"), limits())
                .unwrap()
                .seal()
                .unwrap()
        } else {
            sealed(&lease, 2)
        };
        let physical_database = candidate.database_path().to_path_buf();
        match mismatch {
            0 => candidate.generation.id = id(3),
            1 => candidate.generation.directory = lease.root().join("wrong"),
            2 => candidate.generation.database = lease.root().join("wrong.sqlite"),
            _ => {}
        }
        let mut adapter = TestAdapter::default();
        let failure =
            publish_with(candidate, PublicationMode::First(initial), &mut adapter).unwrap_err();
        assert!(matches!(failure.error(), RegistryError::InvalidInput(_)));
        assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
        assert!(adapter.phases.is_empty());
        assert!(physical_database.exists());
        assert!(!lease.root().join(selector::ACTIVE).exists());
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn native_selection_and_postselection_faults_are_unknown_without_retry_or_cleanup() {
    for fault in 0..4 {
        let (_temporary, lease, initial) = fixture();
        let old = old_selection(&lease);
        let old_bytes = fs::read(&old).unwrap();
        let candidate = sealed(&lease, 2);
        let database = candidate.database_path().to_path_buf();
        let root = lease.root().to_path_buf();
        let mut adapter = TestAdapter {
            native: true,
            selection_error: fault == 0,
            fault: match fault {
                1 => Some(Phase::AfterSelection),
                2 => Some(Phase::FinalDirectorySync),
                _ => None,
            },
            final_barrier_error: fault == 3,
            ..Default::default()
        };
        drop(initial);
        drop(lease);
        let failure = publish_with(
            candidate,
            PublicationMode::Replace { expected: id(1) },
            &mut adapter,
        )
        .unwrap_err();
        assert!(matches!(failure.error(), RegistryError::OutcomeUnknown(_)));
        match failure.diagnostic_cause() {
            RegistryError::Storage(error) => {
                let error = error.downcast_ref::<io::Error>().unwrap();
                assert_eq!(error.kind(), io::ErrorKind::Other);
                assert_eq!(
                    error.to_string(),
                    match fault {
                        0 => "injected selection failure",
                        1 => "injected AfterSelection",
                        2 => "injected FinalDirectorySync",
                        _ => "injected final directory barrier",
                    }
                );
            }
            error => panic!("expected retained I/O failure, got {error:?}"),
        }
        assert_eq!(failure.stage(), PublicationStage::SelectionAttempted);
        assert_eq!(adapter.selections, 1);
        assert_eq!(
            fs::read(root.join(selector::ACTIVE)).unwrap(),
            selector::encode(id(if fault == 0 { 1 } else { 2 }))
        );
        assert_eq!(fs::read(&old).unwrap(), old_bytes);
        assert_eq!(temporaries(&root).len(), usize::from(fault == 0));
        assert_owned(&root, &database);
        drop(failure);
        assert!(old.exists());
        assert!(database.exists());
        assert_eq!(adapter.selections, 1);
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn native_exclusive_selection_cannot_overwrite_destination_appearing_at_call() {
    let (_temporary, lease, initial) = fixture();
    let active = lease.root().join(selector::ACTIVE);
    let mut adapter = TestAdapter {
        native: true,
        unexpected_at_select: Some(active.clone()),
        ..Default::default()
    };
    let failure = publish_with(
        sealed(&lease, 2),
        PublicationMode::First(initial),
        &mut adapter,
    )
    .unwrap_err();
    assert!(matches!(failure.error(), RegistryError::OutcomeUnknown(_)));
    match failure.diagnostic_cause() {
        RegistryError::Storage(error) => {
            let error = error.downcast_ref::<io::Error>().unwrap();
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
            assert_eq!(error.raw_os_error(), Some(libc::EEXIST));
        }
        error => panic!("expected retained native selection error, got {error:?}"),
    }
    assert_eq!(adapter.selections, 1);
    assert_eq!(fs::read(active).unwrap(), b"unexpected destination");
    assert_eq!(temporaries(lease.root()).len(), 1);
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn native_first_and_replacement_open_typed_ready_and_retain_lease_until_drop() {
    for replacement in [false, true] {
        let (_temporary, lease, initial) = fixture();
        let old = replacement.then(|| old_selection(&lease));
        let old_bytes = old.as_ref().map(|path| fs::read(path).unwrap());
        let mode = if replacement {
            drop(initial);
            PublicationMode::Replace { expected: id(1) }
        } else {
            PublicationMode::First(initial)
        };
        let candidate = sealed(&lease, 2);
        let database = candidate.database_path().to_path_buf();
        let root = lease.root().to_path_buf();
        let mut adapter = TestAdapter {
            native: true,
            ..Default::default()
        };
        drop(lease);
        let published: PublishedGeneration = publish_with(candidate, mode, &mut adapter).unwrap();
        assert_eq!(published.id(), id(2));
        assert_owned(&root, &database);
        assert_eq!(adapter.selections, 1);
        assert_eq!(
            adapter.phases,
            [
                PRESELECTION.as_slice(),
                &[Phase::AfterSelection, Phase::FinalDirectorySync]
            ]
            .concat()
        );
        assert_eq!(
            adapter.directories,
            [
                database.parent().unwrap().to_path_buf(),
                root.clone(),
                root.parent().unwrap().to_path_buf(),
                root.clone()
            ]
        );
        assert!(temporaries(&root).is_empty());
        let ready: ReadyGeneration = published.open(limits()).unwrap();
        assert_eq!(ready.generation.id, id(2));
        assert_owned(&root, &database);
        if let Some(old) = &old {
            assert_eq!(fs::read(old).unwrap(), old_bytes.unwrap());
            let _old_store = Store::open(old, limits()).unwrap();
        }
        drop(ready);
        let lease = LocationLease::acquire(&root).unwrap();
        assert_eq!(selector::read(&lease).unwrap(), id(2));
        let _store = Store::open(&database, limits()).unwrap();
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn confirmed_publication_changed_selection_is_recovery_not_unknown() {
    let (_temporary, lease, initial) = fixture();
    let old = old_selection(&lease);
    let root = lease.root().to_path_buf();
    let database = id(2).database_path(&lease);
    drop(initial);
    let published = publish_with(
        sealed(&lease, 2),
        PublicationMode::Replace { expected: id(1) },
        &mut NativeCandidate,
    )
    .unwrap();
    fs::write(root.join(selector::ACTIVE), selector::encode(id(1))).unwrap();
    drop(lease);
    let failure = published.open(limits()).unwrap_err();
    assert!(matches!(
        failure.error(),
        RegistryError::RecoveryRequired(_)
    ));
    assert_eq!(failure.database_path(), database);
    assert!(failure._ownership.is_some());
    assert_owned(&root, &database);
    assert_eq!(
        fs::read(root.join(selector::ACTIVE)).unwrap(),
        selector::encode(id(1))
    );
    assert!(old.exists());
    drop(failure);
    let _lease = LocationLease::acquire(&root).unwrap();
    let _store = Store::open(&database, limits()).unwrap();
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn selected_database_readiness_failure_preserves_selection_without_fallback() {
    for table in ["registry_metadata", "host_settings"] {
        let (_temporary, lease, initial) = fixture();
        let old = old_selection(&lease);
        let root = lease.root().to_path_buf();
        let database = id(2).database_path(&lease);
        drop(initial);
        let published = publish_with(
            sealed(&lease, 2),
            PublicationMode::Replace { expected: id(1) },
            &mut NativeCandidate,
        )
        .unwrap();
        // External mutation models corruption after confirmed publication. The
        // connection is explicitly closed before the controlled readiness open.
        let connection = Connection::open(&database).unwrap();
        connection
            .execute(&format!("DELETE FROM {table}"), [])
            .unwrap();
        connection.close().unwrap();
        drop(lease);
        let failure = published.open(limits()).unwrap_err();
        assert!(matches!(
            failure.error(),
            RegistryError::RecoveryRequired(_)
        ));
        match failure.diagnostic_cause() {
            RegistryError::RecoveryRequired(message) => {
                if table == "host_settings" {
                    assert_eq!(message, "missing required host_settings singleton");
                } else {
                    assert!(
                        message.starts_with("registry validation failed:"),
                        "{message}"
                    );
                }
                assert!(!message.contains("published generation failed readiness"));
            }
            error => panic!("expected retained readiness validation error, got {error:?}"),
        }
        assert_eq!(failure.database_path(), database);
        assert!(failure._ownership.is_none());
        assert!(LocationLease::acquire(&root).is_err());
        assert_eq!(
            fs::read(root.join(selector::ACTIVE)).unwrap(),
            selector::encode(id(2))
        );
        assert!(old.exists());
        assert!(database.exists());
        assert!(temporaries(&root).is_empty());
        drop(failure);
        let lease = LocationLease::acquire(&root).unwrap();
        assert_eq!(selector::read(&lease).unwrap(), id(2));
        let _old_store = Store::open(&old, limits()).unwrap();
    }
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
#[test]
fn native_exclusive_selection_preserves_symlink_appearing_at_call() {
    for dangling in [false, true] {
        let (_temporary, lease, initial) = fixture();
        let target = lease.root().join("unexpected-target");
        if !dangling {
            fs::write(&target, b"preserve target").unwrap();
        }
        let active = lease.root().join(selector::ACTIVE);
        let mut adapter = TestAdapter {
            native: true,
            symlink_at_select: Some(target.clone()),
            ..Default::default()
        };
        let failure = publish_with(
            sealed(&lease, 2),
            PublicationMode::First(initial),
            &mut adapter,
        )
        .unwrap_err();
        assert!(matches!(failure.error(), RegistryError::OutcomeUnknown(_)));
        assert_eq!(failure.stage(), PublicationStage::SelectionAttempted);
        assert_eq!(adapter.selections, 1);
        assert_eq!(fs::read_link(active).unwrap(), target);
        if dangling {
            assert!(!target.exists());
        } else {
            assert_eq!(fs::read(target).unwrap(), b"preserve target");
        }
        let evidence = temporaries(lease.root());
        assert_eq!(evidence.len(), 1);
        assert_eq!(fs::read(&evidence[0]).unwrap(), selector::encode(id(2)));
        drop(failure);
        assert!(evidence[0].exists());
    }
}

#[cfg(windows)]
#[test]
fn windows_native_candidate_is_unsupported_without_fabricated_publication() {
    let (_temporary, lease, initial) = fixture();
    let failure = publish_with(
        sealed(&lease, 2),
        PublicationMode::First(initial),
        &mut NativeCandidate,
    )
    .unwrap_err();
    assert_eq!(failure.stage(), PublicationStage::BeforeSelection);
    match failure.error() {
        RegistryError::Storage(error) => assert_eq!(
            error.downcast_ref::<io::Error>().unwrap().kind(),
            io::ErrorKind::Unsupported
        ),
        error => panic!("expected Unsupported, got {error:?}"),
    }
    assert!(!lease.root().join(selector::ACTIVE).exists());
    assert!(temporaries(lease.root()).is_empty());
    assert_eq!(
        NativeCandidate
            .select(
                &lease.root().join("missing.tmp"),
                &lease.root().join(selector::ACTIVE),
                false
            )
            .unwrap_err()
            .kind(),
        io::ErrorKind::Unsupported
    );
    assert!(matches!(
        platform::production_preflight(&lease),
        Err(RegistryError::Unavailable(_))
    ));
}
