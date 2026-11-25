use super::*;
use std::fs;
use tempfile::TempDir;

const EMPTY_SHA256: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const ABC_SHA256: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

fn entry(path: &str, bytes: &[u8]) -> IntegrityEntry {
    IntegrityEntry {
        path: path.to_owned(),
        byte_length: bytes.len() as u64,
        sha256: Sha256::digest(bytes).into(),
    }
}

fn from_entries(entries: impl IntoIterator<Item = IntegrityEntry>) -> IntegrityRecord {
    IntegrityRecord::from_entries(
        RECORD_VERSION,
        entries.into_iter().map(Ok::<_, std::convert::Infallible>),
        &limits(),
    )
    .unwrap()
}

#[test]
fn binary_fingerprint_matches_approved_reference_vectors() {
    for (files, expected) in [
        (
            vec![],
            "bb1fce0a61739db749f572861750a86908166d0f948676669e1b5eca47a0807d",
        ),
        (
            vec![("a.txt", b"abc".as_slice())],
            "616f6edea51ec2663dc8e6377974436346b235cbc28cf46729ce00134065d0b0",
        ),
    ] {
        let record = from_entries(files.iter().map(|(path, bytes)| entry(path, bytes)));
        assert_eq!(encode_digest(record.fingerprint()), expected);
        let root = package(&files);
        let verified = verify_package(root.path(), &record, &limits()).unwrap();
        assert_eq!(verified.fingerprint(), record.fingerprint());
        assert_eq!(verified.integrity_record(&limits()).unwrap(), record);
    }
}

#[test]
fn entry_api_preserves_json_binary_digests_order_and_owned_isolation() {
    let original = vec![
        entry("é.txt", b"abc"),
        entry("Z.txt", b""),
        entry("a.txt", b"abc"),
    ];
    let record = from_entries(original.clone());
    let reversed = from_entries(original.into_iter().rev());
    assert_eq!(record, reversed);
    assert_eq!(record.fingerprint(), reversed.fingerprint());
    assert_eq!(record.format_version(), 1);
    let entries: Vec<_> = record.entries().collect();
    assert_eq!(
        entries
            .iter()
            .map(|item| item.path.as_str())
            .collect::<Vec<_>>(),
        ["Z.txt", "a.txt", "é.txt"]
    );
    let json = record.to_json().unwrap();
    let parsed = IntegrityRecord::from_json(&json, &limits()).unwrap();
    assert_eq!(parsed.entries().collect::<Vec<_>>(), entries);
    assert_eq!(parsed.fingerprint(), record.fingerprint());
    assert_eq!(parsed.files["é.txt"].sha256, ABC_SHA256);
    let mut detached = entries;
    detached[0].path.clear();
    detached[0].sha256.fill(0);
    assert_eq!(record.to_json().unwrap(), json);

    let binary = IntegrityEntry {
        path: "binary".into(),
        byte_length: 0,
        sha256: std::array::from_fn(|index| (index * 8) as u8),
    };
    assert_eq!(
        from_entries([binary.clone()]).entries().next(),
        Some(binary)
    );
}

#[test]
fn fingerprint_includes_exact_paths_lengths_digests_and_manifest() {
    let base = from_entries([entry("a", b"abc")]).fingerprint();
    for changed in [
        entry("A", b"abc"),
        entry(" a", b"abc"),
        entry("a", b"abd"),
        IntegrityEntry {
            byte_length: 4,
            ..entry("a", b"abc")
        },
    ] {
        assert_ne!(from_entries([changed]).fingerprint(), base);
    }
    assert_ne!(
        from_entries([entry("é", b"")]).fingerprint(),
        from_entries([entry("e\u{301}", b"")]).fingerprint()
    );
    assert_ne!(
        from_entries([entry("a", b"abc"), entry("manifest.toml", b"")]).fingerprint(),
        base
    );
    // Independent Python hashlib vector: UTF-8 byte lengths and byte ordering.
    assert_eq!(
        encode_digest(from_entries([entry("é", b"abc"), entry("Z", b"")]).fingerprint()),
        "6c4fb481cdb0b6c312c6dc1c93b2c65e551a30ba398c936f9b72b992044758f1"
    );
}

