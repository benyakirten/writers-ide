use super::*;
use crate::plugin_integrity::{
    create_record, verify_package, IntegrityLimits, IntegrityRecord, VerifiedPackage,
};
use std::fs;
use std::path::Component;
use tempfile::TempDir;

fn source(files: &[(&str, &[u8])]) -> TempDir {
    let root = tempfile::tempdir().unwrap();
    for (path, bytes) in files {
        assert!(!path.is_empty());
        assert!(std::path::Path::new(path)
            .components()
            .all(|component| matches!(component, Component::Normal(_))));
        let destination = root.path().join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(destination, bytes).unwrap();
    }
    root
}

fn verified(files: &[(&str, &[u8])]) -> VerifiedPackage {
    let root = source(files);
    let limits = IntegrityLimits::default();
    let record = create_record(root.path(), &limits).unwrap();
    let package = verify_package(root.path(), &record, &limits).unwrap();
    root.close().unwrap();
    package
}

fn pool_with_limits(max_snapshots: usize, max_retained_bytes: u64) -> SnapshotPool {
    SnapshotPool::new(SnapshotLimits {
        max_snapshots,
        max_retained_bytes,
    })
}

fn assert_usage(pool: &SnapshotPool, snapshots: usize, retained_bytes: u64) {
    assert_eq!(
        pool.usage(),
        SnapshotUsage {
            snapshots,
            retained_bytes,
        }
    );
}

#[test]
fn independently_verified_identical_records_share_snapshot_and_backing() {
    let files: &[(&str, &[u8])] = &[("main.js", b"abc"), ("assets/data.bin", &[0, 255])];
    let mut pool = pool_with_limits(1, 5);
    let first_view = pool.open_webview().unwrap();
    let second_view = pool.open_webview().unwrap();
    let first = pool.admit(&first_view, verified(files)).unwrap();
    let second = pool
        .admit(
            &second_view,
            verified(&[("assets/data.bin", &[0, 255]), ("main.js", b"abc")]),
        )
        .unwrap();
    assert_eq!(first, second);
    assert_usage(&pool, 1, 5);
    for (path, expected) in files {
        let first_bytes = pool.file(&first_view, first, path).unwrap();
        let second_bytes = pool.file(&second_view, second, path).unwrap();
        assert_eq!(first_bytes, *expected);
        assert!(std::ptr::eq(first_bytes, second_bytes));
    }
}

#[test]
fn equivalent_record_json_encodings_share_snapshot_and_backing() {
    let files: &[(&str, &[u8])] = &[("a.js", b"abc"), ("b.js", b"de")];
    let root = source(files);
    let limits = IntegrityLimits::default();
    let encoded = create_record(root.path(), &limits)
        .unwrap()
        .to_json()
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
    let alternative = format!(
        r#"{{
            "files": {{
                "b.js": {{ "sha256": {}, "byte_length": {} }},
                "\u0061.js": {{ "sha256": {}, "byte_length": {} }}
            }},
            "format_version": {}
        }}"#,
        value["files"]["b.js"]["sha256"],
        value["files"]["b.js"]["byte_length"],
        value["files"]["a.js"]["sha256"],
        value["files"]["a.js"]["byte_length"],
        value["format_version"],
    );
    assert_ne!(encoded, alternative.as_bytes());
    let first_record = IntegrityRecord::from_json(&encoded, &limits).unwrap();
    let second_record = IntegrityRecord::from_json(alternative.as_bytes(), &limits).unwrap();
    assert_eq!(first_record, second_record);
    let first_package = verify_package(root.path(), &first_record, &limits).unwrap();
    let second_package = verify_package(root.path(), &second_record, &limits).unwrap();
    root.close().unwrap();

    let mut pool = pool_with_limits(1, 5);
    let first_view = pool.open_webview().unwrap();
    let second_view = pool.open_webview().unwrap();
    let first = pool.admit(&first_view, first_package).unwrap();
    let second = pool.admit(&second_view, second_package).unwrap();
    assert_eq!(first, second);
    assert_usage(&pool, 1, 5);
    for (path, expected) in files {
        let first_bytes = pool.file(&first_view, first, path).unwrap();
        let second_bytes = pool.file(&second_view, second, path).unwrap();
        assert_eq!(first_bytes, *expected);
        assert_eq!(second_bytes, *expected);
        assert!(std::ptr::eq(first_bytes, second_bytes));
    }
}

