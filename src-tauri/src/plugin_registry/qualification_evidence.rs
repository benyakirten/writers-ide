//! Test-only observations, never input to publication preflight or qualification.
#![cfg(test)]

use serde::Serialize;
use std::{fs, io::Read, path::Path};

type Observation<T> = Result<T, &'static str>;

#[derive(Debug, Serialize)]
struct Filesystem {
    probe: &'static str,
    filesystem_type: &'static str,
    magic: Option<String>,
    flags: u64,
    read_only: bool,
    local: Option<bool>,
    drive_kind: Option<&'static str>,
    linux_mount: Observation<MountObservation>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct MountObservation {
    filesystem_type: &'static str,
    relevant_options: Vec<&'static str>,
    unreported_option_count: usize,
}

#[derive(Serialize)]
struct Evidence {
    schema: &'static str,
    source: &'static str,
    qualified: bool,
    runtime_publication_enabled: bool,
    power_loss_tested: bool,
    target_os: &'static str,
    target_arch: &'static str,
    ci_run: Option<CiRun>,
    os_release: Observation<String>,
    temporary_fixture: Observation<Filesystem>,
    repository_manifest: Observation<Filesystem>,
    same_filesystem: Observation<bool>,
    limitations: &'static [&'static str],
}

#[derive(Debug, PartialEq, Eq, Serialize)]
struct CiRun {
    run_id: String,
    attempt: String,
}

fn ci_run(run_id: Option<&str>, attempt: Option<&str>) -> Observation<Option<CiRun>> {
    match (run_id, attempt) {
        (None, None) => Ok(None),
        (Some(run_id), Some(attempt)) => {
            for value in [run_id, attempt] {
                if value.is_empty()
                    || value.len() > 32
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err("unavailable: invalid CI evidence identity");
                }
            }
            Ok(Some(CiRun {
                run_id: run_id.into(),
                attempt: attempt.into(),
            }))
        }
        _ => Err("unavailable: incomplete CI evidence identity"),
    }
}

fn ci_environment(name: &str) -> Observation<Option<String>> {
    match std::env::var(name) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => Err("unavailable: invalid CI context encoding"),
    }
}

// Never serialize arbitrary native strings, error messages, paths or host identifiers.
fn filesystem_name(name: &str) -> &'static str {
    match name.to_ascii_lowercase().as_str() {
        "apfs" => "apfs",
        "hfs" => "hfs",
        "ntfs" => "ntfs",
        "refs" => "refs",
        "fat" | "fat32" => "fat",
        "exfat" => "exfat",
        "tmpfs" => "tmpfs",
        "nfs" => "nfs",
        "smbfs" => "smbfs",
        _ => "unknown",
    }
}

const MOUNTINFO_LIMIT: u64 = 1024 * 1024;

fn bounded_mount_text(reader: impl Read) -> Observation<String> {
    let mut bytes = Vec::new();
    reader
        .take(MOUNTINFO_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "unavailable: mountinfo read failed")?;
    if bytes.len() as u64 > MOUNTINFO_LIMIT {
        return Err("unavailable: mountinfo exceeds observation limit");
    }
    String::from_utf8(bytes).map_err(|_| "unavailable: non-UTF8 mountinfo")
}

fn mount_component(encoded: &str) -> Observation<String> {
    let bytes = encoded.as_bytes();
    let mut result = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'\\' {
            let escape = bytes
                .get(index + 1..index + 4)
                .ok_or("unavailable: malformed mountpoint escape")?;
            result.push(match escape {
                b"040" => b' ',
                b"011" => b'\t',
                b"012" => b'\n',
                b"134" => b'\\',
                _ => return Err("unavailable: unrecognized mountpoint escape"),
            });
            index += 4;
        } else {
            result.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(result).map_err(|_| "unavailable: non-UTF8 mountpoint")
}

fn mount_filesystem(name: &str) -> &'static str {
    match name {
        "ext2" => "ext2",
        "ext3" => "ext3",
        "ext4" => "ext4",
        "xfs" => "xfs",
        "btrfs" => "btrfs",
        "overlay" => "overlay",
        "fuse" | "fuseblk" => "fuse",
        "nfs" | "nfs4" => "nfs",
        "cifs" => "cifs",
        "tmpfs" => "tmpfs",
        _ => "unknown",
    }
}

