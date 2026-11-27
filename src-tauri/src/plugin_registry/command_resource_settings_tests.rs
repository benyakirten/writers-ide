use super::*;
use crate::{
    plugin_integrity::IntegrityLimits,
    plugin_registry::{Registry, RegistryLimits, RegistrySession},
};
use std::{
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc,
    },
    task::{Context, Poll, Waker},
    time::Duration,
};

// An outer watchdog also bounds futures that never wake. No sleeps or time feature.
fn run(future: impl Future<Output = ()> + Send + 'static) {
    let (send, receive) = mpsc::channel();
    let thread = std::thread::spawn(move || {
        let result = catch_unwind(AssertUnwindSafe(|| {
            tokio::runtime::Builder::new_current_thread()
                .build()
                .unwrap()
                .block_on(future);
        }));
        send.send(result).unwrap();
    });
    let result = receive
        .recv_timeout(Duration::from_secs(20))
        .expect("settings test watchdog");
    thread.join().unwrap();
    if let Err(panic) = result {
        std::panic::resume_unwind(panic);
    }
}
fn limits() -> RegistryLimits {
    RegistryLimits {
        integrity: IntegrityLimits::default(),
        max_rows: 100,
        max_snapshot_bytes: 1024 * 1024,
        max_text_bytes: 65536,
        max_location_bytes: 4096,
        max_review_items: 100,
    }
}
async fn fixture() -> (tempfile::TempDir, RegistrySession, SettingsOwner) {
    let dir = tempfile::tempdir().unwrap();
    let session = Registry::create(dir.path().join("registry.sqlite"), limits(), 16)
        .await
        .unwrap();
    let owner = SettingsOwner::start(session.handle.clone(), 2, 3)
        .await
        .unwrap();
    (dir, session, owner)
}
fn pending<F: Future>(future: Pin<&mut F>) {
    assert!(matches!(
        future.poll(&mut Context::from_waker(Waker::noop())),
        Poll::Pending
    ));
}
async fn until(mut predicate: impl FnMut() -> bool) {
    for _ in 0..10000 {
        if predicate() {
            return;
        }
        tokio::task::yield_now().await;
    }
    panic!("bounded test progress exhausted");
}
fn changed(snapshot: &SettingsSnapshot, value: u64) -> CommandResourceSettings {
    CommandResourceSettings {
        max_payload_depth: value,
        ..snapshot.saved.settings
    }
}
fn saved(outcome: SaveOutcome) -> Arc<SettingsSnapshot> {
    match outcome {
        SaveOutcome::Saved(snapshot) => snapshot,
        _ => panic!("expected saved"),
    }
}
async fn stop(session: RegistrySession, owner: SettingsOwner) {
    owner.shutdown().await;
    session.owner.shutdown().await.unwrap();
}

struct DropBomb {
    association: SettingsAssociation,
    dropped: Arc<AtomicUsize>,
}
impl DropBomb {
    fn touch(&self) {}
}
impl Drop for DropBomb {
    fn drop(&mut self) {
        // This also checks cleanup reentrancy without risking a deadlock.
        let guard = self
            .association
            .shared
            .state
            .try_lock()
            .expect("observer Drop under state lock");
        drop(guard);
        let _ = self.association.is_closed();
        self.dropped.fetch_add(1, Ordering::SeqCst);
        panic!("captured destructor panic");
    }
}

#[test]
fn command_resource_settings_final_callback_arc_drop_panic_closes_and_drains() {
    run(async {
        for invocation_panics in [false, true] {
            let (_dir, session, owner) = fixture().await;
            let association = owner.association();
            let dropped = Arc::new(AtomicUsize::new(0));
            let bomb = DropBomb {
                association: association.clone(),
                dropped: dropped.clone(),
            };
            let holder: Arc<Mutex<Option<SettingsSubscription>>> = Arc::new(Mutex::new(None));
            let callback_holder = holder.clone();
            let sub = association
                .subscribe(move |_| {
                    bomb.touch();
                    if invocation_panics {
                        panic!("callback invocation panic before captured Drop panic");
                    }
                    // Removing the map entry leaves the delivery task holding the final
                    // Observer Arc. Its captured Drop runs after invocation returns.
                    callback_holder.lock().unwrap().take();
                })
                .unwrap();
            *holder.lock().unwrap() = Some(sub);
            until(|| association.is_closed()).await;
            assert_eq!(dropped.load(Ordering::SeqCst), 1);
            let shared = owner.shared.clone();
            owner.shutdown().await;
            assert!(!shared.lock().delivery_running);
            assert!(shared.lock().subscribers.is_empty());
            holder.lock().unwrap().take();
            session.owner.shutdown().await.unwrap();
        }
    });
}