#[test]
fn fallible_entries_stop_at_first_failure_and_preserve_concrete_source() {
    #[derive(Debug, PartialEq, Eq)]
    struct SourceError(u32);
    let mut source = [
        Ok(entry("a", b"")),
        Err(SourceError(7)),
        Ok(entry("b", b"")),
    ]
    .into_iter();
    assert_eq!(
        IntegrityRecord::from_entries(1, &mut source, &limits()),
        Err(IntegrityBuildError::Source(SourceError(7)))
    );
    assert_eq!(source.next(), Some(Ok(entry("b", b""))));

    let mut duplicate = [
        Ok::<_, SourceError>(entry("a", b"")),
        Ok(entry("a", b"")),
        Err(SourceError(8)),
    ]
    .into_iter();
    assert!(matches!(
        IntegrityRecord::from_entries(1, &mut duplicate, &limits()),
        Err(IntegrityBuildError::InvalidRecord(
            IntegrityError::MalformedRecord(_)
        ))
    ));
    assert_eq!(duplicate.next(), Some(Err(SourceError(8))));

    let mut invalid = [
        Ok::<_, SourceError>(entry("../a", b"")),
        Err(SourceError(9)),
    ]
    .into_iter();
    assert!(matches!(
        IntegrityRecord::from_entries(1, &mut invalid, &limits()),
        Err(IntegrityBuildError::InvalidRecord(
            IntegrityError::InvalidPath { .. }
        ))
    ));
    assert_eq!(invalid.next(), Some(Err(SourceError(9))));

    for version in [0, 2, u32::MAX] {
        let untouched = std::iter::from_fn(|| -> Option<Result<IntegrityEntry, SourceError>> {
            panic!("unsupported version must not read the source")
        });
        assert_eq!(
            IntegrityRecord::from_entries(version, untouched, &limits()),
            Err(IntegrityBuildError::InvalidRecord(
                IntegrityError::UnsupportedVersion(version)
            ))
        );
    }
}

#[test]
fn entry_constructor_enforces_incremental_budgets_and_overflow() {
    let mut exact = limits();
    exact.max_files = 2;
    exact.max_file_bytes = 3;
    exact.max_total_bytes = 6;
    exact.max_path_bytes = 3;
    exact.max_depth = 2;
    let entries = [entry("a/b", b"abc"), entry("é", b"abc")];
    let build = |budget: &IntegrityLimits| {
        IntegrityRecord::from_entries(1, entries.clone().map(Ok::<_, ()>), budget)
    };
    build(&exact).unwrap();
    for (field, expected) in [
        (0, "max_files"),
        (1, "max_file_bytes"),
        (2, "max_total_bytes"),
        (3, "max_path_bytes"),
        (4, "max_depth"),
    ] {
        let mut budget = exact.clone();
        match field {
            0 => budget.max_files = 1,
            1 => budget.max_file_bytes = 2,
            2 => budget.max_total_bytes = 5,
            3 => budget.max_path_bytes = 2,
            _ => budget.max_depth = 1,
        }
        let IntegrityBuildError::InvalidRecord(error) = build(&budget).unwrap_err() else {
            panic!("unexpected source error")
        };
        assert_limit(error, expected);
    }
    let mut unlimited = limits();
    unlimited.max_file_bytes = u64::MAX;
    unlimited.max_total_bytes = u64::MAX;
    let huge = [
        IntegrityEntry {
            byte_length: u64::MAX,
            ..entry("a", b"")
        },
        entry("b", b"x"),
    ];
    let error = IntegrityRecord::from_entries(1, huge.map(Ok::<_, ()>), &unlimited).unwrap_err();
    assert!(matches!(
        error,
        IntegrityBuildError::InvalidRecord(IntegrityError::LimitExceeded {
            limit: "max_total_bytes",
            ..
        })
    ));

    let mut zero = limits();
    zero.max_files = 0;
    IntegrityRecord::from_entries(1, std::iter::empty::<Result<IntegrityEntry, ()>>(), &zero)
        .unwrap();
    let mut reads = 0;
    let infinite = std::iter::from_fn(|| {
        reads += 1;
        Some(Ok::<_, ()>(entry("a", b"")))
    });
    assert!(matches!(
        IntegrityRecord::from_entries(1, infinite, &zero),
        Err(IntegrityBuildError::InvalidRecord(
            IntegrityError::LimitExceeded {
                limit: "max_files",
                ..
            }
        ))
    ));
    assert_eq!(reads, 1);
}

