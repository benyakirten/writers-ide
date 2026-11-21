use std::sync::atomic::{AtomicUsize, Ordering};

use tauri::http::{Method, Request, Response, StatusCode};

use crate::{plugin_integrity::VerifiedPackage, portable::portable_path};

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
    // Both URL identities deliberately share this one immutable byte snapshot.
    package: VerifiedPackage,
    requests: AtomicUsize,
    active: AtomicUsize,
    delivered: AtomicUsize,
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
    pub(crate) fn new(package: VerifiedPackage) -> Self {
        Self {
            package,
            requests: AtomicUsize::new(0),
            active: AtomicUsize::new(0),
            delivered: AtomicUsize::new(0),
        }
    }

    pub(crate) fn respond(&self, label: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        if label != "main" {
            return response(StatusCode::FORBIDDEN, "text/plain", Vec::new());
        }
        if !reserve(&self.requests, 1, MAX_REQUESTS) || !reserve(&self.active, 1, MAX_CONCURRENT) {
            return response(StatusCode::TOO_MANY_REQUESTS, "text/plain", Vec::new());
        }
        let _active = Active(&self.active);
        if request.method() != Method::GET {
            let mut result = response(StatusCode::METHOD_NOT_ALLOWED, "text/plain", Vec::new());
            result.headers_mut().insert("allow", "GET".parse().unwrap());
            return result;
        }
        if !request.body().is_empty() {
            return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new());
        }
        let uri = request.uri();
        let native_origin = uri.scheme_str() == Some("fixture-resource")
            && uri.authority().is_some_and(|a| a.as_str() == "localhost");
        // WebView2 rewrites custom schemes to its virtual HTTP host.
        let windows_origin = cfg!(target_os = "windows")
            && uri.scheme_str() == Some("http")
            && uri
                .authority()
                .is_some_and(|a| a.as_str() == "fixture-resource.localhost");
        if (!native_origin && !windows_origin) || uri.query().is_some() {
            return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new());
        }
        let Some((snapshot, path)) = uri.path().strip_prefix('/').and_then(|p| p.split_once('/'))
        else {
            return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new());
        };
        if !matches!(snapshot, "snapshot-a" | "snapshot-b") {
            return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
        }
        if !portable_path(path) {
            return response(StatusCode::BAD_REQUEST, "text/plain", Vec::new());
        }
        let Some(bytes) = self.package.file(path) else {
            return response(StatusCode::NOT_FOUND, "text/plain", Vec::new());
        };
        if !reserve(&self.delivered, bytes.len(), MAX_DELIVERED_BYTES) {
            return response(StatusCode::TOO_MANY_REQUESTS, "text/plain", Vec::new());
        }
        response(StatusCode::OK, mime(path), bytes.to_vec())
    }
}

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or_default() {
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "txt" => "text/plain; charset=utf-8",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn response(status: StatusCode, mime: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("content-type", mime)
        .header("x-content-type-options", "nosniff")
        .header("cache-control", "no-store")
        .header("access-control-allow-origin", SHELL_ORIGIN)
        .header("vary", "Origin")
        .body(bytes)
        .expect("fixed response headers")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_integrity::{create_record, verify_package, IntegrityLimits};

    fn resources() -> Resources {
        let source = tempfile::tempdir().unwrap();
        std::fs::create_dir(source.path().join("fixture")).unwrap();
        for (path, bytes) in [
            ("plugin.js", "export const value = 1"),
            ("style.css", "body{}"),
            ("image.svg", "<svg/>"),
            ("font.woff2", "font"),
            ("data.json", "{}"),
            ("unknown.bin", "bytes"),
        ] {
            std::fs::write(source.path().join("fixture").join(path), bytes).unwrap();
        }
        let limits = IntegrityLimits::default();
        let record = create_record(source.path(), &limits).unwrap();
        let package = verify_package(source.path(), &record, &limits).unwrap();
        source.close().unwrap();
        Resources::new(package)
    }

    fn request(path: &str) -> Request<Vec<u8>> {
        Request::builder()
            .uri(format!("fixture-resource://localhost/{path}"))
            .body(Vec::new())
            .unwrap()
    }

    #[test]
    fn snapshots_share_retained_bytes_after_source_deletion() {
        let resources = resources();
        let a = resources.respond("main", &request("snapshot-a/fixture/plugin.js"));
        let b = resources.respond("main", &request("snapshot-b/fixture/plugin.js"));
        assert_eq!(a.status(), StatusCode::OK);
        assert_eq!(a.body(), b.body());
        assert_eq!(a.body(), b"export const value = 1");
        assert_eq!(a.headers()["cache-control"], "no-store");
        assert_eq!(a.headers()["x-content-type-options"], "nosniff");
    }

    #[test]
    fn rejects_aliases_missing_paths_and_unsupported_methods_without_fallback() {
        let resources = resources();
        for (path, status) in [
            ("snapshot-c/fixture/plugin.js", StatusCode::NOT_FOUND),
            ("snapshot-a/missing.js", StatusCode::NOT_FOUND),
            ("snapshot-a/index.html", StatusCode::NOT_FOUND),
            ("snapshot-a/../fixture/plugin.js", StatusCode::BAD_REQUEST),
            ("snapshot-a/fixture/./plugin.js", StatusCode::BAD_REQUEST),
            ("snapshot-a//fixture/plugin.js", StatusCode::BAD_REQUEST),
            ("snapshot-a/fixture%2fplugin.js", StatusCode::BAD_REQUEST),
            ("snapshot-a/%2e%2e/plugin.js", StatusCode::BAD_REQUEST),
            ("snapshot-a/%252e%252e/plugin.js", StatusCode::BAD_REQUEST),
            ("snapshot-a/fixture/plugin.js?x=1", StatusCode::BAD_REQUEST),
            ("snapshot-a/C:/private", StatusCode::BAD_REQUEST),
            ("snapshot-a/fixture/CON.js", StatusCode::BAD_REQUEST),
            ("snapshot-a/", StatusCode::BAD_REQUEST),
        ] {
            let result = resources.respond("main", &request(path));
            assert_eq!(result.status(), status, "{path}");
            assert!(result.body().is_empty(), "no HTML or filesystem fallback");
        }
        for method in [
            Method::HEAD,
            Method::POST,
            Method::OPTIONS,
            Method::PUT,
            Method::DELETE,
        ] {
            let mut request = request("snapshot-a/fixture/plugin.js");
            *request.method_mut() = method;
            assert_eq!(
                resources.respond("main", &request).status(),
                StatusCode::METHOD_NOT_ALLOWED
            );
        }
        assert_eq!(
            resources
                .respond("other", &request("snapshot-a/fixture/plugin.js"))
                .status(),
            StatusCode::FORBIDDEN
        );
        for uri in [
            "fixture-resource://evil/snapshot-a/fixture/plugin.js",
            "file://localhost/snapshot-a/fixture/plugin.js",
            "fixture-resource://localhost:80/snapshot-a/fixture/plugin.js",
        ] {
            let request = Request::builder().uri(uri).body(Vec::new()).unwrap();
            assert_eq!(
                resources.respond("main", &request).status(),
                StatusCode::BAD_REQUEST
            );
        }
        assert!(Request::builder()
            .uri("file:///snapshot-a/fixture/plugin.js")
            .body(Vec::<u8>::new())
            .is_err());
        for path in [
            "fixture\\plugin.js",
            "fixture/%",
            "fixture/a.",
            "fixture/a ",
            "fixture/#x",
        ] {
            assert!(!portable_path(path));
        }
    }

    #[test]
    fn serves_explicit_mime_types() {
        let resources = resources();
        for (path, expected) in [
            ("plugin.js", "text/javascript; charset=utf-8"),
            ("style.css", "text/css; charset=utf-8"),
            ("image.svg", "image/svg+xml"),
            ("font.woff2", "font/woff2"),
            ("data.json", "application/json"),
            ("unknown.bin", "application/octet-stream"),
        ] {
            let result = resources.respond("main", &request(&format!("snapshot-a/fixture/{path}")));
            assert_eq!(result.status(), StatusCode::OK);
            assert_eq!(result.headers()["content-type"], expected);
        }
    }

    #[test]
    fn bounds_requests_concurrency_and_cumulative_response_bytes() {
        let resources = resources();
        let request = request("snapshot-a/fixture/plugin.js");
        resources.active.store(MAX_CONCURRENT, Ordering::Release);
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(resources.active.load(Ordering::Acquire), MAX_CONCURRENT);
        resources.active.store(0, Ordering::Release);
        resources
            .delivered
            .store(MAX_DELIVERED_BYTES, Ordering::Release);
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(resources.active.load(Ordering::Acquire), 0);
        resources.delivered.store(0, Ordering::Release);
        resources
            .requests
            .store(MAX_REQUESTS - 1, Ordering::Release);
        assert_eq!(resources.respond("main", &request).status(), StatusCode::OK);
        assert_eq!(
            resources.respond("main", &request).status(),
            StatusCode::TOO_MANY_REQUESTS
        );
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