#[test]
fn command_resource_settings_observer_drop_panics_in_close_unsubscribe_and_rejection() {
    run(async {
        for cleanup in ["close", "unsubscribe", "rejection", "owner-drop"] {
            let (_dir, session, owner) = fixture().await;
            let association = owner.association();
            let dropped = Arc::new(AtomicUsize::new(0));
            let mut subscriptions = Vec::new();
            for _ in 0..3 {
                let bomb = DropBomb {
                    association: association.clone(),
                    dropped: dropped.clone(),
                };
                subscriptions.push(association.subscribe(move |_| bomb.touch()).unwrap());
            }
            // No yield: the task has not selected an observer yet. These are
            // genuinely final callback references in the caller's cleanup path.
            if cleanup == "rejection" {
                let bomb = DropBomb {
                    association: association.clone(),
                    dropped: dropped.clone(),
                };
                assert!(matches!(
                    association.subscribe(move |_| bomb.touch()),
                    Err(RegistryError::LimitExceeded(_))
                ));
                assert_eq!(dropped.load(Ordering::SeqCst), 4);
            } else if cleanup == "unsubscribe" {
                drop(subscriptions.pop());
                assert_eq!(dropped.load(Ordering::SeqCst), 3);
            } else if cleanup == "close" {
                owner.close();
                assert_eq!(dropped.load(Ordering::SeqCst), 3);
            } else {
                let shared = owner.shared.clone();
                drop(owner);
                assert!(association.is_closed());
                assert_eq!(dropped.load(Ordering::SeqCst), 3);
                shared.drain().await;
                assert!(!shared.lock().delivery_running);
                drop(subscriptions);
                session.owner.shutdown().await.unwrap();
                continue;
            }
            assert!(association.is_closed());
            assert!(owner.shared.lock().subscribers.is_empty());
            drop(subscriptions);
            stop(session, owner).await;
        }
    });
}

#[test]
fn command_resource_settings_custom_panic_payload_drop_is_isolated() {
    struct Payload(Arc<AtomicUsize>);
    impl Drop for Payload {
        fn drop(&mut self) {
            self.0.fetch_add(1, Ordering::SeqCst);
            panic!("custom panic payload destructor panic");
        }
    }

    let dropped = Arc::new(AtomicUsize::new(0));
    let payload = Payload(dropped.clone());
    let result = catch_unwind(AssertUnwindSafe(|| std::panic::panic_any(payload)));
    assert!(caught_panic(result));
    assert_eq!(dropped.load(Ordering::SeqCst), 1);
    assert!(!caught_panic(Ok(())));
}

