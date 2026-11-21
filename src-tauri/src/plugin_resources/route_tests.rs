use super::route::{ResourceRoute, RouteError};
use super::*;
use crate::plugin_integrity::{create_record, verify_package, IntegrityLimits};
use std::fs;
use tauri::http::{header, Method, Request, Response, StatusCode};

const RESOURCE: &str = "fixture-resource://localhost";
const SHELL: &str = "tauri://localhost";

fn route() -> ResourceRoute {
    ResourceRoute::new(RESOURCE, SHELL, IntegrityLimits::default()).unwrap()
}

fn source(files: &[(&str, &[u8])]) -> tempfile::TempDir {
    let root = tempfile::tempdir().unwrap();
    for (path, bytes) in files {
        let destination = root.path().join(path);
        fs::create_dir_all(destination.parent().unwrap()).unwrap();
        fs::write(destination, bytes).unwrap();
    }
    root
}

fn fixture(files: &[(&str, &[u8])]) -> (SnapshotPool, WebViewHandle, SnapshotId) {
    let root = source(files);
    let limits = IntegrityLimits::default();
    let record = create_record(root.path(), &limits).unwrap();
    let package = verify_package(root.path(), &record, &limits).unwrap();
    let fingerprint = package.fingerprint();
    let mut pool = SnapshotPool::new(SnapshotLimits {
        max_snapshots: 10,
        max_retained_bytes: 100_000,
    });
    let view = pool.open_webview().unwrap();
    let id = pool.admit(&view, package).unwrap();
    assert_eq!(id, SnapshotId(fingerprint));
    root.close().unwrap();
    (pool, view, id)
}

fn request(method: Method, url: &str) -> Request<Vec<u8>> {
    Request::builder()
        .method(method)
        .uri(url)
        .body(Vec::new())
        .unwrap()
}

fn assert_common(response: &Response<&[u8]>) {
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(
        response.headers()[header::X_CONTENT_TYPE_OPTIONS],
        "nosniff"
    );
    assert_eq!(
        response.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        SHELL
    );
    assert_eq!(response.headers()[header::VARY], "Origin");
    assert_eq!(
        response.headers()[header::ACCESS_CONTROL_EXPOSE_HEADERS],
        "Content-Type, Content-Length, Cache-Control, X-Content-Type-Options, Access-Control-Allow-Origin, Allow"
    );
    for absent in [
        header::ACCESS_CONTROL_ALLOW_CREDENTIALS,
        header::LOCATION,
        header::ACCEPT_RANGES,
        header::ETAG,
        header::LAST_MODIFIED,
    ] {
        assert!(!response.headers().contains_key(absent));
    }
}

fn assert_error(response: &Response<&[u8]>, status: StatusCode) {
    assert_eq!(response.status(), status);
    assert_common(response);
    assert!(response.body().is_empty());
    assert_eq!(response.headers()[header::CONTENT_LENGTH], "0");
}

#[test]
fn snapshot_hex_is_full_canonical_fingerprint() {
    let id = SnapshotId(std::array::from_fn(|index| index as u8));
    let hex = id.to_hex();
    assert_eq!(
        hex,
        "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f"
    );
    assert_eq!(SnapshotId::from_hex(&hex), Some(id));
    for invalid in [
        hex.to_uppercase(),
        hex[..63].to_owned(),
        format!("{hex}0"),
        "g".repeat(64),
        "é".repeat(32),
    ] {
        assert_eq!(SnapshotId::from_hex(&invalid), None);
    }
}

#[test]
fn encoded_names_round_trip_once_without_normalizing() {
    let files: &[(&str, &[u8])] = &[
        ("dir name/日本語 #%.js", b"module"),
        ("literal%2F.txt", b"percent slash"),
        ("%2e%2e.txt", b"percent dots"),
        ("café.txt", b"composed"),
    ];
    let (pool, view, id) = fixture(files);
    let route = route();
    for (path, expected) in files {
        let url = route.file_url(id, path).unwrap();
        let response = route.respond(&pool, &view, &request(Method::GET, &url));
        assert_eq!(response.status(), StatusCode::OK, "{url}");
        assert_eq!(response.body(), expected);
    }
    assert_eq!(
        route.file_url(id, files[0].0).unwrap(),
        format!(
            "{RESOURCE}/snapshots/{}/dir%20name/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%23%25.js",
            id.to_hex()
        )
    );
    for path in ["Café.txt", "cafe\u{301}.txt", "dir name/日本語 #%.JS"] {
        let url = route.file_url(id, path).unwrap();
        assert_error(
            &route.respond(&pool, &view, &request(Method::GET, &url)),
            StatusCode::NOT_FOUND,
        );
    }
}