#[test]
fn verified_metadata_uses_retained_bytes_and_obeys_new_limits() {
    let root = package(&[("manifest.toml", b"abc"), ("main.js", b"abc")]);
    let record = create_record(root.path(), &limits()).unwrap();
    let verified = verify_package(root.path(), &record, &limits()).unwrap();
    root.close().unwrap();
    let rebuilt = verified.integrity_record(&limits()).unwrap();
    assert_eq!(rebuilt, record);
    assert_eq!(rebuilt.fingerprint(), verified.fingerprint());
    let mut smaller = limits();
    smaller.max_total_bytes = 5;
    assert_limit(
        verified.integrity_record(&smaller).unwrap_err(),
        "max_total_bytes",
    );
}

fn limits() -> IntegrityLimits {
    IntegrityLimits {
        max_files: 32,
        max_file_bytes: 4096,
        max_total_bytes: 16384,
        max_path_bytes: 256,
        max_depth: 8,
    }
}

fn package(files: &[(&str, &[u8])]) -> TempDir {
    let root = tempfile::tempdir().unwrap();
    for (path, bytes) in files {
        let destination = root.path().join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(destination, bytes).unwrap();
    }
    root
}

fn record_with(files: &[(&str, u64)]) -> IntegrityRecord {
    IntegrityRecord {
        format_version: RECORD_VERSION,
        files: files
            .iter()
            .map(|(path, byte_length)| {
                (
                    (*path).to_owned(),
                    FileDigest {
                        byte_length: *byte_length,
                        sha256: EMPTY_SHA256.to_owned(),
                    },
                )
            })
            .collect(),
    }
}

fn assert_limit(error: IntegrityError, expected: &str) {
    assert!(
        matches!(&error, IntegrityError::LimitExceeded { limit, .. } if *limit == expected),
        "expected {expected}, got {error:?}"
    );
}

#[test]
fn sha256_matches_independent_known_vectors() {
    assert_eq!(sha256(b""), EMPTY_SHA256);
    assert_eq!(sha256(b"abc"), ABC_SHA256);
    let root = package(&[("empty", b""), ("abc", b"abc")]);
    let record = create_record(root.path(), &limits()).unwrap();
    assert_eq!(record.files["empty"].sha256, EMPTY_SHA256);
    assert_eq!(record.files["empty"].byte_length, 0);
    assert_eq!(record.files["abc"].sha256, ABC_SHA256);
    assert_eq!(record.files["abc"].byte_length, 3);
}

#[test]
fn encoding_is_deterministic_sorted_and_round_trips() {
    let first = package(&[("z.js", b"abc"), ("assets/a", b""), ("a.js", b"abc")]);
    let second = package(&[("a.js", b"abc"), ("assets/a", b""), ("z.js", b"abc")]);
    let record = create_record(first.path(), &limits()).unwrap();
    let encoded = record.to_json().unwrap();
    assert_eq!(encoded, record.to_json().unwrap());
    assert_eq!(
        encoded,
        create_record(second.path(), &limits())
            .unwrap()
            .to_json()
            .unwrap()
    );
    let expected = format!(
        "{{\"format_version\":1,\"files\":{{\"a.js\":{{\"byte_length\":3,\"sha256\":\"{ABC_SHA256}\"}},\"assets/a\":{{\"byte_length\":0,\"sha256\":\"{EMPTY_SHA256}\"}},\"z.js\":{{\"byte_length\":3,\"sha256\":\"{ABC_SHA256}\"}}}}}}"
    );
    assert_eq!(encoded, expected.as_bytes());
    let parsed = IntegrityRecord::from_json(&encoded, &limits()).unwrap();
    assert_eq!(parsed, record);
    assert_eq!(parsed.to_json().unwrap(), encoded);
    let verified = verify_package(second.path(), &parsed, &limits()).unwrap();
    assert_eq!(
        verified.paths().collect::<Vec<_>>(),
        ["a.js", "assets/a", "z.js"]
    );
}

