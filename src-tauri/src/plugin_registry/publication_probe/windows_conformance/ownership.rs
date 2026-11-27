//! Private ownership evidence. Unknown objects are never recursively removed.
use super::*;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs, path::PathBuf};

const RECEIPT: &str = "ownership.json";
use cleanup_protocol::GUARD;
const SCHEMA: u32 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Identity {
    v: u32,
    f: u64,
    c: u64,
    d: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    p: String,
    i: Identity,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    version: u32,
    run: String,
    user: Vec<u8>,
    temp: Identity,
    entries: Vec<Entry>,
    attempted: u32,
    objects: usize,
    written: u64,
    #[serde(default)]
    cleanup_started: bool,
}

pub(super) struct Run {
    root: PathBuf,
    receipt: Receipt,
    // Exclusive sharing is kernel-enforced across independent controllers.
    // None is allowed only after admission has been irrevocably retired for
    // final root removal. Every other worker opens an EXISTING guard only.
    guard: Option<File>,
}

fn acquire_guard(path: &Path, disposition: u32) -> Result<File> {
    let file = open(
        path,
        GENERIC_READ | GENERIC_WRITE | DELETE,
        0,
        disposition,
        0,
    )
    .map_err(|mut error| {
        error.context = if disposition == OPEN_EXISTING
            && matches!(
                error.code,
                Some(windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND)
                    | Some(windows_sys::Win32::Foundation::ERROR_PATH_NOT_FOUND)
            ) {
            "operator intervention required: run admission guard missing"
        } else {
            "run admission guard unavailable"
        };
        error
    })?;
    if identity(&file)?.d {
        return Err(refuse("run admission guard type"));
    }
    Ok(file)
}

fn identity(file: &File) -> Result<Identity> {
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(raw(file), &mut info) } == 0 {
        return Err(native_error("fixture identity query"));
    }
    let kind = unsafe { GetFileType(raw(file)) };
    // FILE_TYPE_UNKNOWN has a last-error contract, but every non-disk type is
    // refused without needing to expose that potentially stale last error.
    if kind != FILE_TYPE_DISK || info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err(refuse("reparse or non-disk fixture object"));
    }
    let directory = info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    if !directory && info.nNumberOfLinks != 1 {
        return Err(refuse("fixture link count"));
    }
    let id = (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow);
    if id == 0 {
        return Err(refuse("unavailable fixture identity"));
    }
    Ok(Identity {
        v: info.dwVolumeSerialNumber,
        f: id,
        c: (u64::from(info.ftCreationTime.dwHighDateTime) << 32)
            | u64::from(info.ftCreationTime.dwLowDateTime),
        d: directory,
    })
}

fn inspect(path: &Path) -> Result<Identity> {
    let file = open(
        path,
        FILE_READ_ATTRIBUTES,
        SHARE,
        OPEN_EXISTING,
        FILE_FLAG_BACKUP_SEMANTICS,
    )?;
    identity(&file)
}

fn open_receipt(path: &Path, access: u32, disposition: u32, flags: u32) -> Result<File> {
    open(path, access, SHARE, disposition, flags).map_err(|mut error| {
        if error.context == "private ownership CreateFileW" {
            error.context = "private receipt CreateFileW";
        }
        error
    })
}

