//! Internal real-registry settings coordination. No IPC or plugin authority.
//!
//! The fixture must close this owner before replacing the registry, and await
//! settings shutdown before registry/runtime shutdown. Drop only closes admission;
//! it cannot keep an executor alive. There is deliberately no lifecycle watch:
//! poisoning by unrelated registry operations is detected only on our next read
//! or write. Production writes should route here; lower-level writes are not
//! globally intercepted and cannot generate notifications.
//!
//! Close prevents reconciliation and discards pending deliveries. Callback selection
//! is ordered with close under the state mutex, but invocation is outside it. An
//! already-selected callback may start or finish after close returns. Awaited
//! shutdown also waits for that callback and its cleanup; close is not synchronous
//! callback revocation.
use super::{
    CommandResourceRevision, CommandResourceSettings, CommandResourceSettingsSnapshot,
    RegistryError, RegistryHandle, Result,
};
use std::{
    collections::BTreeMap,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{Arc, Mutex, MutexGuard},
};
use tokio::sync::{oneshot, Notify};

/// Identity is compared by allocation, not persisted revision or settings values.
#[derive(Clone, Debug)]
pub(crate) struct SettingsEpoch(Arc<()>);
impl PartialEq for SettingsEpoch {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for SettingsEpoch {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SettingsSnapshot {
    pub epoch: SettingsEpoch,
    pub saved: CommandResourceSettingsSnapshot,
}

/// A confirmed conflict remains a conflict even if its subsequent observation fails.
#[derive(Debug)]
pub(crate) enum SaveOutcome {
    Saved(Arc<SettingsSnapshot>),
    Conflict {
        error: RegistryError,
        current: Option<Arc<SettingsSnapshot>>,
        read_error: Option<RegistryError>,
    },
}

pub(crate) struct SettingsOwner {
    shared: Arc<Shared>,
}
#[derive(Clone)]
pub(crate) struct SettingsOperations {
    shared: Arc<Shared>,
}
/// Read/subscription access only. It cannot produce a write-capable handle.
#[derive(Clone)]
pub(crate) struct SettingsAssociation {
    shared: Arc<Shared>,
}
pub(crate) struct SettingsSubscription {
    shared: Arc<Shared>,
    id: u64,
}

type Observer = Arc<dyn Fn(Arc<SettingsSnapshot>) + Send + Sync>;
struct Subscriber {
    observer: Observer,
    in_progress: Option<Arc<SettingsSnapshot>>,
    latest: Option<Arc<SettingsSnapshot>>,
}
struct State {
    closed: bool,
    snapshot: Arc<SettingsSnapshot>,
    operations: usize,
    delivery_running: bool,
    next_subscription: u64,
    subscribers: BTreeMap<u64, Subscriber>,
}
struct Shared {
    registry: RegistryHandle,
    max_operations: usize,
    max_subscribers: usize,
    state: Mutex<State>,
    delivery: Notify,
    drained: Notify,
    #[cfg(test)]
    fail_delivery_turn: std::sync::atomic::AtomicBool,
}
impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    fn close(&self) {
        let removed = {
            let mut state = self.lock();
            state.closed = true;
            std::mem::take(&mut state.subscribers)
        };
        // Wake before foreign cleanup. Destructors may reenter or panic. Drop
        // each subscriber separately so one panic cannot unwind through another.
        self.delivery.notify_one();
        for (_, subscriber) in removed {
            let _ = caught_panic(catch_unwind(AssertUnwindSafe(|| drop(subscriber))));
        }
    }
    // This includes the final callback Arc and rejected registration callbacks.
    // Never call it with a state guard held: captured destructors are foreign code.
    fn dispose_observer<T>(&self, value: T) {
        if caught_panic(catch_unwind(AssertUnwindSafe(|| drop(value)))) {
            self.close();
        }
    }
    fn snapshot(&self, saved: CommandResourceSettingsSnapshot) -> Arc<SettingsSnapshot> {
        Arc::new(SettingsSnapshot {
            epoch: self.lock().snapshot.epoch.clone(),
            saved,
        })
    }
    fn reconcile(&self, snapshot: Arc<SettingsSnapshot>) {
        let inconsistent = {
            let mut state = self.lock();
            if state.closed || snapshot.saved.revision < state.snapshot.saved.revision {
                return;
            }
            if snapshot.saved.revision == state.snapshot.saved.revision {
                snapshot.saved.settings != state.snapshot.saved.settings
            } else {
                state.snapshot = snapshot.clone();
                for subscriber in state.subscribers.values_mut() {
                    subscriber.latest = Some(snapshot.clone());
                }
                self.delivery.notify_one();
                false
            }
        };
        if inconsistent {
            self.close();
        }
    }
    fn read_failure(&self, error: &RegistryError) {
        if matches!(
            error,
            RegistryError::Unavailable(_)
                | RegistryError::RecoveryRequired(_)
                | RegistryError::OutcomeUnknown(_)
        ) {
            self.close();
        }
    }
    fn reserve(self: &Arc<Self>) -> Result<OperationSlot> {
        let mut state = self.lock();
        if state.closed {
            return Err(closed());
        }
        if state.operations >= self.max_operations {
            return Err(RegistryError::LimitExceeded(
                "settings operation capacity".into(),
            ));
        }
        state.operations += 1;
        Ok(OperationSlot(self.clone()))
    }
    async fn drain(&self) {
        loop {
            let notified = self.drained.notified();
            // Register before checking, including on multithreaded runtimes.
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let state = self.lock();
                if state.operations == 0 && !state.delivery_running {
                    return;
                }
            }
            notified.await;
        }
    }
}
// Even a panic in callback cleanup must not leave a live association with a
// dead delivery task. Construct this before spawn so unpolled task drop is safe.
struct DeliveryExit(Arc<Shared>);
impl Drop for DeliveryExit {
    fn drop(&mut self) {
        // Finish last, including if close itself unexpectedly unwinds.
        struct Finished<'a>(&'a Shared);
        impl Drop for Finished<'_> {
            fn drop(&mut self) {
                self.0.lock().delivery_running = false;
                self.0.drained.notify_waiters();
            }
        }
        let _finished = Finished(&self.0);
        self.0.close();
    }
}