#[test]
fn all_package_file_kinds_are_verified_as_exact_bytes() {
    let files: &[(&str, &[u8])] = &[
        ("manifest.toml", b"name = 'sample'\n"),
        ("main.js", b"export default 1;"),
        ("styles/theme.css", b"body { color: red; }"),
        ("workers/task.js", b"postMessage('ready');"),
        ("assets/image.bin", &[0, 255, 128, 0, 13, 10]),
        ("assets/empty", b""),
    ];
    let root = package(files);
    let record = create_record(root.path(), &limits()).unwrap();
    let trusted = record.to_json().unwrap();
    let verified = verify_package(root.path(), &record, &limits()).unwrap();
    assert_eq!(verified.paths().count(), files.len());
    assert_eq!(verified.file("absent"), None);
    assert_eq!(verified.file("./main.js"), None);
    assert_eq!(verified.file("styles\\theme.css"), None);
    for (path, bytes) in files {
        assert_eq!(verified.file(path), Some(*bytes), "{path}");
        assert_eq!(record.files[*path].byte_length, bytes.len() as u64);
        let mut changed = bytes.to_vec();
        if changed.is_empty() {
            changed.push(1);
        } else {
            changed[0] ^= 1;
        }
        fs::write(root.path().join(path), &changed).unwrap();
        let error = verify_package(root.path(), &record, &limits()).unwrap_err();
        if bytes.is_empty() {
            assert!(
                matches!(error, IntegrityError::LengthMismatch { path: actual, .. } if actual == *path)
            );
        } else {
            assert_eq!(error, IntegrityError::DigestMismatch((*path).to_owned()));
        }
        assert_eq!(record.to_json().unwrap(), trusted);
        fs::write(root.path().join(path), bytes).unwrap();
    }
}

#[test]
fn length_changes_are_distinct_from_same_length_digest_changes() {
    let root = package(&[("main.js", b"abc")]);
    let record = create_record(root.path(), &limits()).unwrap();
    for (bytes, actual) in [(b"ab".as_slice(), 2), (b"abcd".as_slice(), 4)] {
        fs::write(root.path().join("main.js"), bytes).unwrap();
        assert_eq!(
            verify_package(root.path(), &record, &limits()).unwrap_err(),
            IntegrityError::LengthMismatch {
                path: "main.js".into(),
                expected: 3,
                actual
            }
        );
    }
    fs::write(root.path().join("main.js"), b"xyz").unwrap();
    assert_eq!(
        verify_package(root.path(), &record, &limits()).unwrap_err(),
        IntegrityError::DigestMismatch("main.js".into())
    );
}

#[test]
fn missing_and_unexpected_files_reject_the_entire_package_without_rewriting() {
    let root = package(&[("a.js", b"abc"), ("z.js", b"abc")]);
    let record = create_record(root.path(), &limits()).unwrap();
    let before = record.to_json().unwrap();
    fs::remove_file(root.path().join("z.js")).unwrap();
    assert_eq!(
        verify_package(root.path(), &record, &limits()).unwrap_err(),
        IntegrityError::MissingFile("z.js".into())
    );
    assert_eq!(record.to_json().unwrap(), before);
    assert!(!root.path().join("z.js").exists());
    fs::write(root.path().join("z.js"), b"abc").unwrap();
    fs::write(root.path().join("extra.js"), b"unchecked").unwrap();
    assert_eq!(
        verify_package(root.path(), &record, &limits()).unwrap_err(),
        IntegrityError::UnexpectedFile("extra.js".into())
    );
    assert_eq!(record.to_json().unwrap(), before);
    assert_eq!(
        fs::read(root.path().join("extra.js")).unwrap(),
        b"unchecked"
    );
}

#[test]
fn plugin_local_checksums_cannot_replace_the_host_trusted_record() {
    let root = package(&[
        ("main.js", b"abc"),
        ("checksums.json", b"untrusted local data"),
    ]);
    let trusted = create_record(root.path(), &limits()).unwrap();
    let before = trusted.to_json().unwrap();
    fs::write(root.path().join("main.js"), b"xyz").unwrap();
    let candidate = create_record(root.path(), &limits()).unwrap();
    assert_ne!(candidate, trusted);
    fs::write(
        root.path().join("checksums.json"),
        candidate.to_json().unwrap(),
    )
    .unwrap();
    assert!(verify_package(root.path(), &trusted, &limits()).is_err());
    assert_eq!(trusted.to_json().unwrap(), before);
    fs::write(root.path().join("checksums.json"), b"untrusted local data").unwrap();
    assert_eq!(
        verify_package(root.path(), &trusted, &limits()).unwrap_err(),
        IntegrityError::DigestMismatch("main.js".into())
    );
}

