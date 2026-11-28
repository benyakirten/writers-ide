//! Handle-relative collection of installed package bytes.
//!
//! This is not an atomic filesystem snapshot. Concurrent writes can produce a
//! mixture of versions. The caller must verify and consume these owned bytes,
//! never reopen their paths after verification.

use std::collections::BTreeMap;
use std::ffi::OsStr;
use std::io::Read;
use std::path::Path;

#[cfg(unix)]
use cap_fs_ext::OpenOptionsSyncExt;
use cap_fs_ext::{DirExt, FollowSymlinks, OpenOptionsFollowExt};
use cap_std::fs::{Dir, Metadata, OpenOptions, ReadDir};

use super::{validate_path, IntegrityError, IntegrityLimits};

pub(super) fn read_package(
    root: &Path,
    limits: &IntegrityLimits,
) -> Result<BTreeMap<String, Vec<u8>>, IntegrityError> {
    // The host supplies the root and its ancestors. Only this initial parent
    // lookup uses ambient authority. In particular, do not open the root with
    // open_ambient_dir: that would follow a root symlink before we could reject it.
    let name = root
        .file_name()
        .ok_or_else(|| filesystem("", "package root must name a directory"))?;
    let parent = root.parent().filter(|path| !path.as_os_str().is_empty());
    let parent = Dir::open_ambient_dir(
        parent.unwrap_or_else(|| Path::new(".")),
        cap_std::ambient_authority(),
    )
    .map_err(|error| filesystem("", error))?;
    let directory = open_directory(&parent, Path::new(name), "")?;
    collect(directory, limits)
}

struct Frame {
    directory: Dir,
    entries: ReadDir,
    path: String,
}

fn frame(directory: Dir, path: String) -> Result<Frame, IntegrityError> {
    let entries = directory
        .entries()
        .map_err(|error| filesystem(&path, error))?;
    Ok(Frame {
        directory,
        entries,
        path,
    })
}

fn collect(
    directory: Dir,
    limits: &IntegrityLimits,
) -> Result<BTreeMap<String, Vec<u8>>, IntegrityError> {
    let mut stack = vec![frame(directory, String::new())?];
    let mut files = BTreeMap::new();
    let mut total_bytes = 0_u64;
    // Empty directories consume work too. Derive a separate directory budget
    // from the configured file/depth budgets, without charging them as files.
    let directory_budget = limits.max_files.saturating_mul(limits.max_depth).max(1);
    let mut directories = 0_usize;

    loop {
        let depth = stack.len();
        let Some(current) = stack.last_mut() else {
            break;
        };
        let entry = current.entries.next();
        let Some(entry) = entry else {
            stack.pop();
            continue;
        };
        let entry = entry.map_err(|error| filesystem(&current.path, error))?;
        let name = entry.file_name();
        let name = entry_name(&name, &current.path)?;
        let path = if current.path.is_empty() {
            name.to_owned()
        } else {
            format!("{}/{name}", current.path)
        };
        validate_path(&path, limits)?;
        if depth > limits.max_depth {
            return Err(limit(&path, "max_depth"));
        }

        // This is only an early rejection/classification. Security does not
        // depend on it remaining current: every open below is no-follow, and
        // every opened handle is checked again before enumeration or reading.
        let metadata = current
            .directory
            .symlink_metadata(name)
            .map_err(|error| filesystem(&path, error))?;
        reject_link(&metadata, &path)?;
        if metadata.is_dir() {
            if directories >= directory_budget {
                return Err(limit(&path, "max_directories"));
            }
            directories += 1;
            let child = open_directory(&current.directory, Path::new(name), &path)?;
            stack.push(frame(child, path)?);
        } else if metadata.is_file() {
            if files.len() >= limits.max_files {
                return Err(limit(&path, "max_files"));
            }
            let remaining = limits.max_total_bytes - total_bytes;
            let bytes = read_file(&current.directory, name, &path, limits, remaining)?;
            total_bytes += bytes.len() as u64;
            let previous = files.insert(path.clone(), bytes);
            if previous.is_some() {
                return Err(filesystem(&path, "entry was enumerated more than once"));
            }
        } else {
            return Err(filesystem(
                &path,
                "only regular files and directories are allowed",
            ));
        }
    }
    Ok(files)
}

fn entry_name<'a>(name: &'a OsStr, path: &str) -> Result<&'a str, IntegrityError> {
    name.to_str()
        .ok_or_else(|| filesystem(path, "entry name is not UTF-8"))
}

fn open_directory(parent: &Dir, name: &Path, path: &str) -> Result<Dir, IntegrityError> {
    let directory = parent
        .open_dir_nofollow(name)
        .map_err(|error| filesystem(path, error))?;
    let metadata = directory
        .dir_metadata()
        .map_err(|error| filesystem(path, error))?;
    reject_link(&metadata, path)?;
    if !metadata.is_dir() {
        return Err(filesystem(path, "expected a directory"));
    }
    Ok(directory)
}