#[test]
fn webview_identifier_exhaustion_does_not_wrap_or_revive_closed_handles() {
    let mut pool = pool_with_limits(1, 3);
    let closed = pool.open_webview().unwrap();
    pool.close_webview(&closed).unwrap();
    let live = pool.open_webview().unwrap();
    let snapshot = pool.admit(&live, verified(&[("a.js", b"abc")])).unwrap();
    pool.next_view = u64::MAX - 1;
    let last = pool.open_webview().unwrap();
    assert_eq!(pool.next_view, u64::MAX);
    assert_eq!(
        pool.admit(&last, verified(&[("a.js", b"abc")])),
        Ok(snapshot)
    );

    for _ in 0..2 {
        assert_eq!(
            pool.open_webview().unwrap_err(),
            SnapshotError::IdentifierExhausted
        );
        assert_eq!(pool.next_view, u64::MAX);
        assert_usage(&pool, 1, 3);
        assert_eq!(pool.file(&live, snapshot, "a.js"), Ok(&b"abc"[..]));
        assert_eq!(pool.file(&last, snapshot, "a.js"), Ok(&b"abc"[..]));
        assert_eq!(
            pool.file(&closed, snapshot, "a.js"),
            Err(SnapshotError::WebViewUnavailable)
        );
        assert_eq!(
            pool.admit(&closed, verified(&[("a.js", b"abc")])),
            Err(SnapshotError::WebViewUnavailable)
        );
        assert_eq!(pool.close_webview(&closed), Ok(()));
    }
    pool.close_webview(&live).unwrap();
    assert_usage(&pool, 1, 3);
    assert_eq!(pool.file(&last, snapshot, "a.js"), Ok(&b"abc"[..]));
    pool.close_webview(&last).unwrap();
    assert_usage(&pool, 0, 0);
    assert_eq!(
        pool.open_webview().unwrap_err(),
        SnapshotError::IdentifierExhausted
    );
    assert_eq!(pool.next_view, u64::MAX);
}

#[test]
fn repeated_association_is_idempotent_and_one_close_releases_it() {
    let mut pool = pool_with_limits(1, 3);
    let view = pool.open_webview().unwrap();
    let snapshot = pool.admit(&view, verified(&[("main.js", b"abc")])).unwrap();
    for _ in 0..3 {
        assert_eq!(
            pool.admit(&view, verified(&[("main.js", b"abc")])),
            Ok(snapshot)
        );
        assert_usage(&pool, 1, 3);
    }
    pool.close_webview(&view).unwrap();
    assert_usage(&pool, 0, 0);
    assert_eq!(pool.close_webview(&view), Ok(()));
    assert_usage(&pool, 0, 0);
}

#[test]
fn access_requires_association_before_exact_file_lookup() {
    let mut pool = pool_with_limits(2, 100);
    let owner = pool.open_webview().unwrap();
    let other = pool.open_webview().unwrap();
    let snapshot = pool
        .admit(&owner, verified(&[("assets/Main.js", b"abc")]))
        .unwrap();
    assert_eq!(
        pool.file(&other, snapshot, "assets/Main.js"),
        Err(SnapshotError::AccessDenied)
    );
    assert_eq!(
        pool.file(&other, snapshot, "missing"),
        Err(SnapshotError::AccessDenied)
    );
    assert_eq!(
        pool.file(&owner, snapshot, "assets/Main.js"),
        Ok(&b"abc"[..])
    );
    for path in [
        "missing",
        "assets/main.js",
        "./assets/Main.js",
        "/assets/Main.js",
        "assets/../assets/Main.js",
        "assets\\Main.js",
        "assets/Main.js?query",
        "assets/Main.js#fragment",
        "",
    ] {
        assert_eq!(
            pool.file(&owner, snapshot, path),
            Err(SnapshotError::FileNotFound),
            "lookup must be exact for {path:?}"
        );
    }
    assert_usage(&pool, 1, 3);
}

#[test]
fn foreign_handles_are_rejected_without_changing_either_pool() {
    let mut first_pool = pool_with_limits(2, 10);
    let mut second_pool = pool_with_limits(2, 10);
    let first_view = first_pool.open_webview().unwrap();
    let second_view = second_pool.open_webview().unwrap();
    let snapshot = first_pool
        .admit(&first_view, verified(&[("main.js", b"abc")]))
        .unwrap();
    assert_eq!(
        first_pool.admit(&second_view, verified(&[("other.js", b"x")])),
        Err(SnapshotError::WebViewUnavailable)
    );
    assert_eq!(
        first_pool.file(&second_view, snapshot, "main.js"),
        Err(SnapshotError::WebViewUnavailable)
    );
    assert_eq!(
        first_pool.close_webview(&second_view),
        Err(SnapshotError::WebViewUnavailable)
    );
    assert_eq!(
        second_pool.close_webview(&first_view),
        Err(SnapshotError::WebViewUnavailable)
    );
    assert_usage(&first_pool, 1, 3);
    assert_usage(&second_pool, 0, 0);
    second_pool
        .admit(&second_view, verified(&[("other.js", b"x")]))
        .unwrap();
    assert_usage(&second_pool, 1, 1);
    assert_eq!(
        first_pool.file(&first_view, snapshot, "main.js"),
        Ok(&b"abc"[..])
    );
}