#[test]
fn verified_bytes_survive_source_overwrite_deletion_and_root_removal() {
    let root = package(&[("main.js", b"abc"), ("assets/data", &[0, 255, 1])]);
    let record = create_record(root.path(), &limits()).unwrap();
    let verified = verify_package(root.path(), &record, &limits()).unwrap();
    fs::write(root.path().join("main.js"), b"unchecked replacement").unwrap();
    fs::remove_file(root.path().join("assets/data")).unwrap();
    assert_eq!(verified.file("main.js"), Some(b"abc".as_slice()));
    assert_eq!(verified.file("assets/data"), Some([0, 255, 1].as_slice()));
    root.close().unwrap();
    assert_eq!(
        verified.paths().collect::<Vec<_>>(),
        ["assets/data", "main.js"]
    );
    assert_eq!(verified.file("main.js"), Some(b"abc".as_slice()));
    assert_eq!(verified.file("assets/data"), Some([0, 255, 1].as_slice()));
}

#[test]
fn candidate_creation_and_verification_do_not_persist_records_or_modify_files() {
    let root = package(&[("main.js", b"abc")]);
    for _ in 0..2 {
        let record = create_record(root.path(), &limits()).unwrap();
        let _encoded = record.to_json().unwrap();
        verify_package(root.path(), &record, &limits()).unwrap();
        let names: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [std::ffi::OsString::from("main.js")]);
        assert_eq!(fs::read(root.path().join("main.js")).unwrap(), b"abc");
    }
}

#[test]
fn empty_packages_round_trip_and_verify_without_inventing_files() {
    let root = package(&[]);
    let record = create_record(root.path(), &limits()).unwrap();
    assert!(record.files.is_empty());
    let parsed = IntegrityRecord::from_json(&record.to_json().unwrap(), &limits()).unwrap();
    assert_eq!(
        verify_package(root.path(), &parsed, &limits())
            .unwrap()
            .paths()
            .count(),
        0
    );
    fs::write(root.path().join("new"), b"").unwrap();
    assert_eq!(
        verify_package(root.path(), &parsed, &limits()).unwrap_err(),
        IntegrityError::UnexpectedFile("new".into())
    );
}

#[test]
fn unknown_versions_are_rejected_when_parsing_and_verifying() {
    let root = package(&[]);
    for version in [0, RECORD_VERSION + 1, u32::MAX] {
        let mut record = record_with(&[]);
        record.format_version = version;
        assert_eq!(
            IntegrityRecord::from_json(&record.to_json().unwrap(), &limits()).unwrap_err(),
            IntegrityError::UnsupportedVersion(version)
        );
        assert_eq!(
            verify_package(root.path(), &record, &limits()).unwrap_err(),
            IntegrityError::UnsupportedVersion(version)
        );
    }
}