fn read_file(
    directory: &Dir,
    name: &str,
    path: &str,
    limits: &IntegrityLimits,
    remaining: u64,
) -> Result<Vec<u8>, IntegrityError> {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    // A regular entry can be swapped for a FIFO after classification. Do not
    // block waiting for a writer before checking the opened handle's type.
    #[cfg(unix)]
    options.nonblock(true);
    let file = directory
        .open_with(name, &options)
        .map_err(|error| filesystem(path, error))?;
    let metadata = file.metadata().map_err(|error| filesystem(path, error))?;
    reject_link(&metadata, path)?;
    if !metadata.is_file() {
        return Err(filesystem(path, "expected a regular file"));
    }

    let maximum = limits.max_file_bytes.min(remaining);
    let mut reader = file.take(maximum.saturating_add(1));
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(filesystem(path, error)),
        };
        if count == 0 {
            break;
        }
        let length = (bytes.len() as u64).saturating_add(count as u64);
        if length > limits.max_file_bytes {
            return Err(limit(path, "max_file_bytes"));
        }
        if length > remaining {
            return Err(limit(path, "max_total_bytes"));
        }
        bytes
            .try_reserve(count)
            .map_err(|error| filesystem(path, error))?;
        bytes.extend_from_slice(&buffer[..count]);
    }
    Ok(bytes)
}

fn reject_link(metadata: &Metadata, path: &str) -> Result<(), IntegrityError> {
    if metadata.file_type().is_symlink() {
        return Err(filesystem(path, "symbolic links are not allowed"));
    }
    #[cfg(windows)]
    {
        use cap_fs_ext::OsMetadataExt;
        // FILE_ATTRIBUTE_REPARSE_POINT also covers non-symlink reparse tags.
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(filesystem(path, "reparse points are not allowed"));
        }
    }
    Ok(())
}

fn filesystem(path: &str, reason: impl std::fmt::Display) -> IntegrityError {
    IntegrityError::Filesystem {
        path: path.to_owned(),
        reason: reason.to_string(),
    }
}