// A custom panic payload can itself have a panicking destructor. Isolate that
// too. Only a second panicking payload must be leaked to stop recursive unwinding.
fn caught_panic(result: std::thread::Result<()>) -> bool {
    match result {
        Ok(()) => false,
        Err(payload) => {
            if let Err(nested) = catch_unwind(AssertUnwindSafe(|| drop(payload))) {
                std::mem::forget(nested);
            }
            true
        }
    }
}

struct OperationSlot(Arc<Shared>);
impl Drop for OperationSlot {
    fn drop(&mut self) {
        self.0.lock().operations -= 1;
        self.0.drained.notify_waiters();
    }
}
fn closed() -> RegistryError {
    RegistryError::Unavailable("settings association closed; explicit reattachment required".into())
}

impl SettingsOwner {
    /// Requires a running supplied Tokio runtime. No guessed settings are exposed.
    pub(crate) async fn start(
        registry: RegistryHandle,
        max_operations: usize,
        max_subscribers: usize,
    ) -> Result<Self> {
        if max_operations == 0 || max_subscribers == 0 {
            return Err(RegistryError::InvalidInput(
                "settings capacities must be positive".into(),
            ));
        }
        let saved = registry.read_command_resource_settings().await?;
        let shared = Arc::new(Shared {
            registry,
            max_operations,
            max_subscribers,
            state: Mutex::new(State {
                closed: false,
                snapshot: Arc::new(SettingsSnapshot {
                    epoch: SettingsEpoch(Arc::new(())),
                    saved,
                }),
                operations: 0,
                delivery_running: true,
                next_subscription: 0,
                subscribers: BTreeMap::new(),
            }),
            delivery: Notify::new(),
            drained: Notify::new(),
            #[cfg(test)]
            fail_delivery_turn: std::sync::atomic::AtomicBool::new(false),
        });
        tokio::spawn(deliver(DeliveryExit(shared.clone())));
        Ok(Self { shared })
    }
    pub(crate) fn operations(&self) -> SettingsOperations {
        SettingsOperations {
            shared: self.shared.clone(),
        }
    }
    pub(crate) fn association(&self) -> SettingsAssociation {
        SettingsAssociation {
            shared: self.shared.clone(),
        }
    }
    pub(crate) fn close(&self) {
        self.shared.close();
    }
    pub(crate) async fn shutdown(self) {
        self.close();
        self.shared.drain().await;
    }
}
impl Drop for SettingsOwner {
    fn drop(&mut self) {
        self.shared.close();
    }
}
impl SettingsOperations {
    pub(crate) async fn read(&self) -> Result<Arc<SettingsSnapshot>> {
        let slot = self.shared.reserve()?;
        let shared = self.shared.clone();
        let (send, receive) = oneshot::channel();
        tokio::spawn(async move {
            let _slot = slot;
            let result = shared.registry.read_command_resource_settings().await;
            let result = match result {
                Ok(saved) => {
                    let snapshot = shared.snapshot(saved);
                    shared.reconcile(snapshot.clone());
                    Ok(snapshot)
                }
                Err(error) => {
                    shared.read_failure(&error);
                    Err(error)
                }
            };
            let _ = send.send(result);
        });
        receive.await.unwrap_or_else(|_| Err(closed()))
    }
    pub(crate) async fn save(
        &self,
        expected_revision: CommandResourceRevision,
        settings: CommandResourceSettings,
    ) -> Result<SaveOutcome> {
        let slot = self.shared.reserve()?;
        let shared = self.shared.clone();
        let (send, receive) = oneshot::channel();
        tokio::spawn(async move {
            let _slot = slot;
            let result = shared
                .registry
                .set_command_resource_settings(expected_revision, settings)
                .await;
            let outcome = match result {
                Ok(saved) => {
                    let snapshot = shared.snapshot(saved);
                    shared.reconcile(snapshot.clone());
                    Ok(SaveOutcome::Saved(snapshot))
                }
                Err(error @ RegistryError::Conflict(_)) => {
                    // This read is a later observation, not the conflicting transaction.
                    match shared.registry.read_command_resource_settings().await {
                        Ok(saved) => {
                            let snapshot = shared.snapshot(saved);
                            shared.reconcile(snapshot.clone());
                            Ok(SaveOutcome::Conflict {
                                error,
                                current: Some(snapshot),
                                read_error: None,
                            })
                        }
                        Err(read_error) => {
                            shared.close();
                            Ok(SaveOutcome::Conflict {
                                error,
                                current: None,
                                read_error: Some(read_error),
                            })
                        }
                    }
                }
                Err(error) => {
                    // In particular, never reread a store poisoned by OutcomeUnknown.
                    shared.read_failure(&error);
                    Err(error)
                }
            };
            let _ = send.send(outcome);
        });
        receive.await.unwrap_or_else(|_| {
            Err(RegistryError::OutcomeUnknown(
                "settings completion lost; controlled recovery required".into(),
            ))
        })
    }
}
impl SettingsAssociation {
    pub(crate) fn is_closed(&self) -> bool {
        self.shared.lock().closed
    }
    pub(crate) async fn read(&self) -> Result<Arc<SettingsSnapshot>> {
        SettingsOperations {
            shared: self.shared.clone(),
        }
        .read()
        .await
    }
    pub(crate) fn subscribe(
        &self,
        observer: impl Fn(Arc<SettingsSnapshot>) + Send + Sync + 'static,
    ) -> Result<SettingsSubscription> {
        let observer: Observer = Arc::new(observer);
        let result = (|| {
            let mut state = self.shared.lock();
            if state.closed {
                return Err(closed());
            }
            if state.subscribers.len() >= self.shared.max_subscribers {
                return Err(RegistryError::LimitExceeded(
                    "settings subscriber capacity".into(),
                ));
            }
            let id = state.next_subscription;
            state.next_subscription = id.checked_add(1).ok_or_else(|| {
                RegistryError::LimitExceeded("settings subscriber identity exhausted".into())
            })?;
            let latest = Some(state.snapshot.clone());
            state.subscribers.insert(
                id,
                Subscriber {
                    observer: observer.clone(),
                    in_progress: None,
                    latest,
                },
            );
            self.shared.delivery.notify_one();
            Ok(SettingsSubscription {
                shared: self.shared.clone(),
                id,
            })
        })();
        self.shared.dispose_observer(observer);
        result
    }
}
impl SettingsSubscription {
    /// Only the exact in-progress epoch/revision can release delivery capacity.
    pub(crate) fn acknowledge(
        &self,
        epoch: &SettingsEpoch,
        revision: CommandResourceRevision,
    ) -> bool {
        let mut state = self.shared.lock();
        let Some(subscriber) = state.subscribers.get_mut(&self.id) else {
            return false;
        };
        if !subscriber
            .in_progress
            .as_ref()
            .is_some_and(|s| &s.epoch == epoch && s.saved.revision == revision)
        {
            return false;
        }
        subscriber.in_progress = None;
        self.shared.delivery.notify_one();
        true
    }
}
impl Drop for SettingsSubscription {
    fn drop(&mut self) {
        let removed = self.shared.lock().subscribers.remove(&self.id);
        self.shared.dispose_observer(removed);
    }
}