#[test]
fn malformed_record_shapes_fields_and_lengths_are_rejected() {
    let digest = format!("{{\"byte_length\":0,\"sha256\":\"{EMPTY_SHA256}\"}}");
    let malformed = [
        "".to_owned(),
        "null".to_owned(),
        "[]".to_owned(),
        "[1,{}]".to_owned(),
        format!("{{\"format_version\":1,\"files\":{{\"a\":[0,\"{EMPTY_SHA256}\"]}}}}"),
        "{}".to_owned(),
        "{\"format_version\":1}".to_owned(),
        "{\"files\":{}}".to_owned(),
        "{\"format_version\":1,\"files\":[],\"extra\":0}".to_owned(),
        "{\"format_version\":1,\"files\":{},\"extra\":0}".to_owned(),
        "{\"format_version\":1,\"format_version\":1,\"files\":{}}".to_owned(),
        "{\"format_version\":1,\"files\":{},\"files\":{}}".to_owned(),
        format!("{{\"format_version\":1,\"files\":{{\"a\":{digest},\"a\":{digest}}}}}"),
        format!("{{\"format_version\":1,\"files\":{{\"a\":{digest},\"\\u0061\":{digest}}}}}"),
        "{\"format_version\":1,\"files\":{\"a\":{}}}".to_owned(),
    ];
    for json in malformed {
        assert!(
            matches!(
                IntegrityRecord::from_json(json.as_bytes(), &limits()),
                Err(IntegrityError::MalformedRecord(_))
            ),
            "{json}"
        );
    }
    for fields in [
        format!("\"byte_length\":0,\"sha256\":\"{EMPTY_SHA256}\",\"extra\":true"),
        format!("\"byte_length\":0,\"byte_length\":0,\"sha256\":\"{EMPTY_SHA256}\""),
        format!("\"byte_length\":0,\"sha256\":\"{EMPTY_SHA256}\",\"sha256\":\"{EMPTY_SHA256}\""),
        format!("\"sha256\":\"{EMPTY_SHA256}\""),
        "\"byte_length\":0".to_owned(),
    ] {
        let json = format!("{{\"format_version\":1,\"files\":{{\"a\":{{{fields}}}}}}}");
        assert!(
            matches!(
                IntegrityRecord::from_json(json.as_bytes(), &limits()),
                Err(IntegrityError::MalformedRecord(_))
            ),
            "{json}"
        );
    }
    for length in ["-1", "1.5", "18446744073709551616", "\"3\"", "null", "true"] {
        let json = format!("{{\"format_version\":1,\"files\":{{\"a\":{{\"byte_length\":{length},\"sha256\":\"{EMPTY_SHA256}\"}}}}}}");
        assert!(
            matches!(
                IntegrityRecord::from_json(json.as_bytes(), &limits()),
                Err(IntegrityError::MalformedRecord(_))
            ),
            "{length}"
        );
    }
    let mut trailing = record_with(&[]).to_json().unwrap();
    trailing.extend_from_slice(b"{}");
    assert!(IntegrityRecord::from_json(&trailing, &limits()).is_err());
    assert!(IntegrityRecord::from_json(&[0xff], &limits()).is_err());
}

#[test]
fn malformed_hashes_are_rejected_before_any_package_is_returned() {
    let root = package(&[("a", b"")]);
    for hash in [
        String::new(),
        "a".repeat(63),
        "a".repeat(65),
        "g".repeat(64),
        EMPTY_SHA256.to_uppercase(),
        "é".repeat(32),
        format!("{}\n", "a".repeat(63)),
    ] {
        let mut record = record_with(&[("a", 0)]);
        record.files.get_mut("a").unwrap().sha256 = hash.clone();
        assert!(
            matches!(
                IntegrityRecord::from_json(&record.to_json().unwrap(), &limits()),
                Err(IntegrityError::MalformedRecord(_))
            ),
            "{hash:?}"
        );
        assert!(matches!(
            verify_package(root.path(), &record, &limits()),
            Err(IntegrityError::MalformedRecord(_))
        ));
    }
}

#[test]
fn unsafe_paths_are_rejected_directly_and_in_serialized_records() {
    let paths = [
        "",
        "/etc/passwd",
        "//server/share",
        "C:/file",
        "C:file",
        "C:\\file",
        "\\\\server\\share\\file",
        "folder\\file",
        ".",
        "..",
        "./file",
        "../file",
        "a/../b",
        "a/./b",
        "a//b",
        "a/",
        "/a",
        "a\0b",
        "a\nb",
        "a\rb",
        "a\tb",
        "a\u{7f}b",
        "a\u{85}b",
        "file:stream",
        "a<b",
        "a>b",
        "a\"b",
        "a|b",
        "a?b",
        "a*b",
        "CON",
        "con.txt",
        "PRN",
        "aux.js",
        "NUL",
        "COM1",
        "com9.txt",
        "LPT1",
        "lpt9.js",
        "COM¹",
        "LPT².txt",
        "COM³",
        "dir/NUL/file",
        "file ",
        "file.",
        "dir /file",
        "dir./file",
    ];
    for path in paths {
        assert!(
            matches!(
                validate_path(path, &limits()),
                Err(IntegrityError::InvalidPath { .. })
            ),
            "{path:?}"
        );
        let record = record_with(&[(path, 0)]);
        assert!(
            matches!(
                IntegrityRecord::from_json(&record.to_json().unwrap(), &limits()),
                Err(IntegrityError::InvalidPath { .. })
            ),
            "{path:?}"
        );
    }
    for path in [
        "manifest.toml",
        "assets/é.txt",
        ".hidden",
        "a..b",
        "CONSOLE",
        "COM0",
        "COM10.txt",
        "LPT10",
        "dir/file name",
    ] {
        validate_path(path, &limits()).unwrap();
        IntegrityRecord::from_json(&record_with(&[(path, 0)]).to_json().unwrap(), &limits())
            .unwrap();
    }
}

