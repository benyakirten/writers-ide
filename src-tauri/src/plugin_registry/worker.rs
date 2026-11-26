use std::{
    collections::VecDeque,
    panic::{catch_unwind, AssertUnwindSafe},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex},
    thread::{self, JoinHandle},
};
use tokio::sync::oneshot;

use super::{
    error::{RegistryError, Result},
    model::*,
    preparation::*,
    store::{ArtifactTarget, Store},
    transitions::{InstallationAction, InstallationExpectation},
};

#[path = "lifecycle.rs"]
pub(crate) mod lifecycle;
use super::location::LocationLease;
use lifecycle::{LifecycleData, LifecyclePhase, RegistryControl};

trait Work: Send {
    fn is_read(&self) -> bool;
    fn execute(self: Box<Self>, store: &mut Store);
    fn reject(self: Box<Self>);
}

struct Operation<F, T> {
    read: bool,
    run: F,
    reply: oneshot::Sender<Result<T>>,
}
impl<F, T> Work for Operation<F, T>
where
    F: FnOnce(&mut Store) -> Result<T> + Send + 'static,
    T: Send + 'static,
{
    fn is_read(&self) -> bool {
        self.read
    }
    fn execute(self: Box<Self>, store: &mut Store) {
        if self.read && self.reply.is_closed() {
            return;
        }
        let result = (self.run)(store);
        let _ = self.reply.send(result);
    }
    fn reject(self: Box<Self>) {
        let _ = self.reply.send(Err(RegistryError::Unavailable(
            "worker stopped before execution".into(),
        )));
    }
}

struct State {
    accepting: bool,
    queue: VecDeque<Box<dyn Work>>,
    lifecycle: LifecycleData,
}
struct Shared {
    state: Mutex<State>,
    wake: Condvar,
    capacity: usize,
    #[cfg(test)]
    probe_lease: Mutex<Option<Arc<std::fs::File>>>,
}
impl Shared {
    fn close(&self) {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        state.accepting = false;
        state.lifecycle.shutdown();
        self.wake.notify_all();
    }
    fn failed(&self) {
        let jobs = {
            let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
            state.accepting = false;
            state.lifecycle.stopped();
            std::mem::take(&mut state.queue)
        };
        for job in jobs {
            job.reject();
        }
        self.wake.notify_all();
    }
}

pub(crate) struct Registry;
pub(crate) struct RegistrySession {
    pub owner: RegistryOwner,
    pub handle: RegistryHandle,
}
#[derive(Clone)]
pub(crate) struct RegistryHandle {
    shared: Arc<Shared>,
    service: u128,
}
pub(crate) struct RegistryOwner {
    shared: Arc<Shared>,
    finished: Option<oneshot::Receiver<Result<()>>>,
    thread: Option<JoinHandle<()>>,
}
impl Drop for RegistryOwner {
    fn drop(&mut self) {
        self.shared.close();
    }
}
impl RegistryOwner {
    pub(crate) fn control(&self) -> RegistryControl {
        RegistryControl {
            shared: self.shared.clone(),
        }
    }

    /// Fixture-only attachment hook. Owned opening retains its lease independently.
    #[cfg(test)]
    pub(super) fn retain_probe_lease(&self, lease: Arc<std::fs::File>) -> Result<()> {
        let state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
        if !state.accepting {
            return Err(RegistryError::Unavailable(
                "probe cannot attach to a stopped worker".into(),
            ));
        }
        let mut guard = self
            .shared
            .probe_lease
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(existing) = guard.as_ref() {
            return if Arc::ptr_eq(existing, &lease) {
                Ok(())
            } else {
                Err(RegistryError::Conflict(
                    "different probe lease already attached".into(),
                ))
            };
        }
        *guard = Some(lease);
        Ok(())
    }
    pub(crate) async fn shutdown(mut self) -> Result<()> {
        self.shared.close();
        let completion = self
            .finished
            .take()
            .expect("owned completion")
            .await
            .unwrap_or_else(|_| Err(RegistryError::Unavailable("worker completion lost".into())));
        // Cleanup has finished, but joining must still not block the executor thread.
        if let Some(thread) = self.thread.take() {
            tokio::task::spawn_blocking(move || thread.join())
                .await
                .map_err(|e| RegistryError::Unavailable(format!("worker join: {e}")))?
                .map_err(|_| RegistryError::Unavailable("worker panicked".into()))?;
        }
        completion
    }
}