/// One service task, not a task/closure per notification or subscription. A turn
/// visits only identities present at its start. Reentrant churn waits for a yield.
async fn deliver(exit: DeliveryExit) {
    let shared = &exit.0;
    loop {
        shared.delivery.notified().await;
        #[cfg(test)]
        assert!(
            !shared
                .fail_delivery_turn
                .swap(false, std::sync::atomic::Ordering::SeqCst),
            "injected delivery turn panic"
        );
        let ids = {
            let state = shared.lock();
            if state.closed {
                break;
            }
            state.subscribers.keys().copied().collect::<Vec<_>>()
        };
        for id in ids {
            let next = {
                let mut state = shared.lock();
                state.subscribers.get_mut(&id).and_then(|subscriber| {
                    if subscriber.in_progress.is_some() {
                        return None;
                    }
                    subscriber.latest.take().map(|snapshot| {
                        subscriber.in_progress = Some(snapshot.clone());
                        (subscriber.observer.clone(), snapshot)
                    })
                })
            };
            if let Some((observer, snapshot)) = next {
                if caught_panic(catch_unwind(AssertUnwindSafe(|| observer(snapshot)))) {
                    let removed = shared.lock().subscribers.remove(&id);
                    shared.dispose_observer(removed);
                }
                shared.dispose_observer(observer);
            }
        }
        tokio::task::yield_now().await;
    }
}

#[cfg(test)]
#[path = "command_resource_settings_tests.rs"]
mod tests;