fn safe_mount_option(option: &str) -> Option<&'static str> {
    match option {
        "ro" => Some("ro"),
        "rw" => Some("rw"),
        "sync" => Some("sync"),
        "async" => Some("async"),
        "dirsync" => Some("dirsync"),
        "lazytime" => Some("lazytime"),
        "nolazytime" => Some("nolazytime"),
        "data=ordered" => Some("data=ordered"),
        "data=writeback" => Some("data=writeback"),
        "data=journal" => Some("data=journal"),
        "barrier" => Some("barrier"),
        "barrier=1" => Some("barrier=1"),
        "barrier=0" => Some("barrier=0"),
        "nobarrier" => Some("nobarrier"),
        "delalloc" => Some("delalloc"),
        "nodelalloc" => Some("nodelalloc"),
        _ => None,
    }
}

fn mount_observation(text: &str, path: &str) -> Observation<MountObservation> {
    if !path.starts_with('/') {
        return Err("unavailable: mount path is not absolute");
    }
    // Parse Linux components explicitly so parser tests run on Windows too.
    let path_components: Vec<_> = path.split('/').filter(|part| !part.is_empty()).collect();
    let mut best = None;
    let mut ambiguous = false;
    for line in text.lines() {
        let Some((before, after)) = line.split_once(" - ") else {
            continue;
        };
        let fields: Vec<_> = before.split_ascii_whitespace().collect();
        let filesystem: Vec<_> = after.split_ascii_whitespace().collect();
        if fields.len() < 6 || filesystem.len() < 3 {
            continue;
        }
        let mountpoint = mount_component(fields[4])?;
        if !mountpoint.starts_with('/') {
            continue;
        }
        let components: Vec<_> = mountpoint
            .split('/')
            .filter(|part| !part.is_empty())
            .collect();
        if !path_components.starts_with(&components) {
            continue;
        }
        let depth = components.len();
        let mut observation = MountObservation {
            filesystem_type: mount_filesystem(filesystem[0]),
            relevant_options: Vec::new(),
            unreported_option_count: 0,
        };
        for option in fields[5].split(',').chain(filesystem[2].split(',')) {
            match safe_mount_option(option) {
                Some(safe) => observation.relevant_options.push(safe),
                None => observation.unreported_option_count += 1,
            }
        }
        observation.relevant_options.sort_unstable();
        observation.relevant_options.dedup();
        match &best {
            Some((best_depth, previous)) if depth == *best_depth => {
                if previous != &observation {
                    ambiguous = true;
                }
            }
            Some((best_depth, _)) if depth < *best_depth => {}
            _ => {
                best = Some((depth, observation));
                ambiguous = false;
            }
        }
    }
    if ambiguous {
        return Err("unavailable: ambiguous mount observations");
    }
    best.map(|(_, observation)| observation)
        .ok_or("unavailable: no matching mountinfo entry")
}