#[test]
fn cloned_closed_handles_stay_closed_after_a_new_view_opens() {
    let mut pool = pool_with_limits(1, 3);
    let old_view = pool.open_webview().unwrap();
    let clone = old_view.clone();
    let old_snapshot = pool
        .admit(&old_view, verified(&[("main.js", b"abc")]))
        .unwrap();
    pool.close_webview(&clone).unwrap();
    assert_eq!(pool.close_webview(&old_view), Ok(()));
    let new_view = pool.open_webview().unwrap();
    let new_snapshot = pool
        .admit(&new_view, verified(&[("main.js", b"abc")]))
        .unwrap();
    for stale in [&old_view, &clone] {
        assert_eq!(
            pool.file(stale, old_snapshot, "main.js"),
            Err(SnapshotError::WebViewUnavailable)
        );
        assert_eq!(
            pool.file(stale, new_snapshot, "main.js"),
            Err(SnapshotError::WebViewUnavailable)
        );
        assert_eq!(
            pool.admit(stale, verified(&[("main.js", b"abc")])),
            Err(SnapshotError::WebViewUnavailable)
        );
        assert_eq!(pool.close_webview(stale), Ok(()));
    }
    assert_eq!(
        pool.file(&new_view, new_snapshot, "main.js"),
        Ok(&b"abc"[..])
    );
    assert_usage(&pool, 1, 3);
}

#[test]
fn closing_one_view_preserves_shared_bytes_until_last_view_closes() {
    let mut pool = pool_with_limits(1, 3);
    let first_view = pool.open_webview().unwrap();
    let second_view = pool.open_webview().unwrap();
    let observer = pool.open_webview().unwrap();
    let snapshot = pool
        .admit(&first_view, verified(&[("main.js", b"abc")]))
        .unwrap();
    assert_eq!(
        pool.admit(&second_view, verified(&[("main.js", b"abc")])),
        Ok(snapshot)
    );
    let backing = pool
        .file(&second_view, snapshot, "main.js")
        .unwrap()
        .as_ptr();
    pool.close_webview(&first_view).unwrap();
    assert_usage(&pool, 1, 3);
    assert_eq!(
        pool.file(&second_view, snapshot, "main.js"),
        Ok(&b"abc"[..])
    );
    assert_eq!(
        pool.file(&second_view, snapshot, "main.js")
            .unwrap()
            .as_ptr(),
        backing
    );
    pool.close_webview(&second_view).unwrap();
    assert_usage(&pool, 0, 0);
    assert_eq!(
        pool.file(&observer, snapshot, "main.js"),
        Err(SnapshotError::SnapshotUnavailable)
    );
    assert_eq!(
        pool.file(&observer, snapshot, "missing"),
        Err(SnapshotError::SnapshotUnavailable)
    );
    let replacement = pool
        .admit(&observer, verified(&[("other.js", b"xyz")]))
        .unwrap();
    assert_ne!(replacement, snapshot);
    assert_usage(&pool, 1, 3);
    assert_eq!(
        pool.file(&observer, snapshot, "other.js"),
        Err(SnapshotError::SnapshotUnavailable)
    );
}

#[test]
fn closing_view_releases_only_its_unshared_snapshots() {
    let mut pool = pool_with_limits(3, 10);
    let first = pool.open_webview().unwrap();
    let second = pool.open_webview().unwrap();
    pool.admit(&first, verified(&[("private.js", b"ab")]))
        .unwrap();
    let shared = pool
        .admit(&first, verified(&[("shared.js", b"cde")]))
        .unwrap();
    assert_eq!(
        pool.admit(&second, verified(&[("shared.js", b"cde")])),
        Ok(shared)
    );
    let second_only = pool
        .admit(&second, verified(&[("second.js", b"fghi")]))
        .unwrap();
    assert_usage(&pool, 3, 9);
    pool.close_webview(&first).unwrap();
    assert_usage(&pool, 2, 7);
    assert_eq!(pool.file(&second, shared, "shared.js"), Ok(&b"cde"[..]));
    assert_eq!(
        pool.file(&second, second_only, "second.js"),
        Ok(&b"fghi"[..])
    );
    pool.close_webview(&second).unwrap();
    assert_usage(&pool, 0, 0);
}

