//! Dedicated native authority; no HostRouter roles or package associations.
use crate::{
    shutdown::ShutdownController,
    wire::{self, Reply},
};
use std::sync::{Arc, Mutex};
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const LABEL: &str = "shutdown";
pub const ENTRY: &str = "shutdown.html";
struct Document {
    session: String,
    navigated: bool,
    revoked: bool,
    window: Option<WebviewWindow>,
    destroy_pending: bool,
}
pub struct ShutdownWindowAuthority {
    controller: Arc<ShutdownController>,
    document: Mutex<Option<Document>>,
}
impl ShutdownWindowAuthority {
    pub fn new(controller: Arc<ShutdownController>) -> Arc<Self> {
        Arc::new(Self {
            controller,
            document: Mutex::new(None),
        })
    }
    pub(crate) fn controller(&self) -> &ShutdownController {
        &self.controller
    }
    /// Call on the native cleanup-status scheduler. No timer or cleanup worker
    /// is owned here. A completed attempt only closes its status window.
    pub fn show_if_due(self: &Arc<Self>, app: &tauri::AppHandle) -> Result<bool, String> {
        if self.controller.snapshot().phase == crate::shutdown::Phase::Complete {
            self.close_if_complete(app)?;
            return Ok(false);
        }
        if !self.controller.due_at(std::time::Instant::now()) {
            return Ok(false);
        }
        let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = document.as_ref() {
            let session = existing.session.clone();
            drop(document);
            self.destroy_revoked(app, &session)?;
            return Ok(false);
        }
        // Controller registration cannot call foreign code. All WebView calls
        // and revocation (which can release a channel) happen outside this lock.
        let session = self
            .controller
            .register_document()
            .map_err(|e| e.to_string())?;
        *document = Some(Document {
            session: session.clone(),
            navigated: false,
            revoked: false,
            window: None,
            destroy_pending: false,
        });
        drop(document);
        let nav = self.clone();
        let nav_session = session.clone();
        let nav_app = app.clone();
        let events = self.clone();
        let event_session = session.clone();
        let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(ENTRY.into()))
            .title("Application integration: waiting for cleanup")
            .visible(false)
            .on_navigation(move |url| {
                let allowed = nav.navigation(&nav_session, url);
                if !allowed {
                    let _ = nav.destroy_revoked(&nav_app, &nav_session);
                }
                allowed
            })
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .build();
        let window = match window {
            Ok(window) => window,
            Err(error) => {
                self.retire(&session);
                return Err(error.to_string());
            }
        };
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if events.controller.unfinished() {
                    api.prevent_close();
                }
            }
            WindowEvent::Destroyed => events.retire(&event_session),
            _ => {}
        });
        {
            let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(d) = document.as_mut().filter(|d| d.session == session) {
                d.window = Some(window.clone());
            }
        }
        // Navigation can be rejected while the builder is still creating the
        // window. Now its exact native handle is available for destruction.
        self.destroy_revoked(app, &session)?;
        if self
            .document
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .is_none_or(|d| d.session != session || d.revoked)
        {
            return Ok(false);
        }
        // Install the native close veto before making the window visible.
        // Completion can win while creation/show dispatches to the UI thread.
        if self.controller.snapshot().phase == crate::shutdown::Phase::Complete {
            self.close_if_complete(app)?;
            return Ok(false);
        }
        if let Err(error) = window.show() {
            self.revoke(&session);
            self.destroy_revoked(app, &session)?;
            return Err(error.to_string());
        }
        self.close_if_complete(app)?;
        Ok(true)
    }
    pub fn close_if_complete(self: &Arc<Self>, app: &tauri::AppHandle) -> Result<(), String> {
        if self.controller.snapshot().phase != crate::shutdown::Phase::Complete {
            return Ok(());
        }
        let session = self
            .document
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|d| d.session.clone());
        if let Some(session) = session {
            self.revoke(&session);
            self.destroy_revoked(app, &session)?;
        }
        Ok(())
    }
    pub(crate) fn caller(&self, window: &WebviewWindow) -> Reply<String> {
        // url() can synchronously dispatch to the UI thread. Do not hold either
        // authority or controller state while querying it.
        let url = window
            .url()
            .map_err(|_| wire::error("denied", "Shutdown URL unavailable"))?;
        self.validate_caller(window.label(), &url)
    }
    pub(crate) fn validate_caller(&self, label: &str, url: &tauri::Url) -> Reply<String> {
        if label != LABEL || !fixed_url(url) {
            return Err(wire::error("denied", "Actual shutdown WebView required"));
        }
        self.document
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|d| d.navigated && !d.revoked)
            .map(|d| d.session.clone())
            .ok_or_else(|| wire::error("denied", "Shutdown document revoked"))
    }
    fn navigation(&self, session: &str, url: &tauri::Url) -> bool {
        let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
        let allowed = if let Some(d) = document.as_mut().filter(|d| d.session == session) {
            if !d.revoked && !d.navigated && fixed_url(url) {
                d.navigated = true;
                true
            } else {
                false
            }
        } else {
            false
        };
        drop(document);
        if !allowed {
            self.revoke(session);
        }
        allowed
    }
    fn revoke(&self, session: &str) {
        let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(d) = document.as_mut().filter(|d| d.session == session) {
            d.revoked = true;
        }
        drop(document);
        self.controller.revoke_document(session);
    }
    fn retire(&self, session: &str) {
        let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
        let retired = if document.as_ref().is_some_and(|d| d.session == session) {
            document.take()
        } else {
            None
        };
        drop(document);
        self.controller.revoke_document(session);
        drop(retired);
    }
    fn destroy_revoked(
        self: &Arc<Self>,
        app: &tauri::AppHandle,
        session: &str,
    ) -> Result<(), String> {
        let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
        let Some(d) = document.as_mut().filter(|d| {
            d.session == session && d.revoked && !d.destroy_pending && d.window.is_some()
        }) else {
            return Ok(());
        };
        d.destroy_pending = true;
        drop(document);
        let authority = self.clone();
        let session = session.to_owned();
        let queued_session = session.clone();
        let result = app.run_on_main_thread(move || {
            let window = authority.revoked_window(&queued_session);
            if let Some(window) = window {
                // destroy(), not close(): the unfinished-cleanup close veto must
                // not keep a revoked document occupying the fixed native label.
                if window.destroy().is_err() {
                    authority.retry_destroy(&queued_session);
                }
            }
        });
        if let Err(error) = result {
            self.retry_destroy(&session);
            return Err(error.to_string());
        }
        Ok(())
    }
    fn revoked_window(&self, session: &str) -> Option<WebviewWindow> {
        self.document
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .filter(|d| d.session == session && d.revoked)
            .and_then(|d| d.window.clone())
    }
    fn retry_destroy(&self, session: &str) {
        let mut document = self.document.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(d) = document
            .as_mut()
            .filter(|d| d.session == session && d.revoked)
        {
            d.destroy_pending = false;
        }
    }
}
pub(crate) fn fixed_url(url: &tauri::Url) -> bool {
    ((url.scheme() == "tauri" && url.host_str() == Some("localhost"))
        || (matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost")))
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.path() == "/shutdown.html"
        && url.query().is_none()
        && url.fragment().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn actual_caller_navigation_and_recreation() {
        let controller = Arc::new(ShutdownController::new());
        controller.begin();
        let authority = ShutdownWindowAuthority::new(controller.clone());
        let url = "tauri://localhost/shutdown.html".parse().unwrap();
        let old = controller.register_document().unwrap();
        *authority.document.lock().unwrap() = Some(Document {
            session: old.clone(),
            navigated: false,
            revoked: false,
            window: None,
            destroy_pending: false,
        });
        assert!(authority.validate_caller(LABEL, &url).is_err());
        assert!(authority.navigation(&old, &url));
        assert_eq!(authority.validate_caller(LABEL, &url).unwrap(), old);
        for label in ["manager", "workspace-a", "probe", "replacement-keepalive"] {
            assert!(authority.validate_caller(label, &url).is_err());
        }
        for raw in [
            "https://evil.test/shutdown.html",
            "tauri://localhost/manager.html",
            "tauri://localhost/shutdown.html?x=1",
            "tauri://localhost/shutdown.html#x",
            "http://tauri.localhost:123/shutdown.html",
            "http://user@tauri.localhost/shutdown.html",
        ] {
            assert!(authority
                .validate_caller(LABEL, &raw.parse().unwrap())
                .is_err());
        }
        assert!(!authority.navigation(&old, &url));
        assert!(authority.validate_caller(LABEL, &url).is_err());
        // Keep the revoked lifetime reserved until its native window is gone.
        assert!(authority.document.lock().unwrap().as_ref().unwrap().revoked);
        assert!(!authority.navigation(&old, &url));
        authority.retire(&old);
        assert!(authority.document.lock().unwrap().is_none());
        let fresh = controller.register_document().unwrap();
        assert_ne!(old, fresh);
        *authority.document.lock().unwrap() = Some(Document {
            session: fresh.clone(),
            navigated: false,
            revoked: false,
            window: None,
            destroy_pending: false,
        });
        assert!(authority.navigation(&fresh, &url));
        // Delayed callbacks from the old native window cannot target its replacement.
        authority
            .document
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .destroy_pending = true;
        assert!(!authority.navigation(&old, &url));
        authority.revoke(&old);
        authority.retire(&old);
        authority.retry_destroy(&old);
        assert!(authority.revoked_window(&old).is_none());
        assert!(
            authority
                .document
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .destroy_pending
        );
        assert_eq!(authority.validate_caller(LABEL, &url).unwrap(), fresh);
    }
}