#[cfg(test)]
pub(super) struct ProbeStartup {
    pub lease: Arc<std::fs::File>,
    pub after_open: Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
}

impl Registry {
    #[cfg(test)]
    pub(crate) async fn create(
        path: PathBuf,
        limits: RegistryLimits,
        queue_capacity: usize,
    ) -> Result<RegistrySession> {
        Self::start(
            path,
            limits,
            queue_capacity,
            true,
            None,
            #[cfg(test)]
            None,
        )
        .await
    }
    #[cfg(test)]
    pub(crate) async fn open(
        path: PathBuf,
        limits: RegistryLimits,
        queue_capacity: usize,
    ) -> Result<RegistrySession> {
        Self::start(
            path,
            limits,
            queue_capacity,
            false,
            None,
            #[cfg(test)]
            None,
        )
        .await
    }
    /// The host must already have selected and validated the generation under
    /// this lease. This helper does not read a selector or initialize a root.
    pub(crate) async fn open_owned(
        lease: LocationLease,
        path: PathBuf,
        limits: RegistryLimits,
        capacity: usize,
    ) -> Result<RegistrySession> {
        Self::start(
            path,
            limits,
            capacity,
            false,
            Some(lease),
            #[cfg(test)]
            None,
        )
        .await
    }

    #[cfg(test)]
    pub(super) async fn open_for_probe(
        path: PathBuf,
        limits: RegistryLimits,
        capacity: usize,
        probe: ProbeStartup,
    ) -> Result<RegistrySession> {
        Self::start(path, limits, capacity, false, None, Some(probe)).await
    }
    async fn start(
        path: PathBuf,
        limits: RegistryLimits,
        capacity: usize,
        create: bool,
        lease: Option<LocationLease>,
        #[cfg(test)] probe: Option<ProbeStartup>,
    ) -> Result<RegistrySession> {
        limits.validate()?;
        if capacity == 0 {
            return Err(RegistryError::InvalidInput(
                "queue capacity must be positive".into(),
            ));
        }
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                accepting: false,
                queue: VecDeque::new(),
                lifecycle: LifecycleData::new(),
            }),
            wake: Condvar::new(),
            capacity,
            #[cfg(test)]
            probe_lease: Mutex::new(probe.as_ref().map(|probe| probe.lease.clone())),
        });
        let (ready, receive_ready) = oneshot::channel();
        let (finished, receive_finished) = oneshot::channel();
        let worker_shared = shared.clone();
        let thread = thread::Builder::new()
            .name("plugin-registry".into())
            .spawn(move || {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    let path = match lease
                        .as_ref()
                        .map(|lease| lease.check_database(&path))
                        .transpose()
                    {
                        Ok(Some(path)) => path,
                        Ok(None) => path,
                        Err(error) => {
                            let _ = ready.send(Err(error));
                            return;
                        }
                    };
                    let store = if create {
                        Store::create(&path, limits)
                    } else {
                        Store::open(&path, limits)
                    };
                    let store = match store {
                        Ok(store) => store,
                        Err(error) => {
                            let _ = ready.send(Err(error));
                            return;
                        }
                    };
                    #[cfg(test)]
                    if let Some(probe) = probe {
                        if let Some((entered, release)) = probe.after_open {
                            let _ = entered.send(());
                            if release
                                .recv_timeout(std::time::Duration::from_secs(10))
                                .is_err()
                            {
                                let _ = ready.send(Err(RegistryError::Unavailable(
                                    "probe startup barrier timed out".into(),
                                )));
                                return;
                            }
                        }
                    }
                    {
                        let mut state = worker_shared
                            .state
                            .lock()
                            .unwrap_or_else(|e| e.into_inner());
                        if state.lifecycle.shutdown {
                            return;
                        }
                        state.lifecycle.snapshot.phase = LifecyclePhase::Ready;
                        state.accepting = true;
                    }
                    // If startup's waiter is gone, no operation handle was issued.
                    if ready.send(Ok(())).is_err() {
                        return;
                    }
                    lifecycle::run_worker(&worker_shared, store, lease.as_ref());
                    // Store and its exclusive destination lock drop before completion.
                }));
                worker_shared.failed();
                #[cfg(test)]
                worker_shared
                    .probe_lease
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .take();
                let completion = result.map_err(|_| {
                    RegistryError::Unavailable("registry worker terminated unexpectedly".into())
                });
                drop(lease);
                let _ = finished.send(completion);
            })?;
        // The guard also closes admission if the startup future is abandoned.
        let owner = RegistryOwner {
            shared: shared.clone(),
            finished: Some(receive_finished),
            thread: Some(thread),
        };
        receive_ready
            .await
            .map_err(|_| RegistryError::Unavailable("registry startup terminated".into()))??;
        Ok(RegistrySession {
            owner,
            handle: RegistryHandle { shared, service: 0 },
        })
    }
}

