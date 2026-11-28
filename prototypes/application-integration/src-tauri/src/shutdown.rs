//! Fixture-only cleanup observation. This controller owns no registry or runtime.
use crate::{
    transport::isolate,
    wire::{self, Reply},
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex, MutexGuard},
    time::{Duration, Instant},
};

pub const DISPLAY_DELAY: Duration = Duration::from_secs(2);
pub const CONFIRMATION_LIFETIME: Duration = Duration::from_secs(30);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Draining,
    Failed,
    Complete,
    Forced,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: u8,
    pub attempt: String,
    pub phase: Phase,
    pub stage: String,
    pub message: String,
    pub failure: Option<String>,
    pub force_eligible: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConnectRequest {
    pub version: u8,
}
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SessionRequest {
    pub version: u8,
    pub session: String,
    pub attempt: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfirmRequest {
    pub version: u8,
    pub session: String,
    pub attempt: String,
    pub confirmation: String,
}
#[derive(Serialize)]
pub struct ConnectReply {
    pub version: u8,
    pub session: String,
    pub attempt: String,
    pub snapshot: Snapshot,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareReply {
    pub version: u8,
    pub confirmation: String,
    pub expires_in_ms: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForceEvidence {
    pub version: u8,
    pub ok: bool,
    pub cleanup_complete: bool,
    pub session: String,
    pub attempt: String,
    pub snapshot: Snapshot,
}

pub(crate) type Sink = Arc<dyn Fn(Snapshot) -> bool + Send + Sync>;
#[derive(Clone)]
struct IsolatedSink(Option<Sink>);
impl IsolatedSink {
    fn send(&self, snapshot: Snapshot) -> bool {
        isolate(|| self.0.as_ref().expect("active shutdown sink")(snapshot)) == Some(true)
    }
}
impl Drop for IsolatedSink {
    fn drop(&mut self) {
        let sink = self.0.take();
        let _ = isolate(|| drop(sink));
    }
}
struct Document {
    session: String,
    connected: bool,
    sink: Option<IsolatedSink>,
}
struct Confirmation {
    token: String,
    expires: Instant,
}
struct Inner {
    started: Option<Instant>,
    snapshot: Snapshot,
    document: Option<Document>,
    confirmation: Option<Confirmation>,
    dirty: bool,
    delivering: bool,
}
pub struct ShutdownController {
    inner: Mutex<Inner>,
}

pub(crate) fn random_id() -> String {
    let mut bytes = [0; 32];
    getrandom::fill(&mut bytes).expect("fixture shutdown requires native randomness");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn diagnostic(text: &str) -> String {
    // Bound the encoded field, not just UTF-8: control characters expand in JSON.
    let mut encoded = 2;
    text.chars()
        .take_while(|ch| {
            let cost = match ch {
                '"' | '\\' => 2,
                ch if ch.is_control() && (*ch as u32) < 32 => 6,
                ch => ch.len_utf8(),
            };
            encoded += cost;
            encoded <= 1024
        })
        .collect()
}
impl Default for ShutdownController {
    fn default() -> Self {
        Self::new()
    }
}
impl ShutdownController {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                started: None,
                snapshot: Snapshot {
                    version: 1,
                    attempt: random_id(),
                    phase: Phase::Draining,
                    stage: "admission".into(),
                    message: "Waiting for cleanup to begin".into(),
                    failure: None,
                    force_eligible: false,
                },
                document: None,
                confirmation: None,
                dirty: false,
                delivering: false,
            }),
        }
    }
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
    /// Starts the one sticky attempt. Repeated calls do not restart its deadline.
    pub fn begin(&self) {
        self.begin_at(Instant::now());
    }
    pub(crate) fn begin_at(&self, now: Instant) {
        let mut state = self.lock();
        if state.started.is_none() {
            state.started = Some(now);
            state.snapshot.message = "Cleanup is draining".into();
            state.dirty = true;
        }
        drop(state);
        self.deliver();
    }
    pub fn progress(&self, stage: &str, message: &str) {
        let mut state = self.lock();
        if state.unfinished() {
            state.snapshot.stage = diagnostic(stage);
            state.snapshot.message = diagnostic(message);
            state.dirty = true;
        }
        drop(state);
        self.deliver();
    }
    pub fn fail(&self, message: &str) {
        let mut state = self.lock();
        if state.unfinished() {
            state.snapshot.phase = Phase::Failed;
            state
                .snapshot
                .failure
                .get_or_insert_with(|| diagnostic(message));
            state.snapshot.message = diagnostic(message);
            state.dirty = true;
        }
        drop(state);
        self.deliver();
    }
    /// Call only after all cleanup and ownership release have actually completed.
    /// Returns false if confirmed force termination won the shared state lock.
    pub fn complete(&self) -> bool {
        let mut state = self.lock();
        if state.snapshot.phase == Phase::Forced {
            return false;
        }
        if state.started.is_none() {
            return false;
        }
        state.snapshot.phase = Phase::Complete;
        state.snapshot.message = "Cleanup completed".into();
        state.confirmation = None;
        state.dirty = true;
        drop(state);
        self.deliver();
        true
    }
    pub fn is_forced(&self) -> bool {
        self.lock().snapshot.phase == Phase::Forced
    }
    pub fn snapshot(&self) -> Snapshot {
        self.lock().snapshot_at(Instant::now())
    }
    pub(crate) fn due_at(&self, now: Instant) -> bool {
        self.lock().eligible(now)
    }
    pub(crate) fn unfinished(&self) -> bool {
        self.lock().unfinished()
    }
    pub(crate) fn register_document(&self) -> Reply<String> {
        let mut state = self.lock();
        if !state.unfinished() || state.document.is_some() {
            return Err(wire::error("closed", "Shutdown document unavailable"));
        }
        let session = random_id();
        state.document = Some(Document {
            session: session.clone(),
            connected: false,
            sink: None,
        });
        Ok(session)
    }
    pub(crate) fn revoke_document(&self, session: &str) {
        let mut state = self.lock();
        let retired = if state
            .document
            .as_ref()
            .is_some_and(|d| d.session == session)
        {
            state.confirmation = None;
            state.document.take()
        } else {
            None
        };
        drop(state);
        // A channel's destructor can call native code. Never run it under state locks.
        drop(retired);
    }
    pub(crate) fn connect(
        &self,
        caller: &str,
        request: ConnectRequest,
        sink: Sink,
    ) -> Reply<ConnectReply> {
        // Wrap before acquiring state so rejected connections also dispose their
        // callback outside the lock and cannot unwind through native callers.
        let sink = IsolatedSink(Some(sink));
        let mut state = self.lock();
        if request.version != 1 || !state.unfinished() {
            return Err(wire::error("denied", "Shutdown connect denied"));
        }
        let document = state
            .document
            .as_mut()
            .filter(|d| d.session == caller)
            .ok_or_else(|| wire::error("denied", "Shutdown lifetime denied"))?;
        if document.connected {
            return Err(wire::error(
                "busy",
                "One progress channel per document lifetime",
            ));
        }
        document.connected = true;
        document.sink = Some(sink);
        Ok(ConnectReply {
            version: 1,
            session: caller.into(),
            attempt: state.snapshot.attempt.clone(),
            snapshot: state.snapshot_at(Instant::now()),
        })
    }
    pub(crate) fn prepare(&self, caller: &str, r: &SessionRequest) -> Reply<PrepareReply> {
        self.prepare_with_clock(caller, r, Instant::now)
    }
    #[cfg(test)]
    fn prepare_at(&self, caller: &str, r: &SessionRequest, now: Instant) -> Reply<PrepareReply> {
        self.prepare_with_clock(caller, r, || now)
    }
    fn prepare_with_clock(
        &self,
        caller: &str,
        r: &SessionRequest,
        clock: impl FnOnce() -> Instant,
    ) -> Reply<PrepareReply> {
        let mut state = self.lock();
        let now = clock();
        state.authorize(caller, r.version, &r.session, &r.attempt)?;
        if !state.eligible(now) {
            return Err(wire::error(
                "closed",
                "Cleanup is not eligible for force termination",
            ));
        }
        let token = random_id();
        state.confirmation = Some(Confirmation {
            token: token.clone(),
            expires: now + CONFIRMATION_LIFETIME,
        });
        Ok(PrepareReply {
            version: 1,
            confirmation: token,
            expires_in_ms: 30_000,
        })
    }
    pub(crate) fn cancel(&self, caller: &str, r: &SessionRequest) -> Reply<bool> {
        let mut state = self.lock();
        state.authorize(caller, r.version, &r.session, &r.attempt)?;
        state.confirmation = None;
        Ok(true)
    }
    pub(crate) fn confirm(&self, caller: &str, r: &ConfirmRequest) -> Reply<ForceEvidence> {
        self.confirm_with_clock(caller, r, Instant::now)
    }
    #[cfg(test)]
    fn confirm_at(&self, caller: &str, r: &ConfirmRequest, now: Instant) -> Reply<ForceEvidence> {
        self.confirm_with_clock(caller, r, || now)
    }
    fn confirm_with_clock(
        &self,
        caller: &str,
        r: &ConfirmRequest,
        clock: impl FnOnce() -> Instant,
    ) -> Reply<ForceEvidence> {
        let mut state = self.lock();
        // Expiry is checked at the transition, not before waiting for its lock.
        let now = clock();
        state.authorize(caller, r.version, &r.session, &r.attempt)?;
        if !state.eligible(now)
            || !state
                .confirmation
                .as_ref()
                .is_some_and(|c| c.token == r.confirmation && now < c.expires)
        {
            return Err(wire::error(
                "denied",
                "Force confirmation expired or unavailable",
            ));
        }
        state.confirmation = None;
        state.snapshot.phase = Phase::Forced;
        state.snapshot.message = "Forced termination; cleanup is incomplete".into();
        state.dirty = true;
        let evidence = ForceEvidence {
            version: 1,
            ok: false,
            cleanup_complete: false,
            session: r.session.clone(),
            attempt: r.attempt.clone(),
            snapshot: state.snapshot_at(now),
        };
        drop(state);
        self.deliver();
        Ok(evidence)
    }
    /// One active sender and one latest state. Reentrant updates coalesce rather
    /// than recursively sending or building a history queue.
    fn deliver(&self) {
        let mut state = self.lock();
        if state.delivering {
            return;
        }
        state.delivering = true;
        loop {
            let delivery = if state.dirty {
                state.document.as_ref().and_then(|d| {
                    d.sink.as_ref().map(|sink| {
                        (
                            d.session.clone(),
                            sink.clone(),
                            state.snapshot_at(Instant::now()),
                        )
                    })
                })
            } else {
                None
            };
            state.dirty = false;
            let Some((session, sink, snapshot)) = delivery else {
                state.delivering = false;
                return;
            };
            drop(state);
            let sent = sink.send(snapshot);
            // Release our callback reference outside the mutex too.
            drop(sink);
            state = self.lock();
            let retired = if !sent {
                state
                    .document
                    .as_mut()
                    .filter(|d| d.session == session)
                    .and_then(|d| d.sink.take())
            } else {
                None
            };
            drop(state);
            drop(retired);
            state = self.lock();
        }
    }
}
impl Inner {
    fn unfinished(&self) -> bool {
        self.started.is_some() && matches!(self.snapshot.phase, Phase::Draining | Phase::Failed)
    }
    fn eligible(&self, now: Instant) -> bool {
        self.unfinished()
            && (self.snapshot.failure.is_some()
                || self
                    .started
                    .is_some_and(|start| now.saturating_duration_since(start) >= DISPLAY_DELAY))
    }
    fn snapshot_at(&self, now: Instant) -> Snapshot {
        let mut snapshot = self.snapshot.clone();
        snapshot.force_eligible = self.eligible(now);
        snapshot
    }
    fn authorize(&self, caller: &str, version: u8, session: &str, attempt: &str) -> Reply<()> {
        if version != 1
            || attempt != self.snapshot.attempt
            || caller != session
            || !self
                .document
                .as_ref()
                .is_some_and(|d| d.session == session && d.connected)
        {
            return Err(wire::error(
                "denied",
                "Shutdown caller, lifetime or attempt denied",
            ));
        }
        Ok(())
    }
}

#[path = "shutdown_tests.rs"]
#[cfg(test)]
mod tests;
