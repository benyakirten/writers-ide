use crate::{
    policy::Host,
    wire::{self, Reply},
};
use std::sync::{Arc, Mutex};

// Tauri manages this stable allocation for its whole lifetime. Commands retain
// their captured host, never a guard or a reference into replaceable state.
pub(crate) struct HostRouter {
    state: Mutex<Route>,
}
struct Route {
    current: Arc<Host>,
    stopping: bool,
}
impl HostRouter {
    pub(crate) fn new(host: Arc<Host>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(Route {
                current: host,
                stopping: false,
            }),
        })
    }
    pub(crate) fn capture(&self) -> Arc<Host> {
        self.state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .current
            .clone()
    }
    // Only the fixed native replacement campaign calls this. There is no IPC
    // endpoint and no automatic registry lifecycle supervisor or restart loop.
    pub(crate) fn replace(&self, retired: &Arc<Host>, fresh: Arc<Host>) -> Reply<()> {
        if !retired.lock().stopping {
            return Err(wire::error(
                "denied",
                "Retire old admission before replacement",
            ));
        }
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.stopping || !Arc::ptr_eq(&state.current, retired) {
            return Err(wire::error(
                "closed",
                "Router is stopping or the expected host changed",
            ));
        }
        let old = std::mem::replace(&mut state.current, fresh);
        drop(state);
        drop(old);
        Ok(())
    }
    pub(crate) fn stop_admission(&self) {
        let host = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.stopping = true;
            state.current.clone()
        };
        host.stop_admission();
    }
}