#[test]
fn malformed_and_unsafe_paths_are_bad_requests_for_get_and_head() {
    let (pool, view, id) = fixture(&[("dir/file.js", b"ok")]);
    let route = route();
    let prefix = format!("{RESOURCE}/snapshots/{}/", id.to_hex());
    for path in [
        "",
        "/dir/file.js",
        "dir//file.js",
        "dir/",
        ".",
        "..",
        "./dir/file.js",
        "dir/../file.js",
        "%2e%2e/file.js",
        "dir%2ffile.js",
        "dir%2Ffile.js",
        "dir%5cfile.js",
        "dir%5Cfile.js",
        "bad%",
        "bad%2",
        "bad%GG",
        "%FF.js",
        "%C0%AF.js",
        "%00.js",
        "CON.txt",
        "bad%3F.js",
        "file.js?",
        "file.js?raw",
        "file.js?x=1",
        "x%20",
        "x.",
    ] {
        for method in [Method::GET, Method::HEAD] {
            let url = format!("{prefix}{path}");
            assert_error(
                &route.respond(&pool, &view, &request(method, &url)),
                StatusCode::BAD_REQUEST,
            );
        }
    }
    for url in [
        format!("{RESOURCE}/"),
        format!(
            "{RESOURCE}/snapshots/{}/dir/file.js",
            id.to_hex().to_uppercase()
        ),
        format!("{RESOURCE}/snapshots/abcd/dir/file.js"),
        format!("{RESOURCE}/snapshots/%30{}/dir/file.js", &id.to_hex()[1..]),
        format!("{RESOURCE}/other/{}/dir/file.js", id.to_hex()),
    ] {
        assert_error(
            &route.respond(&pool, &view, &request(Method::GET, &url)),
            StatusCode::BAD_REQUEST,
        );
    }
}

#[test]
fn read_methods_reject_request_bodies() {
    let (mut pool, view, id) = fixture(&[("file.dat", b"verified")]);
    let unassociated = pool.open_webview().unwrap();
    let route = route();
    let url = route.file_url(id, "file.dat").unwrap();
    for method in [Method::GET, Method::HEAD] {
        let request = Request::builder()
            .method(method)
            .uri(&url)
            .body(b"unexpected".to_vec())
            .unwrap();
        assert_error(
            &route.respond(&pool, &view, &request),
            StatusCode::BAD_REQUEST,
        );
        assert_error(
            &route.respond(&pool, &unassociated, &request),
            StatusCode::FORBIDDEN,
        );
    }
}

#[test]
fn file_url_reuses_integrity_path_limits_and_portable_rules() {
    let limits = IntegrityLimits {
        max_path_bytes: 12,
        max_depth: 2,
        ..IntegrityLimits::default()
    };
    let route = ResourceRoute::new(RESOURCE, SHELL, limits).unwrap();
    let id = SnapshotId([0; 32]);
    assert!(route.file_url(id, "a/hello.txt").is_ok());
    for path in [
        "",
        "/x",
        "a\\b",
        "a/../b",
        "a//b",
        "a/b/c",
        "1234567890123",
        "NUL",
        "a?b",
        "a ",
    ] {
        assert_eq!(route.file_url(id, path), Err(RouteError::InvalidPath));
    }
}

#[test]
fn encoded_and_decoded_path_sizes_are_bounded() {
    let (pool, view, id) = fixture(&[("file.txt", b"ok")]);
    let limits = IntegrityLimits {
        max_path_bytes: 8,
        max_depth: 1,
        ..IntegrityLimits::default()
    };
    let route = ResourceRoute::new(RESOURCE, SHELL, limits).unwrap();
    let prefix = format!("{RESOURCE}/snapshots/{}/", id.to_hex());
    for path in ["x".repeat(9), "%61".repeat(9), "x".repeat(10_000)] {
        assert_error(
            &route.respond(
                &pool,
                &view,
                &request(Method::GET, &format!("{prefix}{path}")),
            ),
            StatusCode::BAD_REQUEST,
        );
    }
    let url = format!("{prefix}%66%69%6c%65%2e%74%78%74");
    assert_eq!(
        route
            .respond(&pool, &view, &request(Method::GET, &url))
            .status(),
        StatusCode::OK
    );
}