#[test]
fn count_limit_failure_is_atomic_and_does_not_leak_association() {
    let mut pool = pool_with_limits(1, 100);
    let owner = pool.open_webview().unwrap();
    let rejected = pool.open_webview().unwrap();
    let receiver = pool.open_webview().unwrap();
    let retained = pool
        .admit(&owner, verified(&[("retained.js", b"abc")]))
        .unwrap();
    assert_eq!(
        pool.admit(&rejected, verified(&[("candidate.js", b"xy")])),
        Err(SnapshotError::LimitExceeded(SnapshotLimit::Snapshots))
    );
    assert_usage(&pool, 1, 3);
    assert_eq!(pool.file(&owner, retained, "retained.js"), Ok(&b"abc"[..]));
    assert_eq!(
        pool.file(&rejected, retained, "retained.js"),
        Err(SnapshotError::AccessDenied)
    );
    pool.close_webview(&owner).unwrap();
    assert_usage(&pool, 0, 0);
    let candidate = pool
        .admit(&receiver, verified(&[("candidate.js", b"xy")]))
        .unwrap();
    assert_eq!(
        pool.file(&rejected, candidate, "candidate.js"),
        Err(SnapshotError::AccessDenied)
    );
    assert_eq!(
        pool.admit(&rejected, verified(&[("candidate.js", b"xy")])),
        Ok(candidate)
    );
    assert_usage(&pool, 1, 2);
    pool.close_webview(&receiver).unwrap();
    assert_usage(&pool, 1, 2);
    pool.close_webview(&rejected).unwrap();
    assert_usage(&pool, 0, 0);
}

#[test]
fn byte_limit_is_aggregate_exact_and_failed_admission_is_atomic() {
    let mut pool = pool_with_limits(10, 5);
    let owner = pool.open_webview().unwrap();
    let rejected = pool.open_webview().unwrap();
    let first = pool.admit(&owner, verified(&[("a", b"ab")])).unwrap();
    let second = pool.admit(&owner, verified(&[("b", b"cde")])).unwrap();
    assert_usage(&pool, 2, 5);
    assert_eq!(
        pool.admit(&rejected, verified(&[("candidate", b"x")])),
        Err(SnapshotError::LimitExceeded(SnapshotLimit::RetainedBytes))
    );
    assert_usage(&pool, 2, 5);
    assert_eq!(pool.file(&owner, first, "a"), Ok(&b"ab"[..]));
    assert_eq!(pool.file(&owner, second, "b"), Ok(&b"cde"[..]));
    pool.close_webview(&owner).unwrap();
    let receiver = pool.open_webview().unwrap();
    let candidate = pool
        .admit(&receiver, verified(&[("candidate", b"x")]))
        .unwrap();
    assert_eq!(
        pool.file(&rejected, candidate, "candidate"),
        Err(SnapshotError::AccessDenied)
    );
    pool.close_webview(&receiver).unwrap();
    assert_usage(&pool, 0, 0);
    pool.admit(&rejected, verified(&[("exact", b"12345")]))
        .unwrap();
    assert_usage(&pool, 1, 5);
}

#[test]
fn individually_oversized_package_does_not_consume_capacity() {
    let mut pool = pool_with_limits(1, 3);
    let view = pool.open_webview().unwrap();
    assert_eq!(
        pool.admit(&view, verified(&[("main.js", b"abcd")])),
        Err(SnapshotError::LimitExceeded(SnapshotLimit::RetainedBytes))
    );
    assert_usage(&pool, 0, 0);
    pool.admit(&view, verified(&[("main.js", b"abc")])).unwrap();
    assert_usage(&pool, 1, 3);
}

#[test]
fn zero_snapshot_limit_rejects_even_empty_packages() {
    let mut pool = pool_with_limits(0, 100);
    let view = pool.open_webview().unwrap();
    for files in [&[][..], &[("empty", &b""[..])][..]] {
        assert_eq!(
            pool.admit(&view, verified(files)),
            Err(SnapshotError::LimitExceeded(SnapshotLimit::Snapshots))
        );
        assert_usage(&pool, 0, 0);
    }
    pool.close_webview(&view).unwrap();
    assert_usage(&pool, 0, 0);
}

