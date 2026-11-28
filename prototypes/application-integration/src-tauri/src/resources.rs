use crate::{
    plugin_integrity::{verify_package, IntegrityEntry, IntegrityLimits, IntegrityRecord},
    plugin_resources::{route::ResourceRoute, SnapshotLimits, SnapshotPool, WebViewHandle},
};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::http::{Request, Response, StatusCode};
const INERT: &[u8] = b"Writer's IDE inert application integration fixture. No executable code.\n";
#[cfg(target_os = "windows")]
const ORIGIN: &str = "http://fixture-resource.localhost";
#[cfg(not(target_os = "windows"))]
const ORIGIN: &str = "fixture-resource://localhost";
#[cfg(target_os = "windows")]
const SHELL: &str = "http://tauri.localhost";
#[cfg(not(target_os = "windows"))]
const SHELL: &str = "tauri://localhost";
pub struct Resources {
    state: Mutex<ResourceState>,
    route: ResourceRoute,
    pub url: String,
}
struct ResourceState {
    pool: SnapshotPool,
    views: BTreeMap<String, WebViewHandle>,
    requests: usize,
    pub observations: BTreeMap<String, u16>,
}
impl Resources {
    pub fn new(parent: &std::path::Path) -> Result<Self, String> {
        let source = parent.join("inert-source");
        std::fs::create_dir(&source).map_err(|e| e.to_string())?;
        std::fs::write(source.join("inert.txt"), INERT).map_err(|e| e.to_string())?;
        let limits = IntegrityLimits {
            max_files: 1,
            max_file_bytes: 1024,
            max_total_bytes: 1024,
            max_path_bytes: 64,
            max_depth: 1,
        };
        // Trusted metadata is derived only from compiled fixture bytes, never the candidate on disk.
        let record = IntegrityRecord::from_entries(
            1,
            [Ok::<_, String>(IntegrityEntry {
                path: "inert.txt".into(),
                byte_length: INERT.len() as u64,
                sha256: Sha256::digest(INERT).into(),
            })],
            &limits,
        )
        .map_err(|e| e.to_string())?;
        let mut pool = SnapshotPool::new(SnapshotLimits {
            max_snapshots: 1,
            max_retained_bytes: 1024,
        });
        let mut views = BTreeMap::new();
        let mut id = None;
        for label in ["workspace-a", "workspace-b"] {
            let view = pool.open_webview().map_err(|e| e.to_string())?;
            if label.starts_with("workspace-") {
                id = Some(
                    pool.admit(
                        &view,
                        verify_package(&source, &record, &limits).map_err(|e| e.to_string())?,
                    )
                    .map_err(|e| e.to_string())?,
                );
            }
            views.insert(label.into(), view);
        }
        let route = ResourceRoute::new(ORIGIN, SHELL, limits).map_err(|e| e.to_string())?;
        let url = route
            .file_url(id.ok_or("missing inert snapshot")?, "inert.txt")
            .map_err(|e| e.to_string())?;
        Ok(Self {
            state: Mutex::new(ResourceState {
                pool,
                views,
                requests: 0,
                observations: BTreeMap::new(),
            }),
            route,
            url,
        })
    }
    pub fn respond(&self, label: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        s.requests += 1;
        if s.requests > 128 {
            return self
                .route
                .error(StatusCode::TOO_MANY_REQUESTS)
                .map(|b| b.to_vec());
        }
        let response = match s.views.get(label) {
            Some(view) => self.route.respond(&s.pool, view, request),
            None => self.route.error(StatusCode::FORBIDDEN),
        }
        .map(|b| b.to_vec());
        s.observations
            .insert(label.into(), response.status().as_u16());
        response
    }
    pub fn close(&self, label: &str) {
        let mut s = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(view) = s.views.remove(label) {
            let _ = s.pool.close_webview(&view);
        }
    }
    pub fn close_all(&self) -> bool {
        for label in ["manager", "workspace-a", "workspace-b", "probe"] {
            self.close(label);
        }
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pool
            .usage()
            .snapshots
            == 0
    }
    pub fn clear_observations(&self) {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .observations
            .clear();
    }
    pub fn observations(&self) -> BTreeMap<String, u16> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .observations
            .clone()
    }
    pub fn native_policy_check(&self) -> bool {
        [("workspace-a", 200), ("manager", 403), ("probe", 403)]
            .into_iter()
            .all(|(label, expected)| {
                let request = Request::builder()
                    .uri(&self.url)
                    .body(Vec::new())
                    .expect("fixed URL");
                self.respond(label, &request).status().as_u16() == expected
            })
    }
}

pub fn denial_policy(
    request: Request<Vec<u8>>,
    response: &mut Response<std::borrow::Cow<'static, [u8]>>,
) {
    if !["/manager.html", "/workspace.html", "/probe.html"].contains(&request.uri().path()) {
        return;
    }
    const CONNECT:&str="connect-src fixture-resource: http://fixture-resource.localhost https://fixture-resource.localhost ";
    // This separate native test policy changes connectivity only. Inert resources
    // remain forbidden as scripts, workers, frames and other executable content.
    let body = String::from_utf8_lossy(response.body());
    let bytes = body.replace("connect-src ", CONNECT).into_bytes();
    *response.body_mut() = std::borrow::Cow::Owned(bytes);
    if let Some(csp) = response
        .headers()
        .get("content-security-policy")
        .and_then(|v| v.to_str().ok())
    {
        let csp = csp.replace("connect-src ", CONNECT);
        response.headers_mut().insert(
            "content-security-policy",
            tauri::http::HeaderValue::from_str(&csp).expect("fixed CSP transformation"),
        );
    }
    response.headers_mut().remove("content-length");
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn denial_policy_only_adds_connectivity_for_fixed_html() {
        let policy = "script-src 'self'; connect-src ipc: http://ipc.localhost; worker-src 'none'";
        let mut response = Response::builder()
            .header("content-security-policy", policy)
            .body(std::borrow::Cow::Owned(policy.as_bytes().to_vec()))
            .unwrap();
        denial_policy(
            Request::builder()
                .uri("tauri://localhost/manager.html")
                .body(vec![])
                .unwrap(),
            &mut response,
        );
        let csp = response.headers()["content-security-policy"]
            .to_str()
            .unwrap();
        assert!(csp.starts_with("script-src 'self'; connect-src fixture-resource:"));
        assert!(csp.ends_with("worker-src 'none'"));
        let before = response.body().clone();
        denial_policy(
            Request::builder()
                .uri("tauri://localhost/assets/manager.js")
                .body(vec![])
                .unwrap(),
            &mut response,
        );
        assert_eq!(response.body(), &before);
    }
}