#[test]
fn origins_require_exact_native_configuration() {
    for resource in [
        RESOURCE,
        "http://fixture-resource.localhost",
        "https://fixture-resource.localhost:444",
    ] {
        let route = ResourceRoute::new(resource, SHELL, IntegrityLimits::default()).unwrap();
        let (pool, view, id) = fixture(&[("file.txt", b"ok")]);
        let url = route.file_url(id, "file.txt").unwrap();
        assert!(url.starts_with(resource));
        assert_eq!(
            route
                .respond(&pool, &view, &request(Method::GET, &url))
                .status(),
            StatusCode::OK
        );
    }
    for invalid in [
        "*",
        "null",
        "http://*.localhost",
        "http://user@localhost",
        "http://localhost/",
        "http://localhost/path",
        "http://localhost?",
        "http://localhost#x",
        "http://localhost\r\nX: y",
        "http://local host",
        "http://localhost:bad",
        "http://localhost:65536",
        "http://localhost:",
        "http://local,host",
        "http://localhost%2fother",
        "http://localhost\\other",
        "localhost",
        "http://",
    ] {
        assert!(
            ResourceRoute::new(invalid, SHELL, IntegrityLimits::default()).is_err(),
            "{invalid:?}"
        );
        assert!(
            ResourceRoute::new(RESOURCE, invalid, IntegrityLimits::default()).is_err(),
            "{invalid:?}"
        );
    }
    assert!(ResourceRoute::new(RESOURCE, RESOURCE, IntegrityLimits::default()).is_err());
    for (resource, shell) in [
        ("http://localhost", "http://LOCALHOST:80"),
        ("https://localhost:443", "https://localhost"),
    ] {
        assert!(ResourceRoute::new(resource, shell, IntegrityLimits::default()).is_err());
    }
}

#[test]
fn request_origin_is_exact_and_relative_requests_have_no_fallback() {
    let (pool, view, id) = fixture(&[("file.txt", b"ok")]);
    let route = route();
    for origin in [
        "http://localhost",
        "fixture-resource://other",
        "fixture-resource://LOCALHOST",
        "fixture-resource://localhost:80",
        "fixture-resource://user@localhost",
    ] {
        let url = format!("{origin}/snapshots/{}/file.txt", id.to_hex());
        assert_error(
            &route.respond(&pool, &view, &request(Method::GET, &url)),
            StatusCode::BAD_REQUEST,
        );
    }
    let url = format!("/snapshots/{}/file.txt", id.to_hex());
    assert_error(
        &route.respond(&pool, &view, &request(Method::GET, &url)),
        StatusCode::BAD_REQUEST,
    );
}

#[test]
fn get_and_head_share_metadata_and_borrow_original_bytes() {
    let (pool, view, id) = fixture(&[("module.js", b"export default 42;")]);
    let route = route();
    let url = route.file_url(id, "module.js").unwrap();
    let get = route.respond(&pool, &view, &request(Method::GET, &url));
    let head = route.respond(&pool, &view, &request(Method::HEAD, &url));
    assert_eq!(get.status(), StatusCode::OK);
    assert_eq!(head.status(), get.status());
    assert_eq!(head.headers(), get.headers());
    assert_common(&get);
    assert_eq!(get.headers()[header::CONTENT_LENGTH], "18");
    assert_eq!(get.headers()[header::CONTENT_TYPE], "text/javascript");
    assert_eq!(*get.body(), b"export default 42;");
    assert!(head.body().is_empty());
    assert!(std::ptr::eq(
        get.body().as_ptr(),
        pool.file(&view, id, "module.js").unwrap().as_ptr()
    ));
}