#[cfg(target_os = "linux")]
fn linux_mount(path: &str) -> Observation<MountObservation> {
    let path = fs::canonicalize(path).map_err(|_| "unavailable: mount path resolution failed")?;
    let file =
        fs::File::open("/proc/self/mountinfo").map_err(|_| "unavailable: mountinfo open failed")?;
    mount_observation(
        &bounded_mount_text(file)?,
        path.to_str().ok_or("unavailable: non-UTF8 mount path")?,
    )
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn filesystem(path: &Path) -> Observation<Filesystem> {
    use std::{ffi::CString, mem::MaybeUninit, os::unix::ffi::OsStrExt};
    let path =
        CString::new(path.as_os_str().as_bytes()).map_err(|_| "unavailable: invalid path")?;
    let mut info = MaybeUninit::<libc::statfs>::uninit();
    // SAFETY: path is NUL terminated; the output is read only after success.
    if unsafe { libc::statfs(path.as_ptr(), info.as_mut_ptr()) } != 0 {
        return Err("unavailable: statfs failed");
    }
    // SAFETY: statfs initialized the output on success.
    let info = unsafe { info.assume_init() };
    #[cfg(target_os = "macos")]
    {
        let bytes: Vec<u8> = info
            .f_fstypename
            .iter()
            .map(|b| *b as u8)
            .take_while(|b| *b != 0)
            .collect();
        Ok(Filesystem {
            probe: "statfs",
            filesystem_type: filesystem_name(&String::from_utf8_lossy(&bytes)),
            magic: None,
            flags: u64::from(info.f_flags),
            read_only: info.f_flags & libc::MNT_RDONLY as u32 != 0,
            local: Some(info.f_flags & libc::MNT_LOCAL as u32 != 0),
            drive_kind: None,
            linux_mount: Err("unavailable: not a Linux mount"),
        })
    }
    #[cfg(target_os = "linux")]
    {
        let mut flags = MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: valid C path and output, read only after success.
        if unsafe { libc::statvfs(path.as_ptr(), flags.as_mut_ptr()) } != 0 {
            return Err("unavailable: statvfs failed");
        }
        // SAFETY: statvfs initialized the output on success.
        let flags = unsafe { flags.assume_init() }.f_flag;
        // c_ulong is 32 or 64 bits depending on the compiled target.
        #[allow(clippy::unnecessary_cast)]
        let serialized_flags = flags as u64;
        Ok(Filesystem {
            probe: "statfs+statvfs+mountinfo; magic does not identify ext4",
            filesystem_type: filesystem_name("unresolved-linux-magic"),
            magic: Some(format!("{:#x}", info.f_type)),
            flags: serialized_flags,
            read_only: flags & libc::ST_RDONLY != 0,
            local: None,
            drive_kind: None,
            linux_mount: linux_mount(
                path.to_str()
                    .map_err(|_| "unavailable: non-UTF8 Linux path")?,
            ),
        })
    }
}

#[cfg(windows)]
fn volume_root(path: &Path) -> Observation<Vec<u16>> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::GetVolumePathNameW;
    let path = path
        .canonicalize()
        .map_err(|_| "unavailable: canonicalize failed")?;
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut root = vec![0u16; 32768];
    // SAFETY: NUL-terminated input and writable output with the supplied size.
    if unsafe { GetVolumePathNameW(path.as_ptr(), root.as_mut_ptr(), root.len() as u32) } == 0 {
        return Err("unavailable: GetVolumePathNameW failed");
    }
    let end = root
        .iter()
        .position(|c| *c == 0)
        .ok_or("unavailable: unterminated volume root")?;
    root.truncate(end + 1);
    Ok(root)
}

#[cfg(windows)]
fn filesystem(path: &Path) -> Observation<Filesystem> {
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumeInformationW};
    // WinNT.h flag; importing its binding would require unrelated SystemServices features.
    const FILE_READ_ONLY_VOLUME: u32 = 0x0008_0000;
    let root = volume_root(path)?;
    let mut name = [0u16; 256];
    let mut flags = 0;
    // SAFETY: valid root and buffers. Labels and serial numbers are not requested.
    let success = unsafe {
        GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut flags,
            name.as_mut_ptr(),
            name.len() as u32,
        )
    };
    if success == 0 {
        return Err("unavailable: GetVolumeInformationW failed");
    }
    let end = name
        .iter()
        .position(|c| *c == 0)
        .ok_or("unavailable: unterminated filesystem name")?;
    // SAFETY: root remains NUL terminated and valid for this call.
    let drive = unsafe { GetDriveTypeW(root.as_ptr()) };
    let kind = match drive {
        2 => "removable",
        3 => "fixed",
        4 => "network",
        5 => "optical",
        6 => "ramdisk",
        _ => "unknown",
    };
    Ok(Filesystem {
        probe: "GetVolumeInformationW+GetDriveTypeW",
        filesystem_type: filesystem_name(&String::from_utf16_lossy(&name[..end])),
        magic: None,
        flags: u64::from(flags),
        read_only: flags & FILE_READ_ONLY_VOLUME != 0,
        local: match drive {
            2 | 3 | 5 | 6 => Some(true),
            4 => Some(false),
            _ => None,
        },
        drive_kind: Some(kind),
        linux_mount: Err("unavailable: not a Linux mount"),
    })
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn filesystem(_: &Path) -> Observation<Filesystem> {
    Err("unavailable: filesystem probe not implemented on this target")
}