fn limit(path: &str, limit: &'static str) -> IntegrityError {
    IntegrityError::LimitExceeded {
        path: path.to_owned(),
        limit,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn limits() -> IntegrityLimits {
        IntegrityLimits {
            max_files: 16,
            max_file_bytes: 1024,
            max_total_bytes: 4096,
            max_path_bytes: 256,
            max_depth: 8,
        }
    }

    #[test]
    fn collects_all_files_with_portable_paths_and_owned_bytes() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("assets")).unwrap();
        fs::create_dir(root.path().join("empty")).unwrap();
        fs::write(root.path().join("assets/worker.js"), b"worker").unwrap();
        fs::write(root.path().join("host-hashes.json"), b"not trusted").unwrap();
        fs::write(root.path().join("manifest.toml"), b"manifest").unwrap();
        let snapshot = read_package(root.path(), &limits()).unwrap();
        assert_eq!(snapshot.len(), 3);
        assert_eq!(snapshot["assets/worker.js"], b"worker");
        assert_eq!(snapshot["host-hashes.json"], b"not trusted");
        fs::write(root.path().join("assets/worker.js"), b"changed").unwrap();
        fs::remove_file(root.path().join("manifest.toml")).unwrap();
        assert_eq!(snapshot["assets/worker.js"], b"worker");
        assert_eq!(snapshot["manifest.toml"], b"manifest");
    }

    #[test]
    fn enforces_byte_limits_including_exact_boundaries_and_zero() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a"), b"1234").unwrap();
        let mut limits = limits();
        limits.max_file_bytes = 4;
        limits.max_total_bytes = 4;
        assert!(read_package(root.path(), &limits).is_ok());
        limits.max_file_bytes = 3;
        assert!(matches!(
            read_package(root.path(), &limits),
            Err(IntegrityError::LimitExceeded {
                limit: "max_file_bytes",
                ..
            })
        ));
        limits.max_file_bytes = u64::MAX;
        limits.max_total_bytes = 3;
        assert!(matches!(
            read_package(root.path(), &limits),
            Err(IntegrityError::LimitExceeded {
                limit: "max_total_bytes",
                ..
            })
        ));
        fs::write(root.path().join("a"), b"").unwrap();
        limits.max_file_bytes = 0;
        limits.max_total_bytes = 0;
        assert!(read_package(root.path(), &limits).is_ok());
        fs::write(root.path().join("a"), b"x").unwrap();
        assert!(read_package(root.path(), &limits).is_err());
    }

    #[test]
    fn enforces_total_across_files_and_file_count() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("a"), b"123").unwrap();
        fs::write(root.path().join("b"), b"456").unwrap();
        let mut limits = limits();
        limits.max_total_bytes = 5;
        assert!(matches!(
            read_package(root.path(), &limits),
            Err(IntegrityError::LimitExceeded {
                limit: "max_total_bytes",
                ..
            })
        ));
        limits.max_total_bytes = 6;
        limits.max_files = 1;
        assert!(matches!(
            read_package(root.path(), &limits),
            Err(IntegrityError::LimitExceeded {
                limit: "max_files",
                ..
            })
        ));
    }

    #[test]
    fn bounds_empty_directories_and_depth() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("a")).unwrap();
        fs::create_dir(root.path().join("b")).unwrap();
        let mut limits = limits();
        limits.max_files = 1;
        limits.max_depth = 1;
        assert!(read_package(root.path(), &limits).is_err());
        fs::remove_dir(root.path().join("b")).unwrap();
        fs::write(root.path().join("a/file"), b"").unwrap();
        assert!(read_package(root.path(), &limits).is_err());
    }

    #[test]
    fn validates_directory_names_as_well_as_file_names() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("directory")).unwrap();
        let mut limits = limits();
        limits.max_path_bytes = 3;
        assert!(read_package(root.path(), &limits).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_root_and_descendant_symlinks() {
        use std::os::unix::fs::symlink;
        let parent = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret"), b"outside").unwrap();
        symlink(outside.path(), parent.path().join("root")).unwrap();
        assert!(read_package(&parent.path().join("root"), &limits()).is_err());
        fs::remove_file(parent.path().join("root")).unwrap();
        symlink(outside.path().join("secret"), parent.path().join("file")).unwrap();
        assert!(read_package(parent.path(), &limits()).is_err());
        fs::remove_file(parent.path().join("file")).unwrap();
        symlink(outside.path(), parent.path().join("directory")).unwrap();
        assert!(read_package(parent.path(), &limits()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_invalid_utf8_entry_names_without_filesystem_support() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let invalid = OsString::from_vec(vec![0xff]);
        assert!(matches!(
            entry_name(&invalid, "assets"),
            Err(IntegrityError::Filesystem { path, reason })
                if path == "assets" && reason == "entry name is not UTF-8"
        ));
        assert_eq!(
            entry_name(OsStr::new("worker.js"), "assets").unwrap(),
            "worker.js"
        );
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn rejects_invalid_utf8_names_in_installed_directory() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;
        let root = tempfile::tempdir().unwrap();
        let invalid = root.path().join(OsString::from_vec(vec![0xff]));
        fs::write(invalid, b"invalid name").unwrap();
        assert!(read_package(root.path(), &limits()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_unix_sockets() {
        use std::os::unix::net::UnixListener;
        let root = tempfile::tempdir().unwrap();
        let _socket = UnixListener::bind(root.path().join("socket")).unwrap();
        assert!(read_package(root.path(), &limits()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn retained_directory_handle_does_not_follow_a_replacement_path() {
        use std::os::unix::fs::symlink;
        let parent = tempfile::tempdir().unwrap();
        fs::create_dir(parent.path().join("package")).unwrap();
        fs::write(parent.path().join("package/file"), b"original").unwrap();
        let directory = Dir::open_ambient_dir(parent.path(), cap_std::ambient_authority()).unwrap();
        let package = open_directory(&directory, Path::new("package"), "").unwrap();
        fs::rename(parent.path().join("package"), parent.path().join("old")).unwrap();
        fs::create_dir(parent.path().join("replacement")).unwrap();
        fs::write(parent.path().join("replacement/file"), b"replacement").unwrap();
        symlink("replacement", parent.path().join("package")).unwrap();
        assert!(open_directory(&directory, Path::new("package"), "").is_err());
        let snapshot = collect(package, &limits()).unwrap();
        assert_eq!(snapshot["file"], b"original");
    }

    #[cfg(unix)]
    #[test]
    fn file_open_rejects_symlink_swap_without_relying_on_classification() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join("target"), b"unchecked").unwrap();
        symlink("target", root.path().join("file")).unwrap();
        let directory = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        assert!(read_file(&directory, "file", "file", &limits(), 4096).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_fifo_even_when_swapped_in_after_classification() {
        let root = tempfile::tempdir().unwrap();
        let status = std::process::Command::new("mkfifo")
            .arg(root.path().join("fifo"))
            .status()
            .unwrap();
        assert!(status.success());
        assert!(read_package(root.path(), &limits()).is_err());
        let directory = Dir::open_ambient_dir(root.path(), cap_std::ambient_authority()).unwrap();
        // Bypass enumeration's classification deliberately. A blocking open
        // would hang here because there is no FIFO writer.
        assert!(read_file(&directory, "fifo", "fifo", &limits(), 4096).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn rejects_root_and_descendant_junctions() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("secret"), b"outside").unwrap();
        let junction = root.path().join("junction");
        let output = std::process::Command::new("cmd")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(output.status.success(), "{output:?}");
        assert!(read_package(&junction, &limits()).is_err());
        assert!(read_package(root.path(), &limits()).is_err());
    }
}
