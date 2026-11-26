//! Abstract cache-aware crash campaign for the actual `publish_with` orchestration.
//!
//! This is a test model, not native filesystem/device power-loss qualification.
//! It does not qualify APFS, ext4, NTFS, Windows, a mount configuration, or hardware.
//! All fixture writes and reconstructed images live in separate `tempfile` directories.
//! No process is killed, no machine is restarted, and no device cache is forcibly invalidated.
//!
//! Objects have stable identities. Directory entries and file contents have separate
//! volatile and durable states. File sync commits bytes only. Directory sync commits
//! that directory's immediate namespace only, never child entries or file contents.
//! Selection moves the temporary selector's identity, not a copy of its bytes. The
//! real fixture rename supplies visibility to production validation, not persistence
//! evidence. Replacement removes the fixture destination first for Windows portability;
//! this is explicitly NOT an implementation or test of native atomic replacement.
//!
//! At entry the stable parent exists. First creation's root entry is not durable.
//! Replacement's valid old registry is captured and persisted BEFORE new preparation.
//! New sealed database bytes are already durable, as required by checked sealing;
//! their new generation/database directory entries are not. Empty sealed sidecars
//! and lock files are included, not deleted or interpreted as selection authority.
//! These tests do not simulate SQLite sealing faults or later ordinary transactions.
//!
//! Each observed boundary is an independent crash, including acknowledged success.
//! There are exactly 18 bounded persistence scenarios per image: three namespace
//! choices (durable only, early root namespace, all early namespaces), crossed with
//! six byte choices (durable only; unsynced prefixes of 1, 31, 63, or 64 bytes;
//! or a full-length record with only its first 31 bytes persisted and a zero tail).
//! Only dirty file bytes can tear. Completed barriers cannot roll back. Early
//! namespace persistence can precede data persistence, but is atomic per directory
//! in this model. These are representative reorderings, NOT all possible subsets,
//! sector tears, metadata corruption, allocation failures, or device behaviors.
//! Crashes are reconstructed from model state, never from the host's caches.
//! Real selector reads/layout validation and `Store::open` assess each reconstruction.
//! Missing/invalid metadata is recovery, with no generation scanning or fallback.

use super::*;
use crate::plugin_integrity::IntegrityLimits;
use std::collections::BTreeMap;

const ROOT: &str = "registry";
const SCENARIOS: usize = 18;
type ObjectId = usize;
type Entries = BTreeMap<String, ObjectId>;

#[derive(Clone, Debug)]
enum Object {
    Directory { live: Entries, durable: Entries },
    File { live: Vec<u8>, durable: Vec<u8> },
}

#[derive(Clone, Debug)]
struct Storage {
    // Object zero is the stable parent. Unreachable objects remain available as
    // evidence but are not materialized by a crash or used as fallback storage.
    objects: Vec<Object>,
}

impl Storage {
    fn new() -> Self {
        Self {
            objects: vec![Object::Directory {
                live: Entries::new(),
                durable: Entries::new(),
            }],
        }
    }

    fn entries(&self, id: ObjectId) -> &Entries {
        match &self.objects[id] {
            Object::Directory { live, .. } => live,
            Object::File { .. } => panic!("expected directory object"),
        }
    }

    fn entries_mut(&mut self, id: ObjectId) -> &mut Entries {
        match &mut self.objects[id] {
            Object::Directory { live, .. } => live,
            Object::File { .. } => panic!("expected directory object"),
        }
    }

    fn resolve(&self, relative: &Path) -> ObjectId {
        let mut id = 0;
        for component in relative.components() {
            let Component::Normal(name) = component else {
                panic!("model paths must be relative normal components");
            };
            id = self.entries(id)[name.to_str().unwrap()];
        }
        id
    }

    // Import a newly prepared tree. File bytes have passed sealing, but none of
    // this tree's new namespace edges have passed publication barriers yet.
    fn import_sealed(&mut self, parent: ObjectId, path: &Path) -> ObjectId {
        let metadata = fs::symlink_metadata(path).unwrap();
        let object = if metadata.is_dir() {
            Object::Directory {
                live: Entries::new(),
                durable: Entries::new(),
            }
        } else {
            assert!(metadata.is_file());
            let bytes = fs::read(path).unwrap();
            // Sealing guarantees the DB; the other fixture files must be empty.
            if path.file_name().unwrap() != "registry.sqlite"
                && path.file_name().unwrap() != selector::ACTIVE
            {
                assert!(bytes.is_empty(), "unexpected nonempty sealed sidecar");
            }
            Object::File {
                live: bytes.clone(),
                durable: bytes,
            }
        };
        let id = self.objects.len();
        self.objects.push(object);
        let name = path.file_name().unwrap().to_str().unwrap().to_owned();
        assert!(self.entries_mut(parent).insert(name, id).is_none());
        if metadata.is_dir() {
            let mut children: Vec<_> = fs::read_dir(path)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .collect();
            children.sort();
            for child in children {
                self.import_sealed(id, &child);
            }
        }
        id
    }