#[cfg(unix)]
fn same_filesystem(left: &Path, right: &Path) -> Observation<bool> {
    use std::os::unix::fs::MetadataExt;
    let left = fs::metadata(left).map_err(|_| "unavailable: fixture metadata failed")?;
    let right = fs::metadata(right).map_err(|_| "unavailable: manifest metadata failed")?;
    // Compare device IDs in memory, but never serialize them.
    Ok(left.dev() == right.dev())
}

#[cfg(windows)]
fn same_filesystem(left: &Path, right: &Path) -> Observation<bool> {
    let left = volume_root(left)?;
    let right = volume_root(right)?;
    if left == right {
        Ok(true)
    } else {
        // Different mount roots may alias one volume. Do not claim otherwise.
        Err("unavailable: different volume roots; aliases not resolved")
    }
}

#[cfg(not(any(unix, windows)))]
fn same_filesystem(_: &Path, _: &Path) -> Observation<bool> {
    Err("unavailable: filesystem comparison not implemented")
}

fn numeric_release(release: &str) -> Observation<String> {
    let numeric: String = release
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if numeric.is_empty() {
        return Err("unavailable: unrecognized kernel release");
    }
    Ok(numeric)
}

fn os_release() -> Observation<String> {
    #[cfg(unix)]
    {
        let mut info = std::mem::MaybeUninit::<libc::utsname>::uninit();
        // SAFETY: valid output, read only after uname succeeds.
        if unsafe { libc::uname(info.as_mut_ptr()) } != 0 {
            return Err("unavailable: uname failed");
        }
        // SAFETY: uname initialized the output on success.
        let info = unsafe { info.assume_init() };
        let bytes: Vec<u8> = info
            .release
            .iter()
            .map(|b| *b as u8)
            .take_while(|b| *b != 0)
            .collect();
        let release =
            String::from_utf8(bytes).map_err(|_| "unavailable: non-UTF8 kernel release")?;
        // Linux custom release suffixes can contain arbitrary identifying text.
        numeric_release(&release)
    }
    #[cfg(not(unix))]
    {
        Err("unavailable: OS version probe not implemented; no subprocess invoked")
    }
}

#[test]
fn capture_storage_environment() {
    let run_id = ci_environment("GITHUB_RUN_ID").expect("read CI evidence identity");
    let attempt = ci_environment("GITHUB_RUN_ATTEMPT").expect("read CI evidence attempt");
    let ci_run =
        ci_run(run_id.as_deref(), attempt.as_deref()).expect("validate CI evidence identity");
    // A cached target directory must not make an old observation look current.
    let filename = match &ci_run {
        Some(run) => format!("storage-evidence-{}-{}.json", run.run_id, run.attempt),
        None => "storage-evidence-local.json".into(),
    };
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let repository = manifest.join("Cargo.toml");
    let temporary = tempfile::tempdir();
    let fixture = temporary
        .as_ref()
        .map_err(|_| "unavailable: tempdir failed")
        .and_then(|dir| {
            let path = dir.path().join("storage-fixture");
            fs::write(&path, b"environment observation only\n")
                .map_err(|_| "unavailable: fixture creation failed")?;
            Ok(path)
        });
    let evidence = Evidence {
        schema: "writers-ide.registry-storage-evidence/1",
        source: "environment-observation-only",
        qualified: false,
        runtime_publication_enabled: false,
        power_loss_tested: false,
        target_os: std::env::consts::OS,
        target_arch: std::env::consts::ARCH,
        ci_run,
        os_release: os_release(),
        temporary_fixture: fixture.as_ref().map_err(|error| *error).and_then(|path| filesystem(path)),
        repository_manifest: filesystem(&repository),
        same_filesystem: fixture.as_ref().map_err(|error| *error).and_then(|path| same_filesystem(path, &repository)),
        limitations: &[
            "Not qualification proof. No flush, publication, crash or power-loss test performed.",
            "Filesystem names and flags do not prove flush guarantees or detect cloud/storage agents.",
            "Samples represent the default tempfile fixture and repository manifest, not application data.",
            "Numeric Unix release is a kernel release, not a product version/build; custom suffixes omitted.",
            "Linux magic is ambiguous (including ext2/ext3/ext4); mountinfo is an observation, not proof of flush behavior. Only allowlisted mount options are reported.",
            "The underlying device/storage stack and correct flush completion remain unobserved.",
            "Windows root comparison cannot resolve aliases; fixed drive does not prove physical local storage.",
        ],
    };
    let output = manifest.join("target/registry-qualification");
    fs::create_dir_all(&output).expect("create controlled evidence directory");
    fs::write(
        output.join(filename),
        serde_json::to_vec_pretty(&evidence).expect("serialize evidence"),
    )
    .expect("write environment evidence report");
}

