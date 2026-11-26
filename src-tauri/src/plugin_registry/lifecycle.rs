//! Internal lifecycle control. Publication adapters remain test-only.
use super::super::{generation::SealFailure, location::LocationLease};
use super::*;

#[derive(Clone, Debug)]
pub(crate) struct LifecycleRevision {
    instance: Arc<()>,
    sequence: u128,
}
impl PartialEq for LifecycleRevision {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.instance, &other.instance) && self.sequence == other.sequence
    }
}
impl Eq for LifecycleRevision {}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RecoveryKind {
    Preparation,
    PublicationUnknown,
    PublishedNotReady,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LifecyclePhase {
    Opening,
    Ready,
    Maintenance,
    RecoveryOnly(RecoveryKind),
    ShuttingDown,
    Stopped,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MaintenanceOutcome {
    Ready,
    Recovery(RecoveryKind),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct LifecycleSnapshot {
    pub revision: LifecycleRevision,
    pub phase: LifecyclePhase,
    pub last_outcome: Option<MaintenanceOutcome>,
}

pub(super) struct LifecycleData {
    pub snapshot: LifecycleSnapshot,
    pub shutdown: bool,
    pub service: u128,
    pending: Option<MaintenanceTask>,
}
impl LifecycleData {
    pub fn new() -> Self {
        Self {
            snapshot: LifecycleSnapshot {
                revision: LifecycleRevision {
                    instance: Arc::new(()),
                    sequence: 0,
                },
                phase: LifecyclePhase::Opening,
                last_outcome: None,
            },
            shutdown: false,
            service: 0,
            pending: None,
        }
    }
    fn advance(&mut self) {
        // Refresh the opaque identity on exhaustion rather than reuse a revision.
        match self.snapshot.revision.sequence.checked_add(1) {
            Some(sequence) => self.snapshot.revision.sequence = sequence,
            None => {
                self.snapshot.revision = LifecycleRevision {
                    instance: Arc::new(()),
                    sequence: 0,
                };
            }
        }
    }
    pub fn shutdown(&mut self) {
        if !self.shutdown {
            self.shutdown = true;
            self.advance();
            if self.snapshot.phase != LifecyclePhase::Stopped {
                self.snapshot.phase = LifecyclePhase::ShuttingDown;
            }
        }
    }
    pub fn stopped(&mut self) {
        self.shutdown = true;
        self.snapshot.phase = LifecyclePhase::Stopped;
        self.advance();
        self.pending.take();
    }
}

#[derive(Clone)]
pub(crate) struct RegistryControl {
    pub(super) shared: Arc<Shared>,
}
impl RegistryControl {
    pub(crate) fn snapshot(&self) -> LifecycleSnapshot {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .lifecycle
            .snapshot
            .clone()
    }
    pub(crate) fn ready_handle(&self, expected: &LifecycleRevision) -> Result<RegistryHandle> {
        let state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.lifecycle.shutdown {
            return Err(RegistryError::Unavailable(
                "registry is shutting down".into(),
            ));
        }
        if &state.lifecycle.snapshot.revision != expected {
            return Err(RegistryError::Conflict("stale lifecycle revision".into()));
        }
        if !state.accepting || state.lifecycle.snapshot.phase != LifecyclePhase::Ready {
            return Err(RegistryError::Unavailable("registry is not ready".into()));
        }
        Ok(RegistryHandle {
            shared: self.shared.clone(),
            service: state.lifecycle.service,
        })
    }
    pub(crate) async fn maintain(
        &self,
        expected: LifecycleRevision,
        request: MaintenanceRequest,
    ) -> Result<()> {
        let (reply, receive) = oneshot::channel();
        {
            let mut state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
            if state.lifecycle.shutdown {
                return Err(RegistryError::Unavailable(
                    "registry is shutting down".into(),
                ));
            }
            if state.lifecycle.snapshot.revision != expected {
                return Err(RegistryError::Conflict("stale lifecycle revision".into()));
            }
            if state.lifecycle.snapshot.phase == LifecyclePhase::Maintenance {
                return Err(RegistryError::Conflict(
                    "maintenance already admitted".into(),
                ));
            }
            if state.lifecycle.snapshot.phase != LifecyclePhase::Ready {
                return Err(RegistryError::Unavailable(
                    "registry requires explicit recovery".into(),
                ));
            }
            state.accepting = false;
            state.lifecycle.advance();
            state.lifecycle.snapshot.phase = LifecyclePhase::Maintenance;
            state.lifecycle.pending = Some(MaintenanceTask { request, reply });
            self.shared.wake.notify_all();
        }
        receive.await.unwrap_or_else(|_| {
            Err(RegistryError::OutcomeUnknown(
                "maintenance completion lost; inspect authoritative lifecycle state".into(),
            ))
        })
    }
}

// Only typed test adapters can currently construct requests. There is no
// production publisher, restore request constructor, or arbitrary host callback API.
pub(crate) struct MaintenanceRequest {
    operation: Box<dyn Maintenance>,
}
trait Maintenance: Send {
    fn execute(self: Box<Self>, lease: Option<&LocationLease>) -> MaintenanceResult;
}
struct MaintenanceTask {
    request: MaintenanceRequest,
    reply: oneshot::Sender<Result<()>>,
}
enum MaintenanceResult {
    Ready(Store),
    Recovery {
        error: RegistryError,
        kind: RecoveryKind,
        retained: Option<SealFailure>,
    },
}

pub(super) fn run_worker(shared: &Shared, store: Store, lease: Option<&LocationLease>) {
    let mut store = Some(store);
    // This value is deliberately local to the SQLite thread, never Shared.
    let mut retained_failure = None;
    enum Action {
        Work(Box<dyn Work>),
        Maintenance(MaintenanceTask),
        Stop,
    }
    loop {
        let action = {
            let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                match state.queue.pop_front() {
                    Some(job) => {
                        if !state.accepting && job.is_read() {
                            drop(state);
                            job.reject();
                            state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
                            continue;
                        }
                        break Action::Work(job);
                    }
                    None => {
                        if let Some(task) = state.lifecycle.pending.take() {
                            break Action::Maintenance(task);
                        }
                        if state.lifecycle.shutdown {
                            break Action::Stop;
                        }
                        state = shared.wake.wait(state).unwrap_or_else(|e| e.into_inner());
                    }
                }
            }
        };
        match action {
            Action::Work(job) => {
                job.execute(store.as_mut().expect("admitted operation owns a store"))
            }
            Action::Stop => break,
            Action::Maintenance(task) => {
                // Close the old service before replacement preparation. No SQL
                // or file cleanup runs while holding the admission mutex.
                drop(store.take());
                let result =
                    catch_unwind(AssertUnwindSafe(|| task.request.operation.execute(lease)));
                let result = match result {
                    Ok(result) => result,
                    Err(_) => MaintenanceResult::Recovery {
                        error: RegistryError::OutcomeUnknown(
                            "maintenance terminated unexpectedly".into(),
                        ),
                        kind: RecoveryKind::PublicationUnknown,
                        retained: None,
                    },
                };
                let (outcome, reply) = match result {
                    MaintenanceResult::Ready(next) => {
                        store = Some(next);
                        (MaintenanceOutcome::Ready, Ok(()))
                    }
                    MaintenanceResult::Recovery {
                        error,
                        kind,
                        retained,
                    } => {
                        retained_failure = retained;
                        (MaintenanceOutcome::Recovery(kind), Err(error))
                    }
                };
                {
                    let mut state = shared.state.lock().unwrap_or_else(|e| e.into_inner());
                    state.lifecycle.advance();
                    state.lifecycle.snapshot.last_outcome = Some(outcome);
                    if !state.lifecycle.shutdown {
                        match outcome {
                            MaintenanceOutcome::Ready => {
                                state.lifecycle.service = state
                                    .lifecycle
                                    .service
                                    .checked_add(1)
                                    .expect("service identity exhausted");
                                state.lifecycle.snapshot.phase = LifecyclePhase::Ready;
                                state.accepting = true;
                            }
                            MaintenanceOutcome::Recovery(kind) => {
                                state.lifecycle.snapshot.phase = LifecyclePhase::RecoveryOnly(kind);
                            }
                        }
                    }
                }
                let _ = task.reply.send(reply);
            }
        }
    }
    drop(store);
    drop(retained_failure);
}

#[cfg(test)]
impl MaintenanceRequest {
    fn fixture<F>(run: F) -> Self
    where
        F: FnOnce(Option<&LocationLease>) -> MaintenanceResult + Send + 'static,
    {
        struct Fixture<F>(F);
        impl<F> Maintenance for Fixture<F>
        where
            F: FnOnce(Option<&LocationLease>) -> MaintenanceResult + Send + 'static,
        {
            fn execute(self: Box<Self>, lease: Option<&LocationLease>) -> MaintenanceResult {
                (self.0)(lease)
            }
        }
        Self {
            operation: Box::new(Fixture(run)),
        }
    }
}

#[cfg(test)]
#[path = "lifecycle_tests.rs"]
mod tests;