fn location(run_id: &str) -> Result<(PathBuf, Identity)> {
    if !valid_run_id(run_id) {
        return Err(refuse("invalid run ID"));
    }
    let temp = fs::canonicalize(std::env::temp_dir())
        .map_err(|error| io_error("default temp resolution", error))?;
    let units = wide_path(&temp)?;
    // Only drive-letter paths (including canonical extended-length paths) are
    // accepted. UNC and device namespaces cannot become fixture roots.
    let drive = if units.len() >= 4 && units[1] == b':' as u16 && units[2] == b'\\' as u16 {
        &units[..3]
    } else if units.len() >= 8
        && units[..4] == [92, 92, 63, 92]
        && units[5] == b':' as u16
        && units[6] == b'\\' as u16
    {
        &units[4..7]
    } else {
        return Err(refuse("default temp is not a local drive path"));
    };
    if !((b'A' as u16..=b'Z' as u16).contains(&drive[0])
        || (b'a' as u16..=b'z' as u16).contains(&drive[0]))
    {
        return Err(refuse("default temp drive syntax"));
    }
    let mut volume = vec![0u16; MAX_PATH_UNITS];
    if unsafe { GetVolumePathNameW(units.as_ptr(), volume.as_mut_ptr(), volume.len() as u32) } == 0
    {
        return Err(native_error("temporary volume path query"));
    }
    if !volume.contains(&0) {
        return Err(refuse("temporary volume bounds"));
    }
    // DRIVE_FIXED is 3 in WinBase.h; windows-sys exposes it in System::WindowsProgramming,
    // which is deliberately not an additional feature dependency of this fixture.
    if unsafe { GetDriveTypeW(volume.as_ptr()) } != 3 {
        return Err(refuse("temporary volume is not fixed"));
    }
    let mut filesystem = [0u16; 32];
    if unsafe {
        GetVolumeInformationW(
            volume.as_ptr(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            filesystem.as_mut_ptr(),
            filesystem.len() as u32,
        )
    } == 0
    {
        return Err(native_error("temporary filesystem query"));
    }
    if filesystem[..5] != [78, 84, 70, 83, 0] {
        return Err(refuse("temporary filesystem is not NTFS"));
    }
    let temp_identity = inspect(&temp)?;
    if !temp_identity.d {
        return Err(refuse("default temp is not a directory"));
    }
    Ok((
        temp.join(format!("writers-ide-windows-conformance-{run_id}")),
        temp_identity,
    ))
}

// Every receipt path is selected from the fixed fixture vocabulary. A malformed
// private receipt must not turn cleanup into a caller-selected path operation.
fn allowed_path(path: &str, directory: bool) -> bool {
    if path.is_empty() {
        return directory;
    }
    if path == RECEIPT || path == GUARD {
        return !directory;
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.is_empty() || parts.len() > 5 {
        return false;
    }
    let case = parts[0];
    let Some(number) = case.strip_prefix("case") else {
        return false;
    };
    if number.len() != 2 || !number.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let Ok(index) = number.parse::<u8>() else {
        return false;
    };
    if index >= 20 {
        return false;
    }
    match &parts[1..] {
        [] => directory,
        ["control"] => !directory && index <= 2,
        ["source" | "active"] => !directory && index >= 9,
        ["stable"] | ["stable", "root"] => directory && (3..=8).contains(&index),
        ["stable", "root", "generation"] => directory && matches!(index, 3 | 4),
        ["stable", "root", "generation", "payload.bin"] => !directory && matches!(index, 3 | 4),
        ["stable", "root", "source" | "active"] => !directory && matches!(index, 5 | 6),
        _ => false,
    }
}

impl Run {
    pub(super) fn create(run_id: &str, user: Vec<u8>) -> Result<Self> {
        let (root, temp) = location(run_id)?;
        let root_wide = wide_path(&root)?;
        // No create_dir_all and no adoption of a preexisting run root.
        if unsafe { CreateDirectoryW(root_wide.as_ptr(), null()) } == 0 {
            return Err(native_error("exclusive run directory creation"));
        }
        let guard = acquire_guard(&root.join(GUARD), CREATE_NEW)?;
        let guard_identity = identity(&guard)?;
        let root_identity = inspect(&root)?;
        if !root_identity.d || root_identity.v != temp.v {
            return Err(refuse("run root identity or volume"));
        }
        let receipt_file = open_receipt(
            &root.join(RECEIPT),
            GENERIC_READ | GENERIC_WRITE,
            CREATE_NEW,
            0,
        )?;
        let receipt_identity = identity(&receipt_file)?;
        let mut run = Self {
            root,
            guard: Some(guard),
            receipt: Receipt {
                version: SCHEMA,
                run: run_id.to_owned(),
                user,
                temp,
                entries: vec![
                    Entry {
                        p: String::new(),
                        i: root_identity,
                    },
                    Entry {
                        p: RECEIPT.to_owned(),
                        i: receipt_identity,
                    },
                    Entry {
                        p: GUARD.to_owned(),
                        i: guard_identity,
                    },
                ],
                attempted: 0,
                objects: 3,
                written: 0,
                cleanup_started: false,
            },
        };
        drop(receipt_file);
        run.persist()?;
        run.verify()?;
        Ok(run)
    }

    pub(super) fn load(run_id: &str, user: Vec<u8>) -> Result<Self> {
        Self::load_with_mode(run_id, user, false)
    }

    pub(super) fn load_cleanup(run_id: &str, user: Vec<u8>) -> Result<Self> {
        Self::load_with_mode(run_id, user, true)
    }

    fn load_with_mode(run_id: &str, user: Vec<u8>, cleanup: bool) -> Result<Self> {
        let (root, temp) = location(run_id)?;
        let guard_path = root.join(GUARD);
        cleanup_protocol::with_run_lease(
            || acquire_guard(&guard_path, OPEN_EXISTING),
            |guard| {
                let guard_identity = identity(&guard)?;
                let root_identity = inspect(&root)?;
                if !root_identity.d || root_identity.v != temp.v {
                    return Err(refuse("run root identity or volume"));
                }
                let mut file = open_receipt(&root.join(RECEIPT), GENERIC_READ, OPEN_EXISTING, 0)
                    .map_err(|mut error| {
                        if matches!(
                            error.code,
                            Some(windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND)
                                | Some(windows_sys::Win32::Foundation::ERROR_PATH_NOT_FOUND)
                        ) {
                            error.context =
                                "operator intervention required: ownership receipt missing";
                        }
                        error
                    })?;
                let receipt_identity = identity(&file)?;
                if receipt_identity.d {
                    return Err(refuse("receipt is not a file"));
                }
                let mut bytes = Vec::new();
                (&mut file)
                    .take((MAX_RECEIPT + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map_err(|error| io_error("receipt read", error))?;
                if bytes.len() > MAX_RECEIPT {
                    return Err(refuse("receipt size bound"));
                }
                let receipt: Receipt = serde_json::from_slice(&bytes)
                    .map_err(|_| refuse("invalid private receipt"))?;
                if receipt.version != SCHEMA
                    || receipt.run != run_id
                    || receipt.user != user
                    || receipt.temp != temp
                    || receipt
                        .entries
                        .first()
                        .is_none_or(|entry| !entry.p.is_empty() || entry.i != root_identity)
                    || !receipt
                        .entries
                        .iter()
                        .any(|entry| entry.p == RECEIPT && entry.i == receipt_identity)
                    || !receipt
                        .entries
                        .iter()
                        .any(|entry| entry.p == GUARD && entry.i == guard_identity)
                {
                    return Err(refuse("receipt ownership mismatch"));
                }
                if !cleanup_protocol::case_admission_allowed(receipt.cleanup_started, cleanup) {
                    return Err(refuse("run cleanup already started"));
                }
                let run = Self {
                    root,
                    receipt,
                    guard: Some(guard),
                };
                run.verify_with_mode(cleanup && run.receipt.cleanup_started)?;
                Ok(run)
            },
        )
    }

    pub(super) fn path(&self, relative: &str) -> PathBuf {
        self.root.join(relative)
    }

    fn entry(&self, relative: &str) -> Result<&Entry> {
        self.receipt
            .entries
            .iter()
            .find(|entry| entry.p == relative)
            .ok_or_else(|| refuse("unrecorded fixture object"))
    }

    pub(super) fn open_owned(
        &self,
        relative: &str,
        access: u32,
        share: u32,
        flags: u32,
    ) -> Result<File> {
        if relative == GUARD {
            return Err(refuse("exclusive guard must use held handle"));
        }
        let expected = self.entry(relative)?;
        let file = if relative == RECEIPT {
            if share != SHARE {
                return Err(refuse("private receipt sharing parameters"));
            }
            open_receipt(&self.path(relative), access, OPEN_EXISTING, flags)?
        } else {
            open(&self.path(relative), access, share, OPEN_EXISTING, flags)?
        };
        if identity(&file)? != expected.i {
            return Err(refuse("fixture identity changed"));
        }
        Ok(file)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn open_case_owned(
        &self,
        relative: &str,
        access: u32,
        share: u32,
        flags: u32,
        calls: &mut Vec<Value>,
        stage: &'static str,
    ) -> Result<File> {
        if relative == GUARD || relative == RECEIPT {
            return Err(refuse("case open cannot access private ownership objects"));
        }
        let expected = self.entry(relative)?;
        let file = open_observed(
            &self.path(relative),
            access,
            share,
            OPEN_EXISTING,
            flags,
            Some((calls, relative, stage)),
        )?;
        if identity(&file)? != expected.i {
            return Err(refuse("case open identity changed"));
        }
        Ok(file)
    }

    pub(super) fn verify(&self) -> Result<()> {
        self.verify_with_mode(false).map(|_| ())
    }

    fn verify_with_mode(&self, allow_missing: bool) -> Result<BTreeSet<String>> {
        let receipt = &self.receipt;
        if receipt.entries.len() > MAX_OBJECTS
            || receipt.objects > MAX_OBJECTS
            || receipt.objects < receipt.entries.len()
            || receipt.written > MAX_PAYLOAD
            || receipt.attempted >> 20 != 0
        {
            return Err(refuse("receipt resource bounds"));
        }
        let mut paths = BTreeSet::new();
        let mut identities = BTreeSet::new();
        let mut present = BTreeSet::new();
        for entry in &receipt.entries {
            if !allowed_path(&entry.p, entry.i.d)
                || entry.i.v != receipt.temp.v
                || !paths.insert(entry.p.clone())
                || !identities.insert((entry.i.v, entry.i.f))
            {
                return Err(refuse("invalid receipt object set"));
            }
            if !entry.p.is_empty() && entry.p != RECEIPT && entry.p != GUARD {
                let index = entry.p[4..6]
                    .parse::<u8>()
                    .map_err(|_| refuse("invalid receipt case"))?;
                if receipt.attempted & (1 << index) == 0 {
                    return Err(refuse("unattempted receipt case"));
                }
            }
            // Never reopen the exclusive guard, including for identity queries.
            if entry.p == GUARD {
                let guard = self
                    .guard
                    .as_ref()
                    .ok_or_else(|| refuse("run admission guard not held"))?;
                if identity(guard)? != entry.i
                    || guard
                        .metadata()
                        .map_err(|error| io_error("guard size query", error))?
                        .len()
                        != 0
                {
                    return Err(refuse("run admission guard identity or size changed"));
                }
                present.insert(entry.p.clone());
                continue;
            }
            let file = match self.open_owned(
                &entry.p,
                FILE_READ_ATTRIBUTES,
                SHARE,
                FILE_FLAG_BACKUP_SEMANTICS,
            ) {
                Ok(file) => file,
                Err(error)
                    if allow_missing
                        && !entry.p.is_empty()
                        && entry.p != RECEIPT
                        && error.context == "private ownership CreateFileW"
                        && matches!(
                            error.code,
                            Some(windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND)
                                | Some(windows_sys::Win32::Foundation::ERROR_PATH_NOT_FOUND)
                        ) =>
                {
                    continue;
                }
                Err(error) => return Err(error),
            };
            present.insert(entry.p.clone());
            let length = file
                .metadata()
                .map_err(|error| io_error("fixture size query", error))?
                .len();
            let limit = if entry.p == RECEIPT {
                MAX_RECEIPT as u64
            } else {
                64
            };
            if !entry.i.d && length > limit {
                return Err(refuse("fixture file size bound"));
            }
        }
        // Enumerate one directory at a time and do not follow a directory entry.
        // At most one enumeration handle and one identity handle are live here.
        let mut seen = BTreeSet::from([String::new()]);
        for entry in &receipt.entries {
            if !entry.i.d || !present.contains(&entry.p) {
                continue;
            }
            let directory = self.open_owned(
                &entry.p,
                FILE_READ_ATTRIBUTES,
                SHARE,
                FILE_FLAG_BACKUP_SEMANTICS,
            )?;
            let children = fs::read_dir(self.path(&entry.p))
                .map_err(|error| io_error("fixture entry enumeration", error))?;
            for child in children {
                let child = child.map_err(|error| io_error("fixture entry enumeration", error))?;
                let name = child
                    .file_name()
                    .into_string()
                    .map_err(|_| refuse("unexpected fixture entry"))?;
                let relative = if entry.p.is_empty() {
                    name
                } else {
                    format!("{}/{name}", entry.p)
                };
                if !paths.contains(&relative)
                    || !seen.insert(relative.clone())
                    || seen.len() > MAX_OBJECTS
                {
                    return Err(refuse("unexpected fixture entry"));
                }
                let observed = if relative == GUARD {
                    identity(
                        self.guard
                            .as_ref()
                            .ok_or_else(|| refuse("run admission guard not held"))?,
                    )?
                } else {
                    inspect(&child.path())?
                };
                if observed != self.entry(&relative)?.i {
                    return Err(refuse("fixture identity changed"));
                }
            }
            drop(directory);
        }
        if seen != present {
            return Err(refuse("fixture changed during enumeration"));
        }
        cleanup_protocol::validate_snapshot(&paths, &present, allow_missing).map_err(refuse)?;
        Ok(present)
    }

    fn persist(&mut self) -> Result<()> {
        self.persist_bytes().map(|_| ())
    }

    fn persist_bytes(&mut self) -> Result<Vec<u8>> {
        // Account for every rewrite, not just the final receipt length. Reserving
        // before writing deliberately overcounts a short/failed write.
        let mut file = self.open_owned(RECEIPT, GENERIC_READ | GENERIC_WRITE, SHARE, 0)?;
        let previous_length = file
            .metadata()
            .map_err(|error| io_error("receipt size query", error))?
            .len();
        if previous_length > MAX_RECEIPT as u64 {
            return Err(refuse("receipt size bound"));
        }
        let previous = self.receipt.written;
        for _ in 0..4 {
            let bytes =
                serde_json::to_vec(&self.receipt).map_err(|_| refuse("receipt encoding"))?;
            let total = previous
                .checked_add((bytes.len() as u64).max(previous_length))
                .ok_or_else(|| refuse("payload bound"))?;
            if self.receipt.written == total {
                break;
            }
            self.receipt.written = total;
        }
        let mut bytes =
            serde_json::to_vec(&self.receipt).map_err(|_| refuse("receipt encoding"))?;
        // JSON permits trailing whitespace. Keep the existing extent when the
        // object list shrinks after rename, without adding a truncation API.
        bytes.resize(bytes.len().max(previous_length as usize), b' ');
        if bytes.len() > MAX_RECEIPT
            || self.receipt.written > MAX_PAYLOAD
            || self.receipt.written != previous + bytes.len() as u64
        {
            return Err(refuse("receipt or payload bound"));
        }
        file.seek(SeekFrom::Start(0))
            .map_err(|error| io_error("receipt seek", error))?;
        // One bounded synchronous write. Never repair a short receipt in place.
        let count = file
            .write(&bytes)
            .map_err(|error| io_error("receipt write", error))?;
        if count != bytes.len() {
            return Err(refuse("short receipt write"));
        }

        flush(&file).map_err(|code| Failure {
            invariant: false,
            context: "receipt flush",
            code: Some(code),
        })?;
        Ok(bytes)
    }

    pub(super) fn begin_case(&mut self, index: u8) -> Result<()> {
        if self.receipt.cleanup_started || index >= 20 || self.receipt.attempted & (1 << index) != 0
        {
            return Err(refuse("case already attempted or invalid"));
        }
        self.verify()?;
        self.receipt.attempted |= 1 << index;
        self.persist()?;
        self.directory(&format!("case{index:02}"))
    }

    fn can_create(&self, relative: &str, directory: bool) -> Result<()> {
        if relative == GUARD
            || relative == RECEIPT
            || !allowed_path(relative, directory)
            || self.receipt.objects >= MAX_OBJECTS
            || self.receipt.entries.iter().any(|entry| entry.p == relative)
        {
            return Err(refuse("fixture creation bounds"));
        }
        let parent = relative.rsplit_once('/').map_or("", |(parent, _)| parent);
        if !self.entry(parent)?.i.d {
            return Err(refuse("fixture parent type"));
        }
        self.verify()
    }

    fn record(&mut self, relative: &str, file: &File) -> Result<()> {
        let id = identity(file)?;
        if id.v != self.receipt.temp.v {
            return Err(refuse("fixture volume changed"));
        }
        self.receipt.objects += 1;
        self.receipt.entries.push(Entry {
            p: relative.to_owned(),
            i: id,
        });
        self.persist()
    }

    pub(super) fn directory(&mut self, relative: &str) -> Result<()> {
        self.can_create(relative, true)?;
        let path = wide_path(&self.path(relative))?;
        if unsafe { CreateDirectoryW(path.as_ptr(), null()) } == 0 {
            return Err(native_error("exclusive fixture directory creation"));
        }
        let file = open(
            &self.path(relative),
            FILE_READ_ATTRIBUTES,
            SHARE,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
        )?;
        if !identity(&file)?.d {
            return Err(refuse("created directory type"));
        }
        self.record(relative, &file)
    }

    pub(super) fn file(
        &mut self,
        relative: &str,
        bytes: &[u8],
        flags: u32,
        access: u32,
        calls: &mut Vec<Value>,
    ) -> Result<File> {
        if bytes.len() > 64 {
            return Err(refuse("fixture payload size"));
        }
        self.can_create(relative, false)?;
        if self.receipt.written + bytes.len() as u64 > MAX_PAYLOAD {
            return Err(refuse("payload bound"));
        }
        self.receipt.written += bytes.len() as u64;
        // Reserve payload before creating or writing the object.
        self.persist()?;
        let mut file = open_observed(
            &self.path(relative),
            access,
            SHARE,
            CREATE_NEW,
            flags,
            Some((calls, relative, "case payload creation")),
        )?;
        if identity(&file)?.d {
            return Err(refuse("created file type"));
        }
        self.record(relative, &file)?;
        let count = file
            .write(bytes)
            .map_err(|error| io_error("fixture payload write", error))?;
        if count != bytes.len() {
            return Err(invariant("short fixture payload write"));
        }
        Ok(file)
    }

    pub(super) fn check(
        &self,
        relative: &str,
        expected: &[u8; 64],
        calls: &mut Vec<Value>,
    ) -> Result<()> {
        let mut file =
            self.open_case_owned(relative, GENERIC_READ, SHARE, 0, calls, "selector readback")?;
        check_record(&mut file, expected)
    }

    pub(super) fn absent(&self, relative: &str) -> Result<()> {
        match inspect(&self.path(relative)) {
            Err(error)
                if error.code == Some(windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND) =>
            {
                Ok(())
            }
            Ok(_) => Err(invariant("source name remains after rename")),
            Err(error) => Err(error),
        }
    }

    pub(super) fn renamed(&mut self, source: &str, active: &str) -> Result<()> {
        let mut source_entry = self.entry(source)?.clone();
        if inspect(&self.path(active))? != source_entry.i {
            return Err(invariant("renamed selector identity mismatch"));
        }
        self.absent(source)?;
        self.receipt
            .entries
            .retain(|entry| entry.p != source && entry.p != active);
        source_entry.p = active.to_owned();
        self.receipt.entries.push(source_entry);
        // If interrupted between rename and receipt recording, later cleanup
        // refuses the stale receipt rather than adopting a name by inference.
        self.persist()?;
        self.verify()
    }

    pub(super) fn cleanup(mut self) -> Result<()> {
        // A valid ownership receipt and the original root must always exist.
        // Only cleanup of a persistently marked run may reconcile missing known
        // objects. Every present identity and every directory entry stays strict.
        let present = self.verify_with_mode(self.receipt.cleanup_started)?;
        self.receipt.cleanup_started = true;
        self.receipt
            .entries
            .retain(|entry| present.contains(&entry.p));
        // Checkpoint the cleanup marker/reconciliation before the first deletion.
        self.persist()?;
        let mut entries: Vec<_> = self
            .receipt
            .entries
            .iter()
            .filter(|entry| !entry.p.is_empty() && entry.p != RECEIPT && entry.p != GUARD)
            .map(|entry| entry.p.clone())
            .collect();
        entries.sort_by_key(|path| std::cmp::Reverse(path.split('/').count()));
        for path in entries {
            cleanup_protocol::remove_checkpointed(&mut self, &path)?;
        }
        self.verify()?;
        let mut finalization = FinalRootRecovery {
            run: &mut self,
            receipt_bytes: Vec::new(),
        };
        match cleanup_protocol::finalize_root(&mut finalization) {
            Ok(()) => Ok(()),
            Err(cleanup_protocol::FinalizationError::ReceiptRetained(error)) => Err(error),
            Err(cleanup_protocol::FinalizationError::RootRetained(mut error)) => {
                error.context = "final root removal failed; ownership receipt restored";
                Err(error)
            }
            Err(cleanup_protocol::FinalizationError::InterventionRequired(mut error)) => {
                error.context =
                    "operator intervention required: final cleanup ownership recovery failed";
                Err(error)
            }
        }
    }

    fn restore_final_receipt(&mut self, final_bytes: &[u8]) -> Result<()> {
        // The saved receipt contains the unchanged root identity and reserved
        // resource counters. Only the replacement receipt's identity may change.
        if final_bytes.len() > MAX_RECEIPT {
            return Err(refuse("final receipt memory bound"));
        }
        let mut receipt: Receipt = serde_json::from_slice(final_bytes)
            .map_err(|_| refuse("saved final receipt encoding"))?;
        if receipt.entries.len() != 3
            || !receipt.entries[0].p.is_empty()
            || receipt.entries[0].i != self.entry("")?.i
        {
            return Err(refuse("saved final root identity mismatch"));
        }
        // Admission is never recreated by load. Only this still-running final
        // recovery may create a fresh guard, and it retains it before restoring
        // the receipt. An existing unknown guard is never overwritten.
        if self.guard.is_none() {
            self.guard = Some(acquire_guard(&self.path(GUARD), CREATE_NEW)?);
        }
        let guard_identity = identity(
            self.guard
                .as_ref()
                .ok_or_else(|| refuse("restoration guard not held"))?,
        )?;
        if guard_identity.v != receipt.temp.v {
            return Err(refuse("restored guard volume changed"));
        }
        let guard_entry = receipt
            .entries
            .iter_mut()
            .find(|entry| entry.p == GUARD)
            .ok_or_else(|| refuse("saved final receipt missing guard"))?;
        guard_entry.i = guard_identity;
        let mut file = open_receipt(
            &self.path(RECEIPT),
            GENERIC_READ | GENERIC_WRITE,
            CREATE_NEW,
            0,
        )?;
        let restored_identity = identity(&file)?;
        if restored_identity.d || restored_identity.v != receipt.temp.v {
            return Err(refuse("restored receipt identity"));
        }
        // CREATE_NEW cannot overwrite an unknown replacement at this name.
        // A changed root is never adopted, even if the new receipt was created.
        if inspect(&self.root)? != receipt.entries[0].i {
            return Err(refuse("final root identity changed during restoration"));
        }
        let receipt_entry = receipt
            .entries
            .iter_mut()
            .find(|entry| entry.p == RECEIPT)
            .ok_or_else(|| refuse("saved final receipt missing identity"))?;
        receipt_entry.i = restored_identity.clone();
        let bytes =
            serde_json::to_vec(&receipt).map_err(|_| refuse("restored receipt encoding"))?;
        if bytes.len() > MAX_RECEIPT {
            return Err(refuse("restored receipt size bound"));
        }
        // One write and one flush, paid for by the pre-deletion reservation.
        let count = file
            .write(&bytes)
            .map_err(|error| io_error("final receipt restoration write", error))?;
        if count != bytes.len() {
            return Err(refuse("short final receipt restoration write"));
        }
        flush(&file).map_err(|code| Failure {
            invariant: false,
            context: "final receipt restoration flush",
            code: Some(code),
        })?;
        if identity(&file)? != restored_identity || inspect(&self.root)? != receipt.entries[0].i {
            return Err(refuse("final ownership changed during restoration"));
        }
        self.receipt = receipt;
        Ok(())
    }

    fn retire_guard(&mut self) -> Result<()> {
        let guard = self
            .guard
            .as_ref()
            .ok_or_else(|| refuse("run admission guard not held"))?;
        if identity(guard)? != self.entry(GUARD)?.i {
            return Err(refuse("guard identity changed before retirement"));
        }
        // Owned-object deletion through the held DELETE-capable handle. Mark
        // delete-pending before close: close-then-DeleteFile would admit another
        // worker in between. This is not a create-time delete-on-close flag.
        let disposition = FILE_DISPOSITION_INFO { DeleteFile: true };
        if unsafe {
            SetFileInformationByHandle(
                raw(guard),
                FileDispositionInfo,
                (&disposition as *const FILE_DISPOSITION_INFO).cast(),
                size_of::<FILE_DISPOSITION_INFO>() as u32,
            )
        } == 0
        {
            return Err(native_error("exclusive guard retirement"));
        }
        // New opens now fail as delete-pending; after close they fail as absent.
        // All case/cleanup admission uses OPEN_EXISTING, with no create fallback.
        drop(self.guard.take());
        Ok(())
    }

    fn remove(&self, entry: &Entry) -> Result<()> {
        // Check ancestors again as well as the leaf. Directory removal remains
        // nonrecursive, so a late unknown child causes refusal, not deletion.
        let mut parent = Path::new(&entry.p).parent();
        while let Some(path) = parent {
            let relative = path
                .to_str()
                .ok_or_else(|| refuse("cleanup parent syntax"))?;
            if inspect(&self.path(relative))? != self.entry(relative)?.i {
                return Err(refuse("cleanup ancestor identity changed"));
            }
            parent = path.parent();
        }
        if inspect(&self.path(&entry.p))? != entry.i {
            return Err(refuse("cleanup object identity changed"));
        }
        let path = wide_path(&self.path(&entry.p))?;
        let ok = unsafe {
            if entry.i.d {
                RemoveDirectoryW(path.as_ptr())
            } else {
                DeleteFileW(path.as_ptr())
            }
        };
        if ok == 0 {
            return Err(native_error("owned fixture deletion"));
        }
        Ok(())
    }
}

struct FinalRootRecovery<'a> {
    run: &'a mut Run,
    receipt_bytes: Vec<u8>,
}

impl cleanup_protocol::FinalizationIo for FinalRootRecovery<'_> {
    type Error = Failure;

    fn reserve_recovery(&mut self) -> Result<()> {
        let (written, objects) = cleanup_protocol::reserve_restoration(
            self.run.receipt.written,
            self.run.receipt.objects,
            MAX_PAYLOAD,
            MAX_OBJECTS,
            MAX_RECEIPT,
        )
        .map_err(refuse)?;
        // Conservatively charge two new objects (guard and receipt) and a full
        // bounded receipt even
        // when root deletion succeeds and no restoration is needed. Persist also
        // charges this checkpoint's own write before either final deletion.
        self.run.receipt.written = written;
        self.run.receipt.objects = objects;
        self.receipt_bytes = self.run.persist_bytes()?;
        self.run.verify()
    }

    fn remove_receipt(&mut self) -> Result<()> {
        self.run.remove(self.run.entry(RECEIPT)?)
    }

    fn remove_root_once(&mut self) -> Result<()> {
        self.run.retire_guard()?;
        self.run.remove(self.run.entry("")?)
    }

    fn verify_original_root(&mut self) -> Result<()> {
        if inspect(&self.run.root)? != self.run.entry("")?.i {
            return Err(refuse("final root identity changed"));
        }
        Ok(())
    }

    fn restore_receipt_new(&mut self) -> Result<()> {
        self.run.restore_final_receipt(&self.receipt_bytes)
    }
}

impl cleanup_protocol::RemovalIo for Run {
    type Error = Failure;

    fn remove_owned(&mut self, object: &str) -> Result<()> {
        if object.is_empty() || object == RECEIPT || object == GUARD {
            return Err(refuse("cleanup cannot remove ownership evidence"));
        }
        self.remove(self.entry(object)?)
    }

    fn checkpoint_removed(&mut self, object: &str) -> Result<()> {
        self.receipt.entries.retain(|entry| entry.p != object);
        self.persist()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn receipt_paths_cannot_select_arbitrary_objects() {
        for path in [
            "../active",
            "case00/../../escape",
            "C:/active",
            "case20",
            "case01/unknown",
            "case00\\active",
            "case00/source",
            "ownership.json/child",
        ] {
            assert!(!allowed_path(path, true));
            assert!(!allowed_path(path, false));
        }
        assert!(allowed_path(
            "case03/stable/root/generation/payload.bin",
            false
        ));
        assert!(allowed_path("case19/source", false));
        assert!(allowed_path("", true));
    }
}
