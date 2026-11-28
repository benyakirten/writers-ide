use crate::{
    shutdown::{
        ConfirmRequest, ConnectReply, ConnectRequest, ForceEvidence, PrepareReply, SessionRequest,
        Snapshot,
    },
    shutdown_window::ShutdownWindowAuthority,
    wire::{self, Reply},
};
use std::sync::Arc;
use tauri::{ipc::Channel, Manager, State, WebviewWindow};

/// Required native composition hook. Record failed/incomplete campaign evidence
/// synchronously here. The handler calls it without state locks, before exit(2).
/// It must not report a passing run or assert that an uncertain write rolled back.
pub struct ShutdownForceReporter(Arc<dyn Fn(&ForceEvidence) + Send + Sync>);
impl ShutdownForceReporter {
    pub fn new(report: impl Fn(&ForceEvidence) + Send + Sync + 'static) -> Self {
        Self(Arc::new(report))
    }
    pub(crate) fn record(&self, evidence: &ForceEvidence) {
        (self.0)(evidence);
    }
}

#[tauri::command]
pub fn shutdown_connect(
    window: WebviewWindow,
    authority: State<'_, Arc<ShutdownWindowAuthority>>,
    payload: String,
    events: Channel<Snapshot>,
) -> Reply<ConnectReply> {
    let request: ConnectRequest = wire::parse(&payload)?;
    let caller = authority.caller(&window)?;
    authority.controller().connect(
        &caller,
        request,
        Arc::new(move |snapshot| events.send(snapshot).is_ok()),
    )
}
#[tauri::command]
pub fn shutdown_prepare_force_quit(
    window: WebviewWindow,
    authority: State<'_, Arc<ShutdownWindowAuthority>>,
    payload: String,
) -> Reply<PrepareReply> {
    let request: SessionRequest = wire::parse(&payload)?;
    let caller = authority.caller(&window)?;
    authority.controller().prepare(&caller, &request)
}
#[tauri::command]
pub fn shutdown_cancel_force_quit(
    window: WebviewWindow,
    authority: State<'_, Arc<ShutdownWindowAuthority>>,
    payload: String,
) -> Reply<bool> {
    let request: SessionRequest = wire::parse(&payload)?;
    let caller = authority.caller(&window)?;
    authority.controller().cancel(&caller, &request)
}
#[tauri::command]
pub fn shutdown_confirm_force_quit(
    window: WebviewWindow,
    authority: State<'_, Arc<ShutdownWindowAuthority>>,
    reporter: State<'_, ShutdownForceReporter>,
    payload: String,
) -> Reply<bool> {
    let request: ConfirmRequest = wire::parse(&payload)?;
    let caller = authority.caller(&window)?;
    let evidence = authority.controller().confirm(&caller, &request)?;
    reporter.record(&evidence);
    window.app_handle().exit(2);
    Ok(true)
}
