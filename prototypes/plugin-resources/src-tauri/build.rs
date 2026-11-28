use std::{env, fs, path::Path};

#[path = "src/portable.rs"]
mod portable;

fn collect(
    root: &Path,
    directory: &Path,
    files: &mut Vec<String>,
    total: &mut u64,
    work: &mut usize,
) {
    assert!(files.len() <= 512, "fixture file limit exceeded");
    let entries =
        fs::read_dir(directory).expect("frontend must build dist/package before Cargo builds");
    for entry in entries {
        *work += 1;
        assert!(*work <= 2048, "fixture directory work limit exceeded");
        let entry = entry.expect("read fixture entry");
        let path = entry.path();
        let relative = path.strip_prefix(root).expect("fixture relative path");
        let relative = relative
            .to_str()
            .expect("UTF-8 fixture path")
            .replace('\\', "/");
        assert!(
            portable::portable_path(&relative),
            "nonportable fixture path"
        );
        let metadata = fs::symlink_metadata(&path).expect("fixture metadata");
        assert!(!metadata.is_symlink(), "fixture links are forbidden");
        if metadata.is_dir() {
            collect(root, &path, files, total, work);
        } else {
            assert!(
                metadata.is_file(),
                "fixture must contain only regular files"
            );
            assert!(metadata.len() <= 8 * 1024 * 1024, "fixture file too large");
            *total += metadata.len();
            assert!(*total <= 32 * 1024 * 1024, "fixture package too large");
            files.push(relative);
            assert!(files.len() <= 512, "fixture file limit exceeded");
        }
    }
}

fn embed(crate_root: &Path, directory: &str, record_name: &str, prefix: &str) -> String {
    println!("cargo:rerun-if-changed=../dist/{directory}");
    println!("cargo:rerun-if-changed=../dist/{record_name}");
    let root = crate_root.join("../dist").join(directory);
    assert!(
        fs::symlink_metadata(&root)
            .expect("missing dist/package; run frontend build first")
            .is_dir(),
        "fixture root must be a real directory"
    );
    let record = crate_root.join("../dist").join(record_name);
    let metadata =
        fs::symlink_metadata(&record).expect("missing frontend dist/fixture-record.json");
    assert!(
        metadata.is_file() && !metadata.is_symlink() && metadata.len() <= 600_000,
        "invalid fixture record"
    );
    let mut files = Vec::new();
    collect(&root, &root, &mut files, &mut 0, &mut 0);
    files.sort();
    assert!(
        files.iter().any(|path| path == "fixture/plugin.js"),
        "missing fixture entry"
    );
    assert!(
        files.iter().any(|path| path == "runtime-map.json"),
        "missing runtime map"
    );
    let mut generated = format!("const {prefix}ACCEPTED_RECORD: &[u8] = include_bytes!({:?});\nconst {prefix}EMBEDDED_FILES: &[(&str, &[u8])] = &[\n", record);
    for relative in files {
        generated.push_str(&format!(
            "({relative:?}, include_bytes!({:?})),\n",
            root.join(&relative)
        ));
    }
    generated.push_str("];\n");
    generated
}

fn main() {
    let crate_root = env::current_dir().expect("crate directory");
    let mut generated = embed(&crate_root, "package", "fixture-record.json", "");
    generated.push_str(&embed(
        &crate_root,
        "package-second",
        "fixture-record-second.json",
        "SECOND_",
    ));
    let output = env::var_os("OUT_DIR").expect("Cargo OUT_DIR");
    fs::write(Path::new(&output).join("fixture_manifest.rs"), generated)
        .expect("write fixture manifest");
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(&["finish"])),
    )
    .expect("build standalone Tauri harness");
}