#[test]
fn path_byte_length_and_depth_limits_include_exact_boundaries() {
    let mut budget = limits();
    budget.max_path_bytes = 4;
    budget.max_depth = 2;
    for path in ["abcd", "éé", "a/b"] {
        validate_path(path, &budget).unwrap();
        IntegrityRecord::from_json(&record_with(&[(path, 0)]).to_json().unwrap(), &budget).unwrap();
    }
    for path in ["abcde", "ééa"] {
        assert_limit(validate_path(path, &budget).unwrap_err(), "max_path_bytes");
        assert_limit(
            IntegrityRecord::from_json(&record_with(&[(path, 0)]).to_json().unwrap(), &budget)
                .unwrap_err(),
            "max_path_bytes",
        );
    }
    budget.max_path_bytes = 256;
    assert_limit(validate_path("a/b/c", &budget).unwrap_err(), "max_depth");
    assert_limit(
        IntegrityRecord::from_json(&record_with(&[("a/b/c", 0)]).to_json().unwrap(), &budget)
            .unwrap_err(),
        "max_depth",
    );
    budget.max_depth = 0;
    assert_limit(validate_path("a", &budget).unwrap_err(), "max_depth");
    budget.max_depth = 1;
    budget.max_path_bytes = 0;
    assert_limit(validate_path("a", &budget).unwrap_err(), "max_path_bytes");
}

#[test]
fn record_budgets_reject_count_individual_total_and_integer_overflow() {
    let record = record_with(&[("a", 3), ("b", 3)]);
    let mut exact = limits();
    exact.max_files = 2;
    exact.max_file_bytes = 3;
    exact.max_total_bytes = 6;
    IntegrityRecord::from_json(&record.to_json().unwrap(), &exact).unwrap();
    let mut cases = Vec::new();
    let mut count = exact.clone();
    count.max_files = 1;
    cases.push((count, "max_files"));
    let mut individual = exact.clone();
    individual.max_file_bytes = 2;
    cases.push((individual, "max_file_bytes"));
    let mut total = exact.clone();
    total.max_total_bytes = 5;
    cases.push((total, "max_total_bytes"));
    for (budget, expected) in cases {
        assert_limit(
            IntegrityRecord::from_json(&record.to_json().unwrap(), &budget).unwrap_err(),
            expected,
        );
    }
    let mut unlimited_bytes = limits();
    unlimited_bytes.max_file_bytes = u64::MAX;
    unlimited_bytes.max_total_bytes = u64::MAX;
    let overflow = record_with(&[("a", u64::MAX), ("b", 1)]);
    assert_limit(
        IntegrityRecord::from_json(&overflow.to_json().unwrap(), &unlimited_bytes).unwrap_err(),
        "max_total_bytes",
    );
}

#[test]
fn serialized_record_size_is_bounded_before_parsing() {
    let mut budget = limits();
    budget.max_files = 0;
    let mut at_boundary = record_with(&[]).to_json().unwrap();
    at_boundary.resize(512, b' ');
    IntegrityRecord::from_json(&at_boundary, &budget).unwrap();
    at_boundary.push(b' ');
    assert_limit(
        IntegrityRecord::from_json(&at_boundary, &budget).unwrap_err(),
        "max_record_bytes",
    );
    let mut saturated = limits();
    saturated.max_files = usize::MAX;
    saturated.max_path_bytes = usize::MAX;
    IntegrityRecord::from_json(&record_with(&[]).to_json().unwrap(), &saturated).unwrap();
}