#[test]
fn command_resource_settings_unpolled_delivery_drop_closes_and_drains() {
    run(async {
        let dir = tempfile::tempdir().unwrap();
        let session = Registry::create(dir.path().join("db"), limits(), 8)
            .await
            .unwrap();
        let saved = session
            .handle
            .read_command_resource_settings()
            .await
            .unwrap();
        // Construct the real delivery future without spawning it. No task may
        // poll it before this test drops its captured exit guard.
        let shared = Arc::new(Shared {
            registry: session.handle.clone(),
            max_operations: 1,
            max_subscribers: 1,
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
            fail_delivery_turn: std::sync::atomic::AtomicBool::new(false),
        });
        let owner = SettingsOwner {
            shared: shared.clone(),
        };
        let association = owner.association();
        let calls = Arc::new(AtomicUsize::new(0));
        let callback_calls = calls.clone();
        let _subscription = association
            .subscribe(move |_| {
                callback_calls.fetch_add(1, Ordering::SeqCst);
            })
            .unwrap();
        let delivery = Box::pin(deliver(DeliveryExit(shared.clone())));
        let mut drain = Box::pin(shared.drain());
        pending(drain.as_mut());
        assert!(!association.is_closed());
        assert!(shared.lock().delivery_running);
        drop(delivery);
        assert!(association.is_closed());
        assert!(!shared.lock().delivery_running);
        assert!(shared.lock().subscribers.is_empty());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        drain.await;
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_delivery_exit_guard_on_unexpected_unwind() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let dropped = Arc::new(AtomicUsize::new(0));
        let mut subscriptions = Vec::new();
        for _ in 0..3 {
            let bomb = DropBomb {
                association: owner.association(),
                dropped: dropped.clone(),
            };
            subscriptions.push(
                owner
                    .association()
                    .subscribe(move |_| bomb.touch())
                    .unwrap(),
            );
        }
        owner
            .shared
            .fail_delivery_turn
            .store(true, Ordering::SeqCst);
        owner.shared.delivery.notify_one();
        // The exit guard, not this test or shutdown, must first close the service
        // and announce task completion. The outer watchdog bounds this await.
        owner.shared.drain().await;
        assert!(owner.association().is_closed());
        assert!(!owner.shared.lock().delivery_running);
        assert_eq!(
            dropped.load(Ordering::SeqCst),
            3,
            "each destructor isolated during unwind"
        );
        drop(subscriptions);
        stop(session, owner).await;
    });
}

async fn abandoned_startup(completed_before_resume: bool) {
    let dir = tempfile::tempdir().unwrap();
    let session = Registry::create(dir.path().join("db"), limits(), 8)
        .await
        .unwrap();
    let references = session.handle.test_shared_references();
    let (started, receive_started) = mpsc::channel();
    let (release, receive_release) = mpsc::channel();
    let mut barrier = Box::pin(session.handle.test_submit(move |_| {
        started.send(()).unwrap();
        receive_release
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        Ok(())
    }));
    pending(barrier.as_mut());
    receive_started
        .recv_timeout(Duration::from_secs(10))
        .unwrap();
    let mut startup = Some(Box::pin(SettingsOwner::start(session.handle.clone(), 1, 1)));
    pending(startup.as_mut().unwrap().as_mut());
    assert_eq!(session.handle.test_queue_len(), 1);
    assert_eq!(session.handle.test_shared_references(), references + 1);
    let (fenced, receive_fenced) = mpsc::channel();
    let mut fence = Box::pin(session.handle.test_submit(move |_| {
        fenced.send(()).unwrap();
        Ok(())
    }));
    pending(fence.as_mut());
    if !completed_before_resume {
        drop(startup.take());
    }
    release.send(()).unwrap();
    // FIFO execution of this fence proves the native read has replied. The
    // startup future has not been resumed, even if its waker has been signaled.
    receive_fenced
        .recv_timeout(Duration::from_secs(10))
        .unwrap();
    drop(startup);
    barrier.await.unwrap();
    fence.await.unwrap();
    assert_eq!(
        session.handle.test_shared_references(),
        references,
        "abandoned startup retained a registry handle in a leaked service/task"
    );
    assert_eq!(session.handle.test_settings_reads(), 1);
    // A subsequent startup still works and drains its one delivery task.
    let owner = SettingsOwner::start(session.handle.clone(), 1, 1)
        .await
        .unwrap();
    owner.shutdown().await;
    assert_eq!(session.handle.test_shared_references(), references);
    session.owner.shutdown().await.unwrap();
}

#[test]
fn command_resource_settings_startup_abandoned_while_read_queued() {
    run(abandoned_startup(false));
}

#[test]
fn command_resource_settings_startup_abandoned_after_read_completed_before_resume() {
    run(abandoned_startup(true));
}

