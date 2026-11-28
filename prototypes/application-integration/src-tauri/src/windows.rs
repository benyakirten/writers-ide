use crate::{
    commands,
    policy::{Host, Role},
    resources::Resources,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
fn count(counter: &AtomicUsize) {
    let mut previous = counter.load(Ordering::Acquire);
    loop {
        match counter.compare_exchange_weak(
            previous,
            previous.saturating_add(1),
            Ordering::AcqRel,
            Ordering::Acquire,
        ) {
            Ok(_) => break,
            Err(actual) => previous = actual,
        }
    }
}
use tauri::{WebviewUrl, WebviewWindowBuilder, WindowEvent};

pub fn create(
    app: &tauri::AppHandle,
    host: &Arc<Host>,
    resources: &Arc<Resources>,
    label: &'static str,
    role: Role,
    denial_policy: bool,
) -> Result<String, String> {
    let lifetime = host
        .register(label, role)
        .map_err(|error| error.to_string())?;
    let nav_lifetime = lifetime.clone();
    let event_lifetime = lifetime.clone();
    let nav_host = host.clone();
    let popup_host = host.clone();
    let event_host = host.clone();
    let nav_resources = resources.clone();
    let event_resources = resources.clone();
    let built = WebviewWindowBuilder::new(app, label, WebviewUrl::App(role.shell().into()))
        .title(format!("Application integration: {label}"))
        .on_web_resource_request(move |request, response| {
            if denial_policy {
                crate::resources::denial_policy(request, response);
            }
        })
        .on_navigation(move |url| {
            let initial = nav_host
                .lock()
                .windows
                .get(label)
                .is_some_and(|w| w.session == nav_lifetime && !w.handshaken);
            if !initial || !commands::fixed_url(url, role.shell()) {
                count(&nav_host.navigation_denials);
                let revoked = nav_host.revoke_lifetime(label, &nav_lifetime);
                if revoked {
                    nav_resources.close(label);
                }
                return false;
            }
            true
        })
        .on_new_window(move |_, _| {
            count(&popup_host.popup_denials);
            tauri::webview::NewWindowResponse::Deny
        })
        .build();
    let window = match built {
        Ok(window) => window,
        Err(error) => {
            host.revoke_lifetime(label, &lifetime);
            return Err(error.to_string());
        }
    };
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let revoked = event_host.revoke_lifetime(label, &event_lifetime);
            if revoked {
                event_resources.close(label);
            }
        }
    });
    Ok(lifetime)
}