#[test]
fn ci_identity_is_bounded_and_cannot_escape_the_report_directory() {
    assert_eq!(ci_run(None, None), Ok(None));
    assert_eq!(
        ci_run(Some("123"), Some("2")).unwrap(),
        Some(CiRun {
            run_id: "123".into(),
            attempt: "2".into()
        })
    );
    for value in [
        "",
        "../secret",
        "private-host",
        "1/2",
        "123456789012345678901234567890123",
    ] {
        assert!(ci_run(Some(value), Some("1")).is_err());
        assert!(ci_run(Some("1"), Some(value)).is_err());
    }
    assert!(ci_run(Some("1"), None).is_err());
}

#[test]
fn kernel_release_suffixes_and_errors_do_not_disclose_identifiers() {
    assert_eq!(numeric_release("6.8.0-private-host"), Ok("6.8.0".into()));
    let unavailable = numeric_release("private-host");
    assert!(unavailable.is_err());
    assert!(!serde_json::to_string(&unavailable)
        .unwrap()
        .contains("private-host"));
}

#[test]
fn linux_mount_lookup_uses_components_and_most_specific_entry() {
    let text = "1 0 8:1 / / rw - ext4 private-source rw\n2 1 0:1 / /tmp rw - tmpfs private-source rw\n3 1 8:2 / /tmp2 rw - xfs private-source rw\n4 2 8:3 / /tmp/nested rw - btrfs private-source rw\n";
    for (path, expected) in [
        ("/tmp/file", "tmpfs"),
        ("/tmp2/file", "xfs"),
        ("/tmp22/file", "ext4"),
        ("/tmp/nested/file", "btrfs"),
    ] {
        assert_eq!(
            mount_observation(text, path).unwrap().filesystem_type,
            expected
        );
    }
}

#[test]
fn linux_mount_observation_decodes_paths_without_disclosing_them_or_options() {
    let text = r"1 0 8:1 / /data\040set rw,password=secret-token - ext4 private-source rw,data=ordered,password=other-token";
    let observation = mount_observation(text, "/data set/fixture").unwrap();
    assert_eq!(observation.filesystem_type, "ext4");
    assert_eq!(observation.relevant_options, ["data=ordered", "rw"]);
    assert_eq!(observation.unreported_option_count, 2);
    let report = serde_json::to_string(&observation).unwrap();
    for forbidden in [
        "secret-token",
        "other-token",
        "private-source",
        "data set",
        "password",
    ] {
        assert!(!report.contains(forbidden));
    }
}

#[test]
fn mountinfo_failures_are_bounded_and_do_not_guess() {
    assert!(bounded_mount_text(&vec![b'x'; MOUNTINFO_LIMIT as usize + 1][..]).is_err());
    assert!(bounded_mount_text(&[0xff][..]).is_err());
    assert!(mount_observation("malformed", "/fixture").is_err());
    assert!(mount_observation("1 0 8:1 / /elsewhere rw - ext4 source rw", "/fixture").is_err());
    assert!(mount_observation(r"1 0 8:1 / /bad\000name rw - ext4 source rw", "/fixture").is_err());
    assert!(mount_observation("1 0 8:1 / / rw - ext4 source rw", "relative").is_err());
    let ambiguous = "1 0 8:1 / / rw - ext4 source rw\n2 0 8:2 / / rw - xfs source rw\n";
    assert!(mount_observation(ambiguous, "/fixture").is_err());
    assert_eq!(
        mount_observation("1 0 8:1 / / rw - secret-source source rw", "/fixture")
            .unwrap()
            .filesystem_type,
        "unknown"
    );
}

#[test]
fn native_names_are_allowlisted_not_disclosed_or_qualified() {
    assert_eq!(filesystem_name("APFS"), "apfs");
    assert_eq!(filesystem_name("NTFS"), "ntfs");
    for value in [
        "/Users/private/volume",
        "secret-label",
        "ext4",
        "0xef53",
        "",
    ] {
        assert_eq!(filesystem_name(value), "unknown");
    }
}