#[test]
fn package_limits_fail_creation_and_verification_without_partial_results() {
    let root = package(&[("a", b"abc"), ("dir/b", b"abc")]);
    let trusted = create_record(root.path(), &limits()).unwrap();
    let before = trusted.to_json().unwrap();
    let mut cases = Vec::new();
    let mut count = limits();
    count.max_files = 1;
    cases.push((count, "max_files"));
    let mut individual = limits();
    individual.max_file_bytes = 2;
    cases.push((individual, "max_file_bytes"));
    let mut total = limits();
    total.max_total_bytes = 5;
    cases.push((total, "max_total_bytes"));
    let mut path = limits();
    path.max_path_bytes = 4;
    cases.push((path, "max_path_bytes"));
    let mut depth = limits();
    depth.max_depth = 1;
    cases.push((depth, "max_depth"));
    for (budget, expected) in cases {
        assert_limit(create_record(root.path(), &budget).unwrap_err(), expected);
        assert_limit(
            verify_package(root.path(), &trusted, &budget).unwrap_err(),
            expected,
        );
        assert_eq!(trusted.to_json().unwrap(), before);
    }
    // The trusted record fits, but changed on-disk bytes must also obey budgets.
    let mut budget = limits();
    budget.max_file_bytes = 3;
    fs::write(root.path().join("dir/b"), b"abcd").unwrap();
    assert_limit(
        verify_package(root.path(), &trusted, &budget).unwrap_err(),
        "max_file_bytes",
    );
    assert_eq!(trusted.to_json().unwrap(), before);
    fs::write(root.path().join("dir/b"), b"abc").unwrap();
    assert_eq!(
        verify_package(root.path(), &trusted, &limits())
            .unwrap()
            .file("dir/b"),
        Some(b"abc".as_slice())
    );
}

#[test]
fn on_disk_growth_and_additions_cannot_bypass_valid_record_budgets() {
    let root = package(&[("a", b"abc"), ("b", b"abc")]);
    let trusted = create_record(root.path(), &limits()).unwrap();
    let before = trusted.to_json().unwrap();
    let mut budget = limits();
    budget.max_total_bytes = 6;
    fs::write(root.path().join("b"), b"abcd").unwrap();
    assert_limit(
        verify_package(root.path(), &trusted, &budget).unwrap_err(),
        "max_total_bytes",
    );
    fs::write(root.path().join("b"), b"abc").unwrap();
    budget.max_files = 2;
    fs::write(root.path().join("c"), b"").unwrap();
    assert_limit(
        verify_package(root.path(), &trusted, &budget).unwrap_err(),
        "max_files",
    );
    assert_eq!(trusted.to_json().unwrap(), before);
    fs::remove_file(root.path().join("c")).unwrap();
    verify_package(root.path(), &trusted, &budget).unwrap();
}

#[test]
fn zero_byte_and_zero_file_budgets_are_enforced() {
    let root = package(&[]);
    let mut budget = limits();
    budget.max_files = 0;
    budget.max_file_bytes = 0;
    budget.max_total_bytes = 0;
    let empty = create_record(root.path(), &budget).unwrap();
    verify_package(root.path(), &empty, &budget).unwrap();
    fs::write(root.path().join("a"), b"").unwrap();
    assert_limit(
        create_record(root.path(), &budget).unwrap_err(),
        "max_files",
    );
    budget.max_files = 1;
    let zero_length = create_record(root.path(), &budget).unwrap();
    verify_package(root.path(), &zero_length, &budget).unwrap();
    fs::write(root.path().join("a"), b"x").unwrap();
    assert_limit(
        verify_package(root.path(), &zero_length, &budget).unwrap_err(),
        "max_file_bytes",
    );
}

#[cfg(unix)]
#[test]
fn symlink_replacement_cannot_supply_bytes_to_a_verified_package() {
    use std::os::unix::fs::symlink;
    let root = package(&[("main.js", b"abc")]);
    let outside = package(&[("replacement.js", b"abc")]);
    let trusted = create_record(root.path(), &limits()).unwrap();
    let before = trusted.to_json().unwrap();
    fs::remove_file(root.path().join("main.js")).unwrap();
    symlink(
        outside.path().join("replacement.js"),
        root.path().join("main.js"),
    )
    .unwrap();
    assert!(matches!(
        verify_package(root.path(), &trusted, &limits()),
        Err(IntegrityError::Filesystem { .. })
    ));
    assert!(matches!(
        create_record(root.path(), &limits()),
        Err(IntegrityError::Filesystem { .. })
    ));
    assert_eq!(trusted.to_json().unwrap(), before);
}