impl RegistryHandle {
    async fn submit<T, F>(&self, read: bool, run: F) -> Result<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Store) -> Result<T> + Send + 'static,
    {
        let (reply, receive) = oneshot::channel();
        {
            let mut state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
            if !state.accepting || state.lifecycle.service != self.service {
                return Err(RegistryError::Unavailable(
                    "registry admission closed".into(),
                ));
            }
            if state.queue.len() >= self.shared.capacity {
                return Err(RegistryError::LimitExceeded(
                    "registry queue is full".into(),
                ));
            }
            state
                .queue
                .push_back(Box::new(Operation { read, run, reply }));
            self.shared.wake.notify_one();
        }
        receive.await.unwrap_or_else(|_| {
            Err(if read {
                RegistryError::Unavailable("read completion lost".into())
            } else {
                RegistryError::OutcomeUnknown(
                    "admitted write completion lost; inspect authoritative state".into(),
                )
            })
        })
    }
    pub(crate) async fn read_settings(&self) -> Result<HostSettings> {
        self.submit(true, Store::read_settings).await
    }
    pub(crate) async fn package_details(&self, package: PackageId) -> Result<PackageDetails> {
        self.submit(true, move |s| s.package_details(package)).await
    }
    pub(crate) async fn project_details(&self, project: ProjectId) -> Result<ProjectDetails> {
        self.submit(true, move |s| s.project_details(project)).await
    }
    pub(crate) async fn accept_artifact(
        &self,
        prepared: PreparedArtifact,
        receipt: PublicationReceipt,
    ) -> Result<ArtifactFacts> {
        self.submit(false, move |s| s.accept_artifact(prepared, receipt))
            .await
    }
    pub(crate) async fn change_installation(
        &self,
        expected: InstallationExpectation,
        action: InstallationAction,
        target: Option<ArtifactTarget>,
        prerequisites: Option<InstallationPrerequisites>,
    ) -> Result<InstallationSnapshot> {
        self.submit(false, move |s| {
            s.change_installation(expected, action, target, prerequisites)
        })
        .await
    }
    pub(crate) async fn set_host_settings(
        &self,
        expected: HostSettings,
        settings: HostSettings,
    ) -> Result<HostSettings> {
        self.submit(false, move |s| s.set_host_settings(expected, settings))
            .await
    }
    pub(crate) async fn save_permission_review(&self, review: PermissionReview) -> Result<()> {
        self.submit(false, move |s| s.save_permission_review(review))
            .await
    }
    pub(crate) async fn acknowledge_scope(&self, review: ScopeReview) -> Result<()> {
        self.submit(false, move |s| s.acknowledge_scope(review))
            .await
    }
    pub(crate) async fn set_enablement(&self, change: EnablementChange) -> Result<()> {
        self.submit(false, move |s| s.set_enablement(change)).await
    }
    pub(crate) async fn register_project(&self, prepared: PreparedProject) -> Result<ProjectId> {
        self.submit(false, move |s| s.register_project(prepared))
            .await
    }
    pub(crate) async fn relink_project(
        &self,
        project: ProjectId,
        expected: Revision,
        prepared: PreparedProject,
        closed: RelinkPrerequisite,
    ) -> Result<Revision> {
        self.submit(false, move |s| {
            s.relink_project(project, expected, prepared, closed)
        })
        .await
    }
    pub(crate) async fn refresh_project_name(
        &self,
        project: ProjectId,
        expected: Revision,
        prepared: PreparedProject,
    ) -> Result<()> {
        self.submit(false, move |s| {
            s.refresh_project_name(project, expected, prepared)
        })
        .await
    }
    pub(crate) async fn remove_unused_artifact(
        &self,
        artifact: ArtifactId,
        unused: ArtifactUnused,
    ) -> Result<()> {
        self.submit(false, move |s| s.remove_unused_artifact(artifact, unused))
            .await
    }
    pub(crate) async fn backup(&self, destination: PathBuf) -> Result<()> {
        // Backup writes a destination file and must finish after successful admission.
        self.submit(false, move |s| s.backup(&destination)).await
    }
}

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;