#[test]
fn zero_byte_limit_accepts_zero_bytes_but_counts_distinct_file_sets() {
    let mut pool = pool_with_limits(2, 0);
    let view = pool.open_webview().unwrap();
    let empty_package = pool.admit(&view, verified(&[])).unwrap();
    let empty_file = pool.admit(&view, verified(&[("empty", b"")])).unwrap();
    assert_ne!(empty_package, empty_file);
    assert_usage(&pool, 2, 0);
    assert_eq!(
        pool.file(&view, empty_package, "empty"),
        Err(SnapshotError::FileNotFound)
    );
    assert_eq!(pool.file(&view, empty_file, "empty"), Ok(&b""[..]));
    assert_eq!(pool.admit(&view, verified(&[])), Ok(empty_package));
    assert_eq!(
        pool.admit(&view, verified(&[("empty", b"")])),
        Ok(empty_file)
    );
    pool.close_webview(&view).unwrap();
    let view = pool.open_webview().unwrap();
    assert_eq!(
        pool.admit(&view, verified(&[("nonempty", b"x")])),
        Err(SnapshotError::LimitExceeded(SnapshotLimit::RetainedBytes))
    );
    assert_usage(&pool, 0, 0);
}

#[test]
fn different_bytes_paths_and_file_boundaries_have_distinct_identities() {
    let mut pool = pool_with_limits(6, 100);
    let view = pool.open_webview().unwrap();
    let variants: &[&[(&str, &[u8])]] = &[
        &[("a", b"ab"), ("b", b"c")],
        &[("a", b"ax"), ("b", b"c")],
        &[("a", b"a"), ("b", b"bc")],
        &[("a", b"ab"), ("c", b"c")],
        &[("a", b"ab"), ("b", b"c"), ("empty", b"")],
        &[("a", b"abc")],
    ];
    let mut snapshots = Vec::new();
    for files in variants {
        let snapshot = pool.admit(&view, verified(files)).unwrap();
        assert!(!snapshots.contains(&snapshot));
        snapshots.push(snapshot);
        for (path, bytes) in *files {
            assert_eq!(pool.file(&view, snapshot, path), Ok(*bytes));
        }
    }
    assert_usage(&pool, 6, 18);
}

#[test]
fn repeated_verification_against_same_accepted_record_deduplicates() {
    let root = source(&[("main.js", b"abc")]);
    let limits = IntegrityLimits::default();
    let record = create_record(root.path(), &limits).unwrap();
    let first = verify_package(root.path(), &record, &limits).unwrap();
    let second = verify_package(root.path(), &record, &limits).unwrap();
    root.close().unwrap();
    let mut pool = pool_with_limits(1, 3);
    let first_view = pool.open_webview().unwrap();
    let second_view = pool.open_webview().unwrap();
    let snapshot = pool.admit(&first_view, first).unwrap();
    assert_eq!(pool.admit(&second_view, second), Ok(snapshot));
    assert_usage(&pool, 1, 3);
    assert!(std::ptr::eq(
        pool.file(&first_view, snapshot, "main.js").unwrap(),
        pool.file(&second_view, snapshot, "main.js").unwrap()
    ));
}

#[test]
fn retained_bytes_survive_source_mutation_deletion_and_failed_reverification() {
    let root = source(&[("main.js", b"abc"), ("assets/data", &[0, 255])]);
    let limits = IntegrityLimits::default();
    let accepted = create_record(root.path(), &limits).unwrap();
    let package = verify_package(root.path(), &accepted, &limits).unwrap();
    let mut pool = pool_with_limits(1, 5);
    let view = pool.open_webview().unwrap();
    let snapshot = pool.admit(&view, package).unwrap();
    let backing = pool.file(&view, snapshot, "main.js").unwrap().as_ptr();
    fs::write(root.path().join("main.js"), b"xyz").unwrap();
    assert!(verify_package(root.path(), &accepted, &limits).is_err());
    assert_eq!(pool.file(&view, snapshot, "main.js"), Ok(&b"abc"[..]));
    assert_eq!(pool.file(&view, snapshot, "assets/data"), Ok(&[0, 255][..]));
    assert_usage(&pool, 1, 5);
    fs::remove_file(root.path().join("assets/data")).unwrap();
    assert!(verify_package(root.path(), &accepted, &limits).is_err());
    root.close().unwrap();
    assert_eq!(pool.file(&view, snapshot, "main.js"), Ok(&b"abc"[..]));
    assert_eq!(pool.file(&view, snapshot, "assets/data"), Ok(&[0, 255][..]));
    assert_eq!(
        pool.file(&view, snapshot, "main.js").unwrap().as_ptr(),
        backing
    );
    assert_usage(&pool, 1, 5);
    let second_view = pool.open_webview().unwrap();
    assert_eq!(
        pool.admit(
            &second_view,
            verified(&[("main.js", b"abc"), ("assets/data", &[0, 255])])
        ),
        Ok(snapshot)
    );
    assert_usage(&pool, 1, 5);
}