#[test]
fn command_resource_settings_scoped_close_allows_selected_callback_but_no_pending_or_late_publish()
{
    let (setup, receive_setup) = mpsc::channel::<Arc<Shared>>();
    let (selected, receive_selected) = mpsc::channel();
    let (closed, receive_closed) = mpsc::channel();
    std::thread::scope(|scope| {
        let closer = scope.spawn(move || {
            let shared = receive_setup.recv_timeout(Duration::from_secs(10)).unwrap();
            receive_selected
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            shared.close();
            assert!(shared.lock().closed);
            assert!(
                shared.lock().delivery_running,
                "selected callback is still executing"
            );
            assert!(shared.lock().subscribers.is_empty());
            closed.send(()).unwrap();
        });
        run(async move {
            let (_dir, session, owner) = fixture().await;
            let initial = owner.association().read().await.unwrap();
            let (worker_started, receive_worker_started) = mpsc::channel();
            let (release_worker, receive_release_worker) = mpsc::channel();
            let mut barrier = Box::pin(session.handle.test_submit(move |_| {
                worker_started.send(()).unwrap();
                receive_release_worker
                    .recv_timeout(Duration::from_secs(10))
                    .unwrap();
                Ok(())
            }));
            pending(barrier.as_mut());
            receive_worker_started
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            let (completed, receive_completed) = oneshot::channel();
            let completed = Mutex::new(Some(completed));
            let reentrant = owner.association();
            let receive_closed = Mutex::new(receive_closed);
            let _first = owner
                .association()
                .subscribe(move |_| {
                    assert!(!reentrant.is_closed());
                    selected.send(()).unwrap();
                    receive_closed
                        .lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(10))
                        .unwrap();
                    assert!(reentrant.is_closed());
                    completed.lock().unwrap().take().unwrap().send(()).unwrap();
                })
                .unwrap();
            let pending_calls = Arc::new(AtomicUsize::new(0));
            let count = pending_calls.clone();
            let _pending = owner
                .association()
                .subscribe(move |_| {
                    count.fetch_add(1, Ordering::SeqCst);
                })
                .unwrap();
            let operations = owner.operations();
            let mut write = Box::pin(operations.save(initial.saved.revision, changed(&initial, 3)));
            pending(write.as_mut());
            setup.send(owner.shared.clone()).unwrap();
            receive_completed.await.unwrap();
            assert_eq!(pending_calls.load(Ordering::SeqCst), 0);
            release_worker.send(()).unwrap();
            barrier.await.unwrap();
            assert_eq!(
                saved(write.await.unwrap()).saved.settings.max_payload_depth,
                3
            );
            assert_eq!(
                owner.shared.lock().snapshot,
                initial,
                "late save cannot publish after close"
            );
            let shared = owner.shared.clone();
            owner.shutdown().await;
            assert!(!shared.lock().delivery_running);
            assert_eq!(pending_calls.load(Ordering::SeqCst), 0);
            session.owner.shutdown().await.unwrap();
        });
        closer.join().unwrap();
    });
}