    fn sync_directory(&mut self, id: ObjectId) {
        let Object::Directory { live, durable } = &mut self.objects[id] else {
            panic!("directory sync on file");
        };
        durable.clone_from(live);
    }

    fn sync_file(&mut self, id: ObjectId) {
        let Object::File { live, durable } = &mut self.objects[id] else {
            panic!("file sync on directory");
        };
        durable.clone_from(live);
    }

    fn persist_baseline(&mut self) {
        for object in &mut self.objects {
            match object {
                Object::Directory { live, durable } => durable.clone_from(live),
                Object::File { live, durable } => durable.clone_from(live),
            }
        }
    }

    fn write(&mut self, id: ObjectId, bytes: &[u8]) {
        let Object::File { live, .. } = &mut self.objects[id] else {
            panic!("write on directory");
        };
        live.clear();
        live.extend_from_slice(bytes);
    }

    fn materialize(&self, id: ObjectId, path: &Path, namespace: usize, bytes: usize) {
        match &self.objects[id] {
            Object::Directory { live, durable } => {
                // The image's stable parent is supplied by tempfile, not created here.
                if id != 0 {
                    fs::create_dir(path).unwrap();
                }
                let early =
                    namespace == 2 || (namespace == 1 && id == self.resolve(Path::new(ROOT)));
                for (name, child) in if early { live } else { durable } {
                    self.materialize(*child, &path.join(name), namespace, bytes);
                }
            }
            Object::File { live, durable } => {
                let mut persisted = durable.clone();
                if live != durable && bytes != 0 {
                    let count = [0, 1, 31, 63, 64, 31][bytes].min(live.len());
                    persisted = live[..count].to_vec();
                    if bytes == 5 {
                        persisted.resize(live.len(), 0);
                    }
                }
                fs::write(path, persisted).unwrap();
            }
        }
    }
}

#[derive(Clone, Debug)]
struct Boundary {
    label: String,
    storage: Storage,
    selected: bool,
    acknowledged: bool,
}

struct CacheAdapter {
    parent: PathBuf,
    storage: Storage,
    phase: Phase,
    omit: Option<Phase>,
    temporary: Option<ObjectId>,
    selected: bool,
    boundaries: Vec<Boundary>,
}

impl CacheAdapter {
    fn observe(&mut self, label: impl Into<String>, acknowledged: bool) {
        self.boundaries.push(Boundary {
            label: label.into(),
            storage: self.storage.clone(),
            selected: self.selected,
            acknowledged,
        });
    }

    fn discover_temporary(&mut self) {
        let paths: Vec<_> = fs::read_dir(self.parent.join(ROOT))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|extension| extension == "tmp"))
            .collect();
        assert_eq!(paths.len(), 1);
        assert!(fs::read(&paths[0]).unwrap().is_empty());
        let root = self.storage.resolve(Path::new(ROOT));
        let id = self.storage.objects.len();
        self.storage.objects.push(Object::File {
            live: Vec::new(),
            durable: Vec::new(),
        });
        let name = paths[0].file_name().unwrap().to_str().unwrap().to_owned();
        assert!(self.storage.entries_mut(root).insert(name, id).is_none());
        self.temporary = Some(id);
        self.observe("after temporary creation", false);
    }
}

impl Adapter for CacheAdapter {
    fn at(&mut self, phase: Phase) -> io::Result<()> {
        self.phase = phase;
        if phase == Phase::SelectorWrite {
            self.discover_temporary();
        }
        self.observe(format!("at {phase:?}"), false);
        Ok(())
    }

    fn sync_directory(&mut self, path: &Path) -> io::Result<()> {
        self.observe(format!("before {:?} barrier", self.phase), false);
        let id = self
            .storage
            .resolve(path.strip_prefix(&self.parent).unwrap());
        if self.omit != Some(self.phase) {
            self.storage.sync_directory(id);
        }
        self.observe(format!("after {:?} barrier", self.phase), false);
        Ok(())
    }