#[test]
fn unsupported_methods_are_empty_405_with_allow() {
    let (pool, view, id) = fixture(&[("file.txt", b"ok")]);
    let route = route();
    let url = route.file_url(id, "file.txt").unwrap();
    for method in [
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::OPTIONS,
        Method::PATCH,
        Method::TRACE,
    ] {
        let response = route.respond(&pool, &view, &request(method, &url));
        assert_error(&response, StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(response.headers()[header::ALLOW], "GET, HEAD");
    }
}

#[test]
fn mime_map_is_host_owned_without_sniffing_or_html_pages() {
    let types = [
        ("js", "text/javascript"),
        ("mjs", "text/javascript"),
        ("css", "text/css"),
        ("json", "application/json"),
        ("svg", "image/svg+xml"),
        ("png", "image/png"),
        ("jpg", "image/jpeg"),
        ("jpeg", "image/jpeg"),
        ("webp", "image/webp"),
        ("woff2", "font/woff2"),
        ("woff", "font/woff"),
        ("ttf", "font/ttf"),
        ("otf", "font/otf"),
        ("txt", "text/plain"),
        ("wasm", "application/wasm"),
        ("gif", "image/gif"),
        ("html", "application/octet-stream"),
        ("bin", "application/octet-stream"),
        ("", "application/octet-stream"),
    ];
    let names: Vec<String> = types
        .iter()
        .map(|(ext, _)| {
            if ext.is_empty() {
                "noextension".into()
            } else {
                format!("file.{ext}")
            }
        })
        .collect();
    let bytes: &[u8] = b"<html>\0\xff";
    let files: Vec<(&str, &[u8])> = names.iter().map(|name| (name.as_str(), bytes)).collect();
    let (pool, view, id) = fixture(&files);
    let route = route();
    for (name, (_, expected)) in names.iter().zip(types) {
        let response = route.respond(
            &pool,
            &view,
            &request(Method::GET, &route.file_url(id, name).unwrap()),
        );
        assert_eq!(response.headers()[header::CONTENT_TYPE], expected);
        assert_eq!(*response.body(), bytes);
    }
}

#[test]
fn cors_is_fixed_and_headers_never_create_association() {
    let (mut pool, view, id) = fixture(&[("file.txt", b"ok")]);
    let unassociated = pool.open_webview().unwrap();
    let route = route();
    let url = route.file_url(id, "file.txt").unwrap();
    for origin in [SHELL, "https://attacker.invalid", "null", "*"] {
        let mut req = request(Method::GET, &url);
        req.headers_mut()
            .insert(header::ORIGIN, origin.parse().unwrap());
        req.headers_mut()
            .insert("x-webview-label", "associated".parse().unwrap());
        req.headers_mut()
            .insert("x-snapshot-id", id.to_hex().parse().unwrap());
        let allowed = route.respond(&pool, &view, &req);
        assert_eq!(allowed.status(), StatusCode::OK);
        assert_common(&allowed);
        assert_error(
            &route.respond(&pool, &unassociated, &req),
            StatusCode::FORBIDDEN,
        );
    }
}

#[test]
fn foreign_and_closed_handles_fail_before_metadata_or_path_lookup() {
    let (mut pool, view, id) = fixture(&[("file.txt", b"ok")]);
    let (_, foreign, _) = fixture(&[("file.txt", b"other")]);
    pool.close_webview(&view).unwrap();
    let route = route();
    for handle in [&foreign, &view] {
        for method in [Method::GET, Method::HEAD, Method::POST] {
            for url in [
                route.file_url(id, "file.txt").unwrap(),
                "http://wrong/invalid?".to_owned(),
            ] {
                assert_error(
                    &route.respond(&pool, handle, &request(method.clone(), &url)),
                    StatusCode::FORBIDDEN,
                );
            }
        }
    }
}

#[test]
fn missing_snapshot_and_files_are_404_with_identical_head_checks() {
    let (mut pool, view, id) = fixture(&[("file.txt", b"ok")]);
    let unassociated = pool.open_webview().unwrap();
    let route = route();
    for method in [Method::GET, Method::HEAD] {
        for (target_id, path) in [(id, "missing.txt"), (SnapshotId([0; 32]), "file.txt")] {
            let url = route.file_url(target_id, path).unwrap();
            assert_error(
                &route.respond(&pool, &view, &request(method.clone(), &url)),
                StatusCode::NOT_FOUND,
            );
        }
        let url = route.file_url(id, "missing.txt").unwrap();
        assert_error(
            &route.respond(&pool, &unassociated, &request(method, &url)),
            StatusCode::FORBIDDEN,
        );
    }
}

#[test]
fn source_changes_and_range_headers_cannot_change_verified_delivery() {
    let root = source(&[("file.txt", b"original")]);
    let limits = IntegrityLimits::default();
    let record = create_record(root.path(), &limits).unwrap();
    let package = verify_package(root.path(), &record, &limits).unwrap();
    let mut pool = SnapshotPool::new(SnapshotLimits {
        max_snapshots: 1,
        max_retained_bytes: 100,
    });
    let view = pool.open_webview().unwrap();
    let id = pool.admit(&view, package).unwrap();
    fs::write(root.path().join("file.txt"), b"replacement").unwrap();
    root.close().unwrap();
    let route = route();
    let mut req = request(Method::GET, &route.file_url(id, "file.txt").unwrap());
    req.headers_mut()
        .insert(header::RANGE, "bytes=0-1".parse().unwrap());
    req.headers_mut()
        .insert(header::IF_NONE_MATCH, "*".parse().unwrap());
    let response = route.respond(&pool, &view, &req);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(*response.body(), b"original");
    assert_eq!(response.headers()[header::CONTENT_LENGTH], "8");
    assert_common(&response);
}

#[test]
fn standalone_errors_include_fail_closed_and_budget_headers() {
    let route = route();
    for status in [
        StatusCode::FORBIDDEN,
        StatusCode::BAD_REQUEST,
        StatusCode::TOO_MANY_REQUESTS,
        StatusCode::INTERNAL_SERVER_ERROR,
    ] {
        assert_error(&route.error(status), status);
    }
}
