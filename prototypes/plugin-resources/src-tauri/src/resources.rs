use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use tauri::http::{Request, Response, StatusCode};

use crate::{
    plugin_integrity::{IntegrityLimits, VerifiedPackage},
    plugin_resources::{
        route::ResourceRoute, SnapshotId, SnapshotLimits, SnapshotPool, SnapshotUsage,
        WebViewHandle,
    },
};

pub(crate) const MAX_REQUESTS: usize = 2048;
pub(crate) const MAX_CONCURRENT: usize = 8;
const MAX_DELIVERED_BYTES: usize = 128 * 1024 * 1024;

#[cfg(target_os = "windows")]
pub(crate) const BASE_ORIGIN: &str = "http://fixture-resource.localhost";
#[cfg(not(target_os = "windows"))]
pub(crate) const BASE_ORIGIN: &str = "fixture-resource://localhost";

#[cfg(target_os = "windows")]
const SHELL_ORIGIN: &str = "http://tauri.localhost";
#[cfg(not(target_os = "windows"))]
const SHELL_ORIGIN: &str = "tauri://localhost";

pub(crate) struct Resources {
    route: ResourceRoute,
    state: Mutex<State>,
    requests: AtomicUsize,
    active: AtomicUsize,
    delivered: AtomicUsize,
}

struct State {
    pool: SnapshotPool,
    views: BTreeMap<String, WebViewHandle>,
}

struct Active<'a>(&'a AtomicUsize);
impl Drop for Active<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

fn reserve(counter: &AtomicUsize, amount: usize, limit: usize) -> bool {
    let mut current = counter.load(Ordering::Acquire);
    loop {
        let Some(next) = current.checked_add(amount).filter(|next| *next <= limit) else {
            return false;
        };
        match counter.compare_exchange_weak(current, next, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => return true,
            Err(actual) => current = actual,
        }
    }
}

impl Resources {
    pub(crate) fn new(limits: SnapshotLimits) -> Self {
        Self {
            route: ResourceRoute::new(BASE_ORIGIN, SHELL_ORIGIN, IntegrityLimits::default())
                .expect("fixed fixture resource origins and path limits"),
            state: Mutex::new(State {
                pool: SnapshotPool::new(limits),
                views: BTreeMap::new(),
            }),
            requests: AtomicUsize::new(0),
            active: AtomicUsize::new(0),
            delivered: AtomicUsize::new(0),
        }
    }

    // These lifecycle methods are native host operations, not IPC commands.
    pub(crate) fn register_view(&self, label: &str) -> Result<(), String> {
        let mut state = self.state.lock().map_err(|_| "resource state poisoned")?;
        if state.views.contains_key(label) {
            return Err("WebView label is already registered".into());
        }
        let handle = state
            .pool
            .open_webview()
            .map_err(|error| error.to_string())?;
        state.views.insert(label.to_owned(), handle);
        Ok(())
    }

    pub(crate) fn admit(
        &self,
        label: &str,
        package: VerifiedPackage,
    ) -> Result<SnapshotId, String> {
        let mut state = self.state.lock().map_err(|_| "resource state poisoned")?;
        let handle = state
            .views
            .get(label)
            .ok_or("WebView label is not registered")?
            .clone();
        state
            .pool
            .admit(&handle, package)
            .map_err(|error| error.to_string())
    }

    pub(crate) fn file_url(&self, id: SnapshotId, path: &str) -> Result<String, String> {
        self.route
            .file_url(id, path)
            .map_err(|error| error.to_string())
    }

    pub(crate) fn close_view(&self, label: &str) -> Result<bool, String> {
        let mut state = self.state.lock().map_err(|_| "resource state poisoned")?;
        let Some(handle) = state.views.get(label).cloned() else {
            return Ok(false);
        };
        state
            .pool
            .close_webview(&handle)
            .map_err(|error| error.to_string())?;
        state.views.remove(label);
        Ok(true)
    }

    pub(crate) fn usage(&self) -> Result<SnapshotUsage, String> {
        let state = self.state.lock().map_err(|_| "resource state poisoned")?;
        Ok(state.pool.usage())
    }

    // label must come only from the native UriSchemeContext::webview_label().
    pub(crate) fn respond(&self, label: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let Ok(state) = self.state.lock() else {
            return self.error(StatusCode::INTERNAL_SERVER_ERROR);
        };
        let Some(handle) = state.views.get(label) else {
            return self.error(StatusCode::FORBIDDEN);
        };
        if !reserve(&self.requests, 1, MAX_REQUESTS) || !reserve(&self.active, 1, MAX_CONCURRENT) {
            return self.error(StatusCode::TOO_MANY_REQUESTS);
        }
        let _active = Active(&self.active);
        let response = self.route.respond(&state.pool, handle, request);
        // Charge only delivered bodies, not HEAD's full-file Content-Length.
        // Keep the pool locked until the admitted response bytes have been copied.
        if !reserve(&self.delivered, response.body().len(), MAX_DELIVERED_BYTES) {
            return self.error(StatusCode::TOO_MANY_REQUESTS);
        }
        response.map(|body| body.to_vec())
    }