    fn write_record(&mut self, file: &mut File, record: &[u8]) -> io::Result<()> {
        assert_eq!(record.len(), 64);
        let id = self.temporary.unwrap();
        self.observe("before selector write", false);
        file.write_all(&record[..31])?;
        self.storage.write(id, &record[..31]);
        self.observe("after selector write prefix", false);
        file.write_all(&record[31..])?;
        self.storage.write(id, record);
        self.observe("after selector write", false);
        Ok(())
    }

    fn sync_file(&mut self, _file: &File) -> io::Result<()> {
        self.observe("before selector file sync", false);
        if self.omit != Some(Phase::SelectorFileSync) {
            self.storage.sync_file(self.temporary.unwrap());
        }
        self.observe("after selector file sync", false);
        Ok(())
    }

    fn select(&mut self, temporary: &Path, active: &Path, replace: bool) -> io::Result<()> {
        self.observe("before selector move", false);
        let root = self.storage.resolve(Path::new(ROOT));
        let name = temporary.file_name().unwrap().to_str().unwrap();
        let id = self.storage.entries(root)[name];
        assert_eq!(Some(id), self.temporary);
        assert_eq!(
            self.storage.entries(root).contains_key(selector::ACTIVE),
            replace
        );
        if replace {
            // Visibility simulation only. Never use this as a native replacement recipe.
            fs::remove_file(active)?;
        } else {
            assert!(!active.exists());
        }
        fs::rename(temporary, active)?;
        self.storage.entries_mut(root).remove(name).unwrap();
        self.storage
            .entries_mut(root)
            .insert(selector::ACTIVE.into(), id);
        assert_eq!(self.storage.entries(root)[selector::ACTIVE], id);
        self.selected = true;
        self.observe("after selector move", false);
        Ok(())
    }
}

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

fn sealed(lease: &LocationLease, byte: u8) -> SealedGeneration {
    PreparedGeneration::create_id(lease, id(byte), limits())
        .unwrap()
        .seal()
        .unwrap()
}