#[test]
fn command_resource_settings_initial_read_saved_values_and_no_defaults() {
    run(async {
        let dir = tempfile::tempdir().unwrap();
        let session = Registry::create(dir.path().join("db"), limits(), 8)
            .await
            .unwrap();
        let original = session
            .handle
            .read_command_resource_settings()
            .await
            .unwrap();
        let custom = CommandResourceSettings {
            max_payload_depth: 7,
            ..original.settings
        };
        session
            .handle
            .set_command_resource_settings(original.revision, custom)
            .await
            .unwrap();
        let owner = SettingsOwner::start(session.handle.clone(), 1, 1)
            .await
            .unwrap();
        assert_eq!(
            owner.association().read().await.unwrap().saved.settings,
            custom
        );
        owner.shutdown().await;
        session
            .handle
            .test_submit(|store| {
                store
                    .test_connection()
                    .execute("DELETE FROM host_settings", [])?;
                Ok(())
            })
            .await
            .unwrap();
        assert!(matches!(
            SettingsOwner::start(session.handle.clone(), 1, 1).await,
            Err(RegistryError::RecoveryRequired(_))
        ));
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn command_resource_settings_cas_noop_permission_independence_and_initial_race() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let operations = owner.operations();
        let initial = owner.association().read().await.unwrap();
        let permission = session.handle.read_settings().await.unwrap();
        let (send, mut receive) = tokio::sync::mpsc::channel(8);
        let sub = owner
            .association()
            .subscribe(move |s| {
                send.try_send(s).unwrap();
            })
            .unwrap();
        let next = saved(
            operations
                .save(initial.saved.revision, changed(&initial, 2))
                .await
                .unwrap(),
        );
        let first = receive.recv().await.unwrap();
        assert!(first.saved.revision <= next.saved.revision);
        assert!(sub.acknowledge(&first.epoch, first.saved.revision));
        if first.saved.revision < next.saved.revision {
            let delivered = receive.recv().await.unwrap();
            assert_eq!(delivered, next);
            assert!(sub.acknowledge(&delivered.epoch, delivered.saved.revision));
        }
        assert_eq!(
            saved(
                operations
                    .save(next.saved.revision, next.saved.settings)
                    .await
                    .unwrap()
            ),
            next
        );
        until(|| owner.shared.lock().operations == 0).await;
        tokio::task::yield_now().await;
        assert!(receive.try_recv().is_err());
        match operations
            .save(initial.saved.revision, initial.saved.settings)
            .await
            .unwrap()
        {
            SaveOutcome::Conflict {
                error,
                current,
                read_error,
            } => {
                assert!(matches!(error, RegistryError::Conflict(_)));
                assert_eq!(current.unwrap(), next);
                assert!(read_error.is_none());
            }
            _ => panic!("expected conflict"),
        }
        assert_eq!(session.handle.read_settings().await.unwrap(), permission);
        assert!(!owner.association().is_closed());
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_capacity_abandoned_waiter_reconciles() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        let (started, receive_started) = mpsc::channel();
        let (release, receive_release) = mpsc::channel();
        let mut barrier = Box::pin(session.handle.test_submit(move |_| {
            started.send(()).unwrap();
            receive_release
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            Ok(())
        }));
        pending(barrier.as_mut());
        receive_started
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        let operations = owner.operations();
        let mut write = Box::pin(operations.save(initial.saved.revision, changed(&initial, 3)));
        pending(write.as_mut());
        drop(write);
        let association = owner.association();
        let mut read = Box::pin(association.read());
        pending(read.as_mut());
        assert!(matches!(
            operations.read().await,
            Err(RegistryError::LimitExceeded(_))
        ));
        assert_eq!(owner.shared.lock().operations, 2);
        release.send(()).unwrap();
        barrier.await.unwrap();
        read.await.unwrap();
        until(|| owner.shared.lock().operations == 0).await;
        assert_eq!(
            owner
                .shared
                .lock()
                .snapshot
                .saved
                .settings
                .max_payload_depth,
            3
        );
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_owner_drop_drains_without_late_publication() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let association = owner.association();
        let initial = association.read().await.unwrap();
        let operations = owner.operations();
        let mut write = Box::pin(operations.save(initial.saved.revision, changed(&initial, 5)));
        pending(write.as_mut());
        let shared = owner.shared.clone();
        drop(owner);
        assert!(association.is_closed());
        assert!(matches!(
            association.read().await,
            Err(RegistryError::Unavailable(_))
        ));
        let result = saved(write.await.unwrap());
        assert_eq!(result.saved.settings.max_payload_depth, 5);
        shared.drain().await;
        assert_eq!(shared.lock().snapshot, initial);
        assert_eq!(
            session
                .handle
                .read_command_resource_settings()
                .await
                .unwrap(),
            result.saved
        );
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn command_resource_settings_shutdown_closes_then_waits_for_admitted_work() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        let operations = owner.operations();
        let mut write = Box::pin(operations.save(initial.saved.revision, changed(&initial, 6)));
        pending(write.as_mut());
        let mut shutdown = Box::pin(owner.shutdown());
        pending(shutdown.as_mut());
        assert!(matches!(
            operations.read().await,
            Err(RegistryError::Unavailable(_))
        ));
        assert!(matches!(write.await, Ok(SaveOutcome::Saved(_))));
        shutdown.await;
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn command_resource_settings_coalescing_ack_out_of_order_and_reverse_completion() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let operations = owner.operations();
        let initial = owner.association().read().await.unwrap();
        let (send, mut receive) = tokio::sync::mpsc::channel(8);
        let sub = owner
            .association()
            .subscribe(move |s| {
                send.try_send(s).unwrap();
            })
            .unwrap();
        assert_eq!(receive.recv().await.unwrap(), initial);
        let one = saved(
            operations
                .save(initial.saved.revision, changed(&initial, 1))
                .await
                .unwrap(),
        );
        let two = saved(
            operations
                .save(one.saved.revision, changed(&one, 2))
                .await
                .unwrap(),
        );
        assert!(receive.try_recv().is_err());
        assert!(!sub.acknowledge(&two.epoch, two.saved.revision));
        assert!(sub.acknowledge(&initial.epoch, initial.saved.revision));
        assert_eq!(receive.recv().await.unwrap(), two);
        assert!(!sub.acknowledge(&one.epoch, one.saved.revision));
        // Repeated older results cannot regress an already reconciled snapshot.
        owner.shared.reconcile(one);
        owner.shared.reconcile(initial);
        assert_eq!(owner.shared.lock().snapshot, two);
        assert!(sub.acknowledge(&two.epoch, two.saved.revision));
        tokio::task::yield_now().await;
        assert!(receive.try_recv().is_err());
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_reentrant_ack_panic_isolation_and_bounded_churn() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let association = owner.association();
        let _panics = association
            .subscribe(|_| panic!("isolated observer"))
            .unwrap();
        let holder: Arc<Mutex<Option<SettingsSubscription>>> = Arc::new(Mutex::new(None));
        let callback_holder = holder.clone();
        let reentrant = association.clone();
        let (send, mut receive) = tokio::sync::mpsc::channel(8);
        let sub = association
            .subscribe(move |snapshot| {
                assert!(callback_holder
                    .lock()
                    .unwrap()
                    .as_ref()
                    .unwrap()
                    .acknowledge(&snapshot.epoch, snapshot.saved.revision));
                for _ in 0..1000 {
                    let sub = reentrant
                        .subscribe(|_| panic!("canceled subscription delivered"))
                        .unwrap();
                    drop(sub);
                }
                send.try_send(snapshot).unwrap();
            })
            .unwrap();
        *holder.lock().unwrap() = Some(sub);
        receive.recv().await.unwrap();
        assert_eq!(owner.shared.lock().subscribers.len(), 1);
        let initial = association.read().await.unwrap();
        owner
            .operations()
            .save(initial.saved.revision, changed(&initial, 1))
            .await
            .unwrap();
        receive.recv().await.unwrap();
        assert_eq!(owner.shared.lock().subscribers.len(), 1);
        holder.lock().unwrap().take();
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_live_subscriber_capacity_and_unsubscribe_cleanup() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let association = owner.association();
        let mut subscriptions = Vec::new();
        for _ in 0..3 {
            subscriptions.push(association.subscribe(|_| {}).unwrap());
        }
        assert!(matches!(
            association.subscribe(|_| {}),
            Err(RegistryError::LimitExceeded(_))
        ));
        subscriptions.pop();
        subscriptions.push(association.subscribe(|_| {}).unwrap());
        drop(subscriptions);
        assert!(owner.shared.lock().subscribers.is_empty());
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_unknown_poisoned_store_closes_without_reread() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        session.handle.test_submit(|store| {
            store.test_connection().execute_batch(
                "CREATE TEMP TABLE resource_parent (id INTEGER PRIMARY KEY);
                 CREATE TEMP TABLE resource_child (parent INTEGER REFERENCES resource_parent(id) DEFERRABLE INITIALLY DEFERRED);
                 CREATE TEMP TRIGGER resource_commit_failure AFTER UPDATE OF command_resource_revision ON host_settings BEGIN INSERT INTO resource_child VALUES (1); END;"
            )?;
            Ok(())
        }).await.unwrap();
        let reads = session.handle.test_settings_reads();
        let error = owner
            .operations()
            .save(initial.saved.revision, changed(&initial, 1))
            .await
            .unwrap_err();
        assert!(matches!(error, RegistryError::OutcomeUnknown(_)));
        assert!(error
            .to_string()
            .contains("commit outcome could not be established"));
        assert!(owner.association().is_closed());
        assert!(matches!(
            owner.association().read().await,
            Err(RegistryError::Unavailable(_))
        ));
        assert_eq!(session.handle.test_settings_reads(), reads);
        // Native lifecycle is deliberately not changed by settings fail-closure.
        assert_eq!(
            session.owner.control().snapshot().phase,
            crate::plugin_registry::LifecyclePhase::Ready
        );
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_known_invalid_storage_and_revision_limit_remain_known() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        assert!(matches!(
            owner
                .operations()
                .save(initial.saved.revision, changed(&initial, 0))
                .await,
            Err(RegistryError::InvalidInput(_))
        ));
        session.handle.test_submit(|store| {
            store.test_connection().execute_batch("CREATE TEMP TRIGGER reject_resource_update AFTER UPDATE OF command_resource_revision ON host_settings BEGIN SELECT RAISE(ABORT, 'known failure'); END;")?;
            Ok(())
        }).await.unwrap();
        assert!(matches!(
            owner
                .operations()
                .save(initial.saved.revision, changed(&initial, 1))
                .await,
            Err(RegistryError::Storage(_))
        ));
        assert!(!owner.association().is_closed());
        session.handle.test_submit(|store| {
            store.test_connection().execute_batch("DROP TRIGGER reject_resource_update; UPDATE host_settings SET command_resource_revision=9223372036854775807;")?;
            Ok(())
        }).await.unwrap();
        let maximum = owner.association().read().await.unwrap();
        assert!(matches!(
            owner
                .operations()
                .save(maximum.saved.revision, changed(&maximum, 1))
                .await,
            Err(RegistryError::LimitExceeded(_))
        ));
        assert!(!owner.association().is_closed());
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_conflict_read_failure_preserves_confirmed_conflict_and_slot() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        let operations = owner.operations();
        let one = saved(
            operations
                .save(initial.saved.revision, changed(&initial, 1))
                .await
                .unwrap(),
        );
        // Block the worker, queue the real CAS, then queue deletion ahead of its
        // follow-up read. The current-thread runtime cannot reconcile until we yield.
        let (started, receive_started) = mpsc::channel();
        let (release, receive_release) = mpsc::channel();
        let mut barrier = Box::pin(session.handle.test_submit(move |_| {
            started.send(()).unwrap();
            receive_release
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            Ok(())
        }));
        pending(barrier.as_mut());
        receive_started
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        let mut conflict =
            Box::pin(operations.save(initial.saved.revision, initial.saved.settings));
        pending(conflict.as_mut());
        // Observe admission rather than assuming a particular yield schedule.
        until(|| session.handle.test_queue_len() == 1).await;
        let (deleted, receive_deleted) = mpsc::channel();
        let (release_read, receive_release_read) = mpsc::channel();
        let mut deletion = Box::pin(session.handle.test_submit(move |store| {
            store
                .test_connection()
                .execute("DELETE FROM host_settings", [])?;
            deleted.send(()).unwrap();
            receive_release_read
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            Ok(())
        }));
        pending(deletion.as_mut());
        release.send(()).unwrap();
        receive_deleted
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        until(|| session.handle.test_queue_len() == 1).await;
        assert_eq!(
            owner.shared.lock().operations,
            1,
            "conflict read retains its slot"
        );
        let mut second = Box::pin(operations.read());
        pending(second.as_mut());
        assert!(matches!(
            operations.read().await,
            Err(RegistryError::LimitExceeded(_))
        ));
        drop(second);
        release_read.send(()).unwrap();
        barrier.await.unwrap();
        deletion.await.unwrap();
        match conflict.await.unwrap() {
            SaveOutcome::Conflict {
                error,
                current,
                read_error,
            } => {
                assert!(matches!(error, RegistryError::Conflict(_)));
                assert!(current.is_none());
                assert!(matches!(
                    read_error,
                    Some(RegistryError::RecoveryRequired(_))
                ));
            }
            _ => panic!("conflict must not become unknown"),
        }
        assert!(owner.association().is_closed());
        assert_eq!(owner.shared.lock().snapshot, one);
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_read_unavailable_or_recovery_required_closes_service() {
    run(async {
        for unavailable in [false, true] {
            let (_dir, session, owner) = fixture().await;
            if unavailable {
                session.owner.shutdown().await.unwrap();
                assert!(matches!(
                    owner.association().read().await,
                    Err(RegistryError::Unavailable(_))
                ));
                assert!(owner.association().is_closed());
                owner.shutdown().await;
            } else {
                session
                    .handle
                    .test_submit(|store| {
                        store
                            .test_connection()
                            .execute("DELETE FROM host_settings", [])?;
                        Ok(())
                    })
                    .await
                    .unwrap();
                assert!(matches!(
                    owner.association().read().await,
                    Err(RegistryError::RecoveryRequired(_))
                ));
                assert!(owner.association().is_closed());
                stop(session, owner).await;
            }
        }
    });
}

#[test]
fn command_resource_settings_native_results_reconciled_in_reverse_order() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        let (send, mut receive) = tokio::sync::mpsc::channel(8);
        let sub = owner
            .association()
            .subscribe(move |s| {
                send.try_send(s).unwrap();
            })
            .unwrap();
        assert_eq!(receive.recv().await.unwrap(), initial);
        assert!(sub.acknowledge(&initial.epoch, initial.saved.revision));
        // Capture actual committed native results without their normal reconciliation.
        // This is the test-only completion-order seam, not a fake settings source.
        let one = session
            .handle
            .set_command_resource_settings(initial.saved.revision, changed(&initial, 1))
            .await
            .unwrap();
        let two = session
            .handle
            .set_command_resource_settings(
                one.revision,
                CommandResourceSettings {
                    max_payload_depth: 2,
                    ..one.settings
                },
            )
            .await
            .unwrap();
        assert_eq!(owner.shared.lock().snapshot, initial);
        let two = owner.shared.snapshot(two);
        owner.shared.reconcile(two.clone());
        owner.shared.reconcile(owner.shared.snapshot(one));
        assert_eq!(owner.shared.lock().snapshot, two);
        assert_eq!(receive.recv().await.unwrap(), two);
        let foreign_epoch = SettingsEpoch(Arc::new(()));
        assert!(!sub.acknowledge(&foreign_epoch, two.saved.revision));
        assert!(sub.acknowledge(&two.epoch, two.saved.revision));
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_equal_revision_inconsistency_fails_closed() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        let inconsistent = owner.shared.snapshot(CommandResourceSettingsSnapshot {
            revision: initial.saved.revision,
            settings: changed(&initial, 1),
        });
        owner.shared.reconcile(inconsistent);
        assert!(owner.association().is_closed());
        assert_eq!(owner.shared.lock().snapshot, initial);
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_replacement_lower_revision_fresh_epoch_and_stale_handles() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let old = owner.association();
        let operations = owner.operations();
        let initial = old.read().await.unwrap();
        let previous = saved(
            operations
                .save(initial.saved.revision, changed(&initial, 1))
                .await
                .unwrap(),
        );
        owner.close();
        owner.shutdown().await;
        session.owner.shutdown().await.unwrap();
        let (_replacement_dir, replacement, replacement_owner) = fixture().await;
        let current = replacement_owner.association().read().await.unwrap();
        assert!(current.saved.revision < previous.saved.revision);
        assert_ne!(current.epoch, previous.epoch);
        assert!(old.is_closed());
        assert!(matches!(
            old.read().await,
            Err(RegistryError::Unavailable(_))
        ));
        assert!(matches!(
            operations
                .save(previous.saved.revision, previous.saved.settings)
                .await,
            Err(RegistryError::Unavailable(_))
        ));
        assert!(matches!(
            session.handle.read_command_resource_settings().await,
            Err(RegistryError::Unavailable(_))
        ));
        stop(replacement, replacement_owner).await;
    });
}