    fn error(&self, status: StatusCode) -> Response<Vec<u8>> {
        self.route.error(status).map(|body| body.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_integrity::{create_record, verify_package};
    use tauri::http::Method;

    const SCRIPT: &str = "export const value = 1";

    fn limits() -> SnapshotLimits {
        SnapshotLimits {
            max_snapshots: 2,
            max_retained_bytes: 4096,
        }
    }

    fn resources() -> (Resources, SnapshotId) {
        let resources = Resources::new(limits());
        resources.register_view("main").unwrap();
        let id = resources.admit("main", package(SCRIPT)).unwrap();
        (resources, id)
    }

    fn package(script: &str) -> VerifiedPackage {
        let source = tempfile::tempdir().unwrap();
        std::fs::create_dir(source.path().join("fixture")).unwrap();
        for (path, bytes) in [
            ("plugin.js", script),
            ("style.css", "body{}"),
            ("image.svg", "<svg/>"),
            ("font.woff2", "font"),
            ("data.json", "{}"),
            ("unknown.bin", "bytes"),
            ("hello world.txt", "space"),
            ("日本語.txt", "unicode"),
            ("100%.txt", "percent"),
        ] {
            std::fs::write(source.path().join("fixture").join(path), bytes).unwrap();
        }
        let limits = IntegrityLimits::default();
        let record = create_record(source.path(), &limits).unwrap();
        let package = verify_package(source.path(), &record, &limits).unwrap();
        source.close().unwrap();
        package
    }

    fn request(resources: &Resources, id: SnapshotId, path: &str) -> Request<Vec<u8>> {
        uri_request(&resources.file_url(id, path).unwrap())
    }

    fn uri_request(uri: &str) -> Request<Vec<u8>> {
        Request::builder().uri(uri).body(Vec::new()).unwrap()
    }

    fn assert_route_headers(resources: &Resources, result: &Response<Vec<u8>>) {
        let expected = resources.route.error(result.status());
        for (name, value) in expected.headers() {
            if name != "content-length" {
                assert_eq!(result.headers().get(name), Some(value), "{name}");
            }
        }
        assert_eq!(
            result.headers()["access-control-allow-origin"],
            SHELL_ORIGIN
        );
        assert_eq!(result.headers()["x-content-type-options"], "nosniff");
        assert_eq!(result.headers()["cache-control"], "no-store");
    }

    #[test]
    fn different_snapshots_have_distinct_urls_and_retained_bytes() {
        let (resources, primary) = resources();
        let secondary = resources
            .admit("main", package("export const value = 2"))
            .unwrap();
        assert_ne!(primary, secondary);
        let primary_url = resources.file_url(primary, "fixture/plugin.js").unwrap();
        let secondary_url = resources.file_url(secondary, "fixture/plugin.js").unwrap();
        assert_ne!(primary_url, secondary_url);
        assert!(primary_url.starts_with(&format!("{BASE_ORIGIN}/snapshots/")));
        for (url, bytes) in [
            (primary_url, SCRIPT),
            (secondary_url, "export const value = 2"),
        ] {
            let result = resources.respond("main", &uri_request(&url));
            assert_eq!(result.status(), StatusCode::OK);
            assert_eq!(result.body(), bytes.as_bytes());
            assert_route_headers(&resources, &result);
        }
        assert_eq!(resources.usage().unwrap().snapshots, 2);
    }

    #[test]
    fn deduplicated_primary_survives_until_last_associated_view_closes() {
        let resources = Resources::new(SnapshotLimits {
            max_snapshots: 1,
            ..limits()
        });
        resources.register_view("main").unwrap();
        let primary = resources.admit("main", package(SCRIPT)).unwrap();
        let usage = resources.usage().unwrap();
        assert_eq!(usage.snapshots, 1);
        assert_eq!(usage.retained_bytes, package(SCRIPT).byte_length());
        resources.register_view("peer").unwrap();
        assert_eq!(resources.admit("peer", package(SCRIPT)).unwrap(), primary);
        assert_eq!(resources.admit("peer", package(SCRIPT)).unwrap(), primary);
        assert_eq!(resources.usage().unwrap(), usage);
        let request = request(&resources, primary, "fixture/plugin.js");
        assert!(resources.close_view("main").unwrap());
        assert!(!resources.close_view("main").unwrap());
        assert_eq!(resources.usage().unwrap(), usage);
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            resources.respond("peer", &request).body(),
            SCRIPT.as_bytes()
        );
        assert!(resources.close_view("peer").unwrap());
        assert_eq!(
            resources.usage().unwrap(),
            SnapshotUsage {
                snapshots: 0,
                retained_bytes: 0
            }
        );
    }

    #[test]
    fn peer_cannot_read_secondary_snapshot_associated_only_with_main() {
        let (resources, primary) = resources();
        resources.register_view("peer").unwrap();
        resources.admit("peer", package(SCRIPT)).unwrap();
        let secondary = resources.admit("main", package("secondary")).unwrap();
        for method in [Method::GET, Method::HEAD] {
            for (id, status) in [
                (primary, StatusCode::OK),
                (secondary, StatusCode::FORBIDDEN),
            ] {
                let mut request = request(&resources, id, "fixture/plugin.js");
                *request.method_mut() = method.clone();
                let result = resources.respond("peer", &request);
                assert_eq!(result.status(), status);
                assert_route_headers(&resources, &result);
                if status == StatusCode::FORBIDDEN {
                    assert!(result.body().is_empty());
                    assert_eq!(result.headers()["content-length"], "0");
                }
            }
        }
        resources.close_view("main").unwrap();
        assert_eq!(resources.usage().unwrap().snapshots, 1);
        assert_eq!(
            resources
                .respond("peer", &request(&resources, secondary, "fixture/plugin.js"))
                .status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn rejects_invalid_paths_queries_and_origins_without_fallback() {
        let (resources, id) = resources();
        let base = resources.file_url(id, "fixture/plugin.js").unwrap();
        let prefix = base.strip_suffix("fixture/plugin.js").unwrap();
        for path in [
            "../fixture/plugin.js",
            "fixture/./plugin.js",
            "/fixture/plugin.js",
            "fixture%2Fplugin.js",
            "%2e%2e/plugin.js",
            "fixture/plugin.js?x=1",
            "fixture/plugin.js?",
            "C:/private",
            "fixture/CON.js",
            "fixture/%",
            "fixture/%FF",
            "fixture/%5Cplugin.js",
            "fixture/a.",
            "",
        ] {
            let result = resources.respond("main", &uri_request(&format!("{prefix}{path}")));
            assert_eq!(result.status(), StatusCode::BAD_REQUEST, "{path}");
            assert!(result.body().is_empty());
            assert_route_headers(&resources, &result);
        }
        for uri in [
            base.replacen(BASE_ORIGIN, "fixture-resource://evil", 1),
            base.replacen(BASE_ORIGIN, "file://localhost", 1),
            format!("{BASE_ORIGIN}/snapshot-a/fixture/plugin.js"),
            format!("{BASE_ORIGIN}/snapshots/not-a-digest/fixture/plugin.js"),
        ] {
            assert_eq!(
                resources.respond("main", &uri_request(&uri)).status(),
                StatusCode::BAD_REQUEST
            );
        }
        // Decode once: this names a literal "%2e%2e" directory, not traversal.
        let result = resources.respond(
            "main",
            &uri_request(&format!("{prefix}%252e%252e/plugin.js")),
        );
        assert_eq!(result.status(), StatusCode::NOT_FOUND);
        assert!(result.body().is_empty());
        for path in ["missing.js", "index.html"] {
            let result = resources.respond("main", &request(&resources, id, path));
            assert_eq!(result.status(), StatusCode::NOT_FOUND);
            assert!(result.body().is_empty());
        }
        for path in ["../private", "fixture/CON.js", ""] {
            assert!(resources.file_url(id, path).is_err());
        }
    }

    #[test]
    fn serves_canonical_encoded_filenames_and_route_mime_types() {
        let (resources, id) = resources();
        for (path, expected, encoded) in [
            ("hello world.txt", "space", "hello%20world.txt"),
            ("日本語.txt", "unicode", "%E6%97%A5%E6%9C%AC%E8%AA%9E.txt"),
            ("100%.txt", "percent", "100%25.txt"),
        ] {
            let url = resources.file_url(id, &format!("fixture/{path}")).unwrap();
            assert!(url.ends_with(encoded), "{url}");
            let result = resources.respond("main", &uri_request(&url));
            assert_eq!(result.status(), StatusCode::OK);
            assert_eq!(result.body(), expected.as_bytes());
        }
        for (path, expected) in [
            ("plugin.js", "text/javascript"),
            ("style.css", "text/css"),
            ("image.svg", "image/svg+xml"),
            ("font.woff2", "font/woff2"),
            ("data.json", "application/json"),
            ("unknown.bin", "application/octet-stream"),
        ] {
            let result =
                resources.respond("main", &request(&resources, id, &format!("fixture/{path}")));
            assert_eq!(result.status(), StatusCode::OK);
            assert_eq!(result.headers()["content-type"], expected);
        }
    }

    #[test]
    fn head_returns_get_metadata_without_consuming_body_budget() {
        let (resources, id) = resources();
        let mut request = request(&resources, id, "fixture/plugin.js");
        let get = resources.respond("main", &request);
        *request.method_mut() = Method::HEAD;
        resources
            .delivered
            .store(MAX_DELIVERED_BYTES, Ordering::Release);
        let head = resources.respond("main", &request);
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(head.headers(), get.headers());
        assert_eq!(head.headers()["content-length"], SCRIPT.len().to_string());
        assert!(head.body().is_empty());
        assert_eq!(
            resources.delivered.load(Ordering::Acquire),
            MAX_DELIVERED_BYTES
        );
        for method in [Method::POST, Method::OPTIONS, Method::PUT, Method::DELETE] {
            *request.method_mut() = method;
            let result = resources.respond("main", &request);
            assert_eq!(result.status(), StatusCode::METHOD_NOT_ALLOWED);
            assert_eq!(result.headers()["allow"], "GET, HEAD");
            assert!(result.body().is_empty());
            assert_route_headers(&resources, &result);
        }
    }

    #[test]
    fn requester_claims_and_origin_headers_do_not_supply_authority() {
        let (resources, id) = resources();
        resources.register_view("unassociated").unwrap();
        let url = resources.file_url(id, "fixture/plugin.js").unwrap();
        for label in ["denied", "unassociated"] {
            for method in [Method::GET, Method::HEAD] {
                let request = Request::builder()
                    .uri(&url)
                    .method(method)
                    .header("webview-label", "main")
                    .header("x-webview-label", "main")
                    .header("origin", SHELL_ORIGIN)
                    .header("referer", SHELL_ORIGIN)
                    .body(b"{\"webview_label\":\"main\"}".to_vec())
                    .unwrap();
                let result = resources.respond(label, &request);
                assert_eq!(result.status(), StatusCode::FORBIDDEN);
                assert!(result.body().is_empty());
                assert_route_headers(&resources, &result);
            }
        }
        let mut request = uri_request(&url);
        request
            .headers_mut()
            .insert("origin", "https://untrusted.example".parse().unwrap());
        let result = resources.respond("main", &request);
        assert_eq!(result.status(), StatusCode::OK);
        assert_route_headers(&resources, &result);
        let spoofed = uri_request(&format!("{url}?webview_label=main"));
        assert_eq!(
            resources.respond("denied", &spoofed).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            resources.respond("unassociated", &spoofed).status(),
            StatusCode::BAD_REQUEST
        );
    }

    #[test]
    fn failed_admission_and_duplicate_registration_preserve_existing_access() {
        let resources = Resources::new(SnapshotLimits {
            max_snapshots: 1,
            ..limits()
        });
        resources.register_view("main").unwrap();
        let id = resources.admit("main", package(SCRIPT)).unwrap();
        let usage = resources.usage().unwrap();
        assert!(resources.register_view("main").is_err());
        resources.register_view("peer").unwrap();
        assert!(resources.admit("peer", package("different")).is_err());
        assert!(resources.admit("main", package("different")).is_err());
        assert!(resources.admit("unknown", package(SCRIPT)).is_err());
        assert_eq!(resources.usage().unwrap(), usage);
        let request = request(&resources, id, "fixture/plugin.js");
        assert_eq!(
            resources.respond("main", &request).body(),
            SCRIPT.as_bytes()
        );
        assert_eq!(
            resources.respond("peer", &request).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(resources.admit("peer", package(SCRIPT)).unwrap(), id);
        assert_eq!(resources.usage().unwrap(), usage);
    }

    #[test]
    fn zero_count_or_insufficient_byte_limit_fails_atomically() {
        let package_bytes = package(SCRIPT).byte_length();
        for limits in [
            SnapshotLimits {
                max_snapshots: 0,
                max_retained_bytes: 4096,
            },
            SnapshotLimits {
                max_snapshots: 1,
                max_retained_bytes: package_bytes - 1,
            },
        ] {
            let resources = Resources::new(limits);
            resources.register_view("main").unwrap();
            assert!(resources.admit("main", package(SCRIPT)).is_err());
            assert_eq!(
                resources.usage().unwrap(),
                SnapshotUsage {
                    snapshots: 0,
                    retained_bytes: 0
                }
            );
            assert!(resources.close_view("main").unwrap());
            assert!(!resources.close_view("main").unwrap());
        }
        let recovery = Resources::new(limits());
        assert_eq!(
            recovery.usage().unwrap(),
            SnapshotUsage {
                snapshots: 0,
                retained_bytes: 0
            }
        );
        assert_eq!(
            recovery
                .respond(
                    "main",
                    &uri_request(&format!("{BASE_ORIGIN}/snapshot-a/fixture/plugin.js"))
                )
                .status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn reopened_label_needs_fresh_admission() {
        let (resources, id) = resources();
        resources.register_view("peer").unwrap();
        resources.admit("peer", package(SCRIPT)).unwrap();
        let usage = resources.usage().unwrap();
        let request = request(&resources, id, "fixture/plugin.js");
        resources.close_view("main").unwrap();
        resources.register_view("main").unwrap();
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::FORBIDDEN
        );
        assert_eq!(resources.respond("peer", &request).status(), StatusCode::OK);
        assert_eq!(resources.admit("main", package(SCRIPT)).unwrap(), id);
        assert_eq!(resources.respond("main", &request).status(), StatusCode::OK);
        assert_eq!(resources.usage().unwrap(), usage);
        resources.close_view("peer").unwrap();
        resources.close_view("main").unwrap();
        resources.register_view("main").unwrap();
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(resources.admit("main", package(SCRIPT)).unwrap(), id);
        assert_eq!(resources.respond("main", &request).status(), StatusCode::OK);
    }

    #[test]
    fn bounds_requests_concurrency_and_borrowed_response_bytes_before_copy() {
        let (resources, id) = resources();
        let request = request(&resources, id, "fixture/plugin.js");
        let usage = resources.usage().unwrap();
        resources.active.store(MAX_CONCURRENT, Ordering::Release);
        let result = resources.respond("main", &request);
        assert_eq!(result.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_route_headers(&resources, &result);
        assert_eq!(resources.active.load(Ordering::Acquire), MAX_CONCURRENT);
        resources.active.store(0, Ordering::Release);
        resources
            .delivered
            .store(MAX_DELIVERED_BYTES - SCRIPT.len() + 1, Ordering::Release);
        let result = resources.respond("main", &request);
        assert_eq!(result.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(result.body().is_empty());
        assert_eq!(result.headers()["content-length"], "0");
        assert_route_headers(&resources, &result);
        assert_eq!(
            resources.delivered.load(Ordering::Acquire),
            MAX_DELIVERED_BYTES - SCRIPT.len() + 1
        );
        assert_eq!(resources.active.load(Ordering::Acquire), 0);
        resources
            .delivered
            .store(MAX_DELIVERED_BYTES - SCRIPT.len(), Ordering::Release);
        assert_eq!(
            resources.respond("main", &request).body(),
            SCRIPT.as_bytes()
        );
        assert_eq!(
            resources.delivered.load(Ordering::Acquire),
            MAX_DELIVERED_BYTES
        );
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        resources.delivered.store(0, Ordering::Release);
        resources
            .requests
            .store(MAX_REQUESTS - 1, Ordering::Release);
        assert_eq!(resources.respond("main", &request).status(), StatusCode::OK);
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(resources.usage().unwrap(), usage);
    }

    #[test]
    fn poisoned_state_fails_closed_with_route_headers() {
        let (resources, id) = resources();
        std::thread::scope(|scope| {
            assert!(scope
                .spawn(|| {
                    let _state = resources.state.lock().unwrap();
                    panic!("poison resource state");
                })
                .join()
                .is_err());
        });
        let request = request(&resources, id, "fixture/plugin.js");
        for label in ["main", "unknown"] {
            let result = resources.respond(label, &request);
            assert_eq!(result.status(), StatusCode::INTERNAL_SERVER_ERROR);
            assert!(result.body().is_empty());
            assert_route_headers(&resources, &result);
        }
        assert!(resources.register_view("peer").is_err());
        assert!(resources.admit("main", package(SCRIPT)).is_err());
        assert!(resources.close_view("main").is_err());
        assert!(resources.usage().is_err());
    }

    #[test]
    fn atomic_admission_does_not_exceed_limit() {
        let counter = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..32 {
                scope.spawn(|| {
                    for _ in 0..100 {
                        reserve(&counter, 1, MAX_CONCURRENT);
                    }
                });
            }
        });
        assert_eq!(counter.load(Ordering::Acquire), MAX_CONCURRENT);
    }
}