fn campaign(replace: bool, omit: Option<Phase>) -> Vec<Boundary> {
    let fixture = tempfile::tempdir().unwrap();
    let lease = LocationLease::acquire(&fixture.path().join(ROOT)).unwrap();
    let initial = InitialRoot::claim_for_test(&lease).unwrap();
    let mut storage = Storage::new();
    let mode = if replace {
        let old = sealed(&lease, 1);
        drop(old);
        fs::write(lease.root().join(selector::ACTIVE), selector::encode(id(1))).unwrap();
        assert_eq!(selector::read(&lease).unwrap(), id(1));
        drop(Store::open(&id(1).database_path(&lease), limits()).unwrap());
        storage.import_sealed(0, lease.root());
        storage.persist_baseline();
        // Crucially this snapshot predates any new generation directory or file.
        assert!(!id(2).directory(&lease).exists());
        drop(initial);
        PublicationMode::Replace { expected: id(1) }
    } else {
        storage.import_sealed(0, lease.root());
        PublicationMode::First(initial)
    };
    let new = sealed(&lease, 2);
    let root = storage.resolve(Path::new(ROOT));
    storage.import_sealed(root, new.directory());
    let mut adapter = CacheAdapter {
        parent: lease.root().parent().unwrap().to_path_buf(),
        storage,
        phase: Phase::GenerationDirectory,
        omit,
        temporary: None,
        selected: false,
        boundaries: Vec::new(),
    };
    adapter.observe("campaign entry after checked sealing", false);
    let published = publish_with(new, mode, &mut adapter).unwrap();
    assert_eq!(published.id(), id(2));
    adapter.observe("acknowledged publication success", true);
    // Fixture visibility/readiness is checked separately from durable images.
    drop(published.open(limits()).unwrap());
    assert_eq!(adapter.boundaries.len(), 27);
    adapter.boundaries
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Outcome {
    AbsentRoot,
    Recovery,
    Ready(GenerationId),
}

fn inspect(boundary: &Boundary, namespace: usize, bytes: usize) -> Outcome {
    let image = tempfile::tempdir().unwrap();
    boundary
        .storage
        .materialize(0, image.path(), namespace, bytes);
    let root = image.path().join(ROOT);
    if !root.exists() {
        return Outcome::AbsentRoot;
    }
    let lease = LocationLease::acquire(&root).unwrap();
    let Ok(selected) = selector::read(&lease) else {
        return Outcome::Recovery;
    };
    let Ok(database) = selector::validate_generation(&lease, selected) else {
        return Outcome::Recovery;
    };
    match Store::open(&database, limits()) {
        Ok(store) => {
            drop(store);
            Outcome::Ready(selected)
        }
        Err(_) => Outcome::Recovery,
    }
}

fn check_campaign(replace: bool) {
    let boundaries = campaign(replace, None);
    let mut checked = 0;
    for boundary in &boundaries {
        for namespace in 0..3 {
            for bytes in 0..6 {
                let outcome = inspect(boundary, namespace, bytes);
                let valid = if boundary.acknowledged {
                    outcome == Outcome::Ready(id(2))
                } else if !boundary.selected {
                    if replace {
                        outcome == Outcome::Ready(id(1))
                    } else {
                        matches!(outcome, Outcome::AbsentRoot | Outcome::Recovery)
                    }
                } else if replace {
                    matches!(outcome, Outcome::Ready(selected) if selected == id(1) || selected == id(2))
                } else {
                    matches!(outcome, Outcome::AbsentRoot | Outcome::Recovery)
                        || outcome == Outcome::Ready(id(2))
                };
                assert!(
                    valid,
                    "{}: namespace={namespace}, bytes={bytes}, outcome={outcome:?}",
                    boundary.label
                );
                checked += 1;
            }
        }
    }
    assert_eq!(checked, 27 * SCENARIOS);
    // This distinguishes lost unsynced selection from early namespace persistence.
    let moved = boundaries
        .iter()
        .find(|boundary| boundary.label == "after selector move")
        .unwrap();
    assert_eq!(
        inspect(moved, 0, 0),
        if replace {
            Outcome::Ready(id(1))
        } else {
            Outcome::Recovery
        }
    );
    assert_eq!(inspect(moved, 2, 0), Outcome::Ready(id(2)));
}

#[test]
fn first_creation_crash_images_at_every_boundary() {
    check_campaign(false);
}

#[test]
fn replacement_crash_images_at_every_boundary() {
    check_campaign(true);
}

fn missing_barrier(replace: bool, phase: Phase, expected: Outcome) {
    let boundaries = campaign(replace, Some(phase));
    let acknowledged = boundaries.last().unwrap();
    assert!(acknowledged.acknowledged);
    let outcome = inspect(acknowledged, 0, 0);
    assert_eq!(
        outcome, expected,
        "omitted {phase:?}, replacement={replace}"
    );
    assert_ne!(
        outcome,
        Outcome::Ready(id(2)),
        "negative control must break acknowledgment"
    );
}

#[test]
fn missing_generation_file_entry_barrier_breaks_acknowledgment() {
    for replace in [false, true] {
        missing_barrier(replace, Phase::GenerationDirectory, Outcome::Recovery);
    }
}

#[test]
fn missing_selector_file_sync_breaks_acknowledgment() {
    for replace in [false, true] {
        missing_barrier(replace, Phase::SelectorFileSync, Outcome::Recovery);
    }
}

#[test]
fn missing_first_stable_parent_barrier_breaks_acknowledgment() {
    missing_barrier(false, Phase::StableParent, Outcome::AbsentRoot);
}

#[test]
fn missing_final_root_sync_breaks_acknowledgment() {
    missing_barrier(false, Phase::FinalDirectorySync, Outcome::Recovery);
    missing_barrier(true, Phase::FinalDirectorySync, Outcome::Ready(id(1)));
}

#[test]
fn unsynced_selector_prefix_and_reordered_namespace_controls_are_not_vacuous() {
    for replace in [false, true] {
        let boundaries = campaign(replace, Some(Phase::SelectorFileSync));
        let acknowledged = boundaries.last().unwrap();
        for bytes in 0..6 {
            let expected = if bytes == 4 {
                Outcome::Ready(id(2))
            } else {
                Outcome::Recovery
            };
            assert_eq!(
                inspect(acknowledged, 2, bytes),
                expected,
                "byte scenario {bytes}"
            );
        }
        // A directory barrier must not accidentally make the selector bytes durable.
        assert_eq!(inspect(acknowledged, 0, 0), Outcome::Recovery);
    }
}
