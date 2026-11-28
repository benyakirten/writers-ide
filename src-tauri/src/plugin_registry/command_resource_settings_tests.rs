use super::*;
use crate::{
    plugin_integrity::IntegrityLimits,
    plugin_registry::{Registry, RegistryCapacity, RegistryLimits, RegistrySession},
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
    let session = Registry::create(
        dir.path().join("registry.sqlite"),
        limits(),
        RegistryCapacity::with_observers(16, 4, 4).unwrap(),
    )
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

#[test]
fn closed_wakes_every_registered_waiter_and_the_validity_watcher() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let association = owner.association();
        // Let the validity watcher register before transport waiters do.
        tokio::task::yield_now().await;
        let mut waiters: Vec<_> = (0..64).map(|_| Box::pin(association.closed())).collect();
        for waiter in &mut waiters {
            pending(waiter.as_mut());
        }
        owner.close();
        for waiter in waiters {
            waiter.await;
        }
        owner.shutdown().await;
        assert!(session.handle.is_service_valid());
        association.closed().await;
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn closed_waiter_registration_races_do_not_miss_closure() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let association = owner.association();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let closer = owner.shared.clone();
        let other = barrier.clone();
        let thread = std::thread::spawn(move || {
            other.wait();
            closer.close();
        });
        barrier.wait();
        let mut tasks = Vec::new();
        for _ in 0..64 {
            let association = association.clone();
            tasks.push(tokio::spawn(async move {
                association.closed().await;
            }));
        }
        for task in tasks {
            task.await.unwrap();
        }
        thread.join().unwrap();
        stop(session, owner).await;
    });
}

#[test]
fn closed_is_exact_to_settings_lifetime_even_with_healthy_registry_and_replacement() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let old = owner.association();
        drop(owner);
        old.closed().await;
        let replacement = SettingsOwner::start(session.handle.clone(), 2, 3)
            .await
            .unwrap();
        let current = replacement.association();
        old.closed().await;
        let mut waiting = Box::pin(current.closed());
        pending(waiting.as_mut());
        replacement.shutdown().await;
        waiting.await;
        assert!(session.handle.is_service_valid());
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn closed_resolves_on_registry_shutdown_without_a_settings_operation() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let association = owner.association();
        let mut waiting = Box::pin(association.closed());
        pending(waiting.as_mut());
        session.owner.shutdown().await.unwrap();
        waiting.await;
        owner.shutdown().await;
    });
}

#[test]
fn closed_survives_settings_runtime_teardown() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let (_dir, session, owner) = runtime.block_on(fixture());
    let association = owner.association();
    let mut waiting = Box::pin(association.closed());
    pending(waiting.as_mut());
    drop(runtime);
    tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap()
        .block_on(async {
            waiting.await;
            owner.shutdown().await;
            assert!(session.handle.is_service_valid());
            session.owner.shutdown().await.unwrap();
        });
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
        let session = Registry::create(
            dir.path().join("db"),
            limits(),
            RegistryCapacity::with_observers(8, 4, 4).unwrap(),
        )
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
                watcher_running: false,
                next_subscription: 0,
                subscribers: BTreeMap::new(),
            }),
            delivery: Notify::new(),
            closed: Notify::new(),
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
    let session = Registry::create(
        dir.path().join("db"),
        limits(),
        RegistryCapacity::with_observers(8, 4, 4).unwrap(),
    )
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
        let session = Registry::create(
            dir.path().join("db"),
            limits(),
            RegistryCapacity::with_observers(8, 4, 4).unwrap(),
        )
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
        // Transaction uncertainty invalidates the native service before its reply.
        assert_eq!(
            session.owner.control().snapshot().phase,
            crate::plugin_registry::LifecyclePhase::RecoveryOnly(
                crate::plugin_registry::RecoveryKind::TransactionUncertain
            )
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

fn unrelated_failure(store: &mut crate::plugin_registry::store::Store, mode: usize) -> Result<()> {
    if mode == 2 {
        panic!("unrelated worker panic");
    }
    if mode == 1 {
        store
            .test_connection()
            .execute("DELETE FROM host_settings", [])?;
        store.read_command_resource_settings()?;
    } else {
        let initial = store.read_command_resource_settings()?;
        store.test_connection().execute_batch(
            "CREATE TEMP TABLE validity_parent (id INTEGER PRIMARY KEY);
             CREATE TEMP TABLE validity_child (parent INTEGER REFERENCES validity_parent(id) DEFERRABLE INITIALLY DEFERRED);
             CREATE TEMP TRIGGER validity_commit_failure AFTER UPDATE OF command_resource_revision ON host_settings
             BEGIN INSERT INTO validity_child VALUES (1); END;",
        )?;
        store.set_command_resource_settings(
            initial.revision,
            CommandResourceSettings {
                max_payload_depth: initial.settings.max_payload_depth + 1,
                ..initial.settings
            },
        )?;
    }
    Ok(())
}

// Do not poll the Tokio runtime: prove the gate works before its watcher runs.
fn wait_invalid(handle: &RegistryHandle) {
    let deadline = std::time::Instant::now() + Duration::from_secs(10);
    while handle.is_service_valid() {
        assert!(
            std::time::Instant::now() < deadline,
            "invalidation watchdog"
        );
        std::thread::yield_now();
    }
}

#[test]
fn command_resource_settings_unrelated_failure_idle_watcher_and_atomic_gates() {
    run(async {
        for mode in 0..3 {
            let (_dir, session, owner) = fixture().await;
            let initial = owner.association().read().await.unwrap();
            let calls = Arc::new(AtomicUsize::new(0));
            let called = calls.clone();
            let sub = owner
                .association()
                .subscribe(move |_| {
                    called.fetch_add(1, Ordering::SeqCst);
                })
                .unwrap();
            until(|| calls.load(Ordering::SeqCst) == 1).await;
            assert!(sub.acknowledge(&initial.epoch, initial.saved.revision));
            let updated = session
                .handle
                .set_command_resource_settings(initial.saved.revision, changed(&initial, 1))
                .await
                .unwrap();
            owner.shared.reconcile(owner.shared.snapshot(updated));
            let mut failure = Box::pin(
                session
                    .handle
                    .test_submit(move |store| unrelated_failure(store, mode)),
            );
            pending(failure.as_mut());
            wait_invalid(&session.handle);
            assert!(!owner.shared.lock().closed, "watcher has not run");
            assert!(owner.association().is_closed());
            assert!(matches!(
                owner.shared.reserve(),
                Err(RegistryError::Unavailable(_))
            ));
            assert!(matches!(
                owner.association().subscribe(|_| {}),
                Err(RegistryError::Unavailable(_))
            ));
            owner
                .shared
                .reconcile(owner.shared.snapshot(CommandResourceSettingsSnapshot {
                    revision: initial.saved.revision,
                    settings: initial.saved.settings,
                }));
            assert!(!owner.shared.lock().closed);
            let _ = failure.await;
            until(|| {
                let state = owner.shared.lock();
                state.closed && !state.watcher_running
            })
            .await;
            assert!(owner.shared.lock().subscribers.is_empty());
            assert_eq!(
                calls.load(Ordering::SeqCst),
                1,
                "pending snapshot was discarded"
            );
            owner.shutdown().await;
            let _ = session.owner.shutdown().await;
        }
    });
}

#[test]
fn command_resource_settings_observer_capacity_and_shutdown_release() {
    run(async {
        let dir = tempfile::tempdir().unwrap();
        let session = Registry::create(
            dir.path().join("db"),
            limits(),
            RegistryCapacity::with_observers(8, 1, 1).unwrap(),
        )
        .await
        .unwrap();
        let reader = session.handle.observe_validity().unwrap();
        let reads = session.handle.test_settings_reads();
        assert!(matches!(
            SettingsOwner::start(session.handle.clone(), 1, 1).await,
            Err(RegistryError::LimitExceeded(_))
        ));
        assert_eq!(session.handle.test_settings_reads(), reads);
        drop(reader);
        let owner = SettingsOwner::start(session.handle.clone(), 1, 1)
            .await
            .unwrap();
        assert!(matches!(
            session.handle.observe_validity(),
            Err(RegistryError::LimitExceeded(_))
        ));
        owner.shutdown().await;
        assert!(session.handle.is_service_valid());
        let reader = session.handle.observe_validity().unwrap();
        assert!(reader.is_valid());
        drop(reader);
        let owner = SettingsOwner::start(session.handle.clone(), 1, 1)
            .await
            .unwrap();
        let shared = owner.shared.clone();
        drop(owner);
        shared.drain().await;
        assert!(session.handle.observe_validity().is_ok());
        session.owner.shutdown().await.unwrap();
        assert!(matches!(
            SettingsOwner::start(session.handle.clone(), 1, 1).await,
            Err(RegistryError::Unavailable(_))
        ));
    });
}

#[test]
fn command_resource_settings_startup_read_completed_then_invalidated() {
    run(async {
        let dir = tempfile::tempdir().unwrap();
        let session = Registry::create(
            dir.path().join("db"),
            limits(),
            RegistryCapacity::with_observers(8, 1, 1).unwrap(),
        )
        .await
        .unwrap();
        let (entered, entering) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let mut barrier = Box::pin(session.handle.test_submit(move |_| {
            entered.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(10)).unwrap();
            Ok(())
        }));
        pending(barrier.as_mut());
        entering.recv_timeout(Duration::from_secs(10)).unwrap();
        let mut startup = Box::pin(SettingsOwner::start(session.handle.clone(), 1, 1));
        pending(startup.as_mut());
        let mut failure = Box::pin(
            session
                .handle
                .test_submit(|store| unrelated_failure(store, 0)),
        );
        pending(failure.as_mut());
        release.send(()).unwrap();
        wait_invalid(&session.handle);
        assert!(matches!(startup.await, Err(RegistryError::Unavailable(_))));
        barrier.await.unwrap();
        assert!(matches!(
            failure.await,
            Err(RegistryError::OutcomeUnknown(_))
        ));
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn command_resource_settings_completed_native_results_after_invalidation() {
    run(async {
        // Native read/save/conflict finishes before unrelated invalidation. Its
        // settings task cannot select the response until this thread yields.
        for operation in 0..3 {
            let (_dir, session, owner) = fixture().await;
            let initial = owner.association().read().await.unwrap();
            let expected = if operation == 2 {
                session
                    .handle
                    .set_command_resource_settings(initial.saved.revision, changed(&initial, 1))
                    .await
                    .unwrap()
                    .revision
            } else {
                initial.saved.revision
            };
            let reads = session.handle.test_settings_reads();
            let (entered, entering) = mpsc::channel();
            let (release, released) = mpsc::channel();
            let mut barrier = Box::pin(session.handle.test_submit(move |_| {
                entered.send(()).unwrap();
                released.recv_timeout(Duration::from_secs(10)).unwrap();
                Ok(())
            }));
            pending(barrier.as_mut());
            entering.recv_timeout(Duration::from_secs(10)).unwrap();
            let operations = owner.operations();
            let mut read = Box::pin(operations.read());
            let mut save = Box::pin(operations.save(initial.saved.revision, changed(&initial, 2)));
            if operation == 0 {
                pending(read.as_mut());
            } else {
                pending(save.as_mut());
            }
            until(|| session.handle.test_queue_len() == 1).await;
            let mut failure = Box::pin(
                session
                    .handle
                    .test_submit(|store| unrelated_failure(store, 0)),
            );
            pending(failure.as_mut());
            release.send(()).unwrap();
            wait_invalid(&session.handle);
            if operation == 0 {
                assert!(matches!(read.await, Err(RegistryError::Unavailable(_))));
                assert_eq!(session.handle.test_settings_reads(), reads + 1);
            } else if operation == 1 {
                let snapshot = saved(save.await.unwrap());
                assert!(snapshot.saved.revision > expected);
                assert_eq!(snapshot.saved.settings.max_payload_depth, 2);
            } else {
                match save.await.unwrap() {
                    SaveOutcome::Conflict {
                        error,
                        current,
                        read_error,
                    } => {
                        assert!(matches!(error, RegistryError::Conflict(_)));
                        assert!(current.is_none());
                        assert!(matches!(read_error, Some(RegistryError::Unavailable(_))));
                    }
                    _ => panic!("confirmed conflict lost"),
                }
                assert_eq!(
                    session.handle.test_settings_reads(),
                    reads,
                    "no conflict follow-up or retry"
                );
            }
            assert_eq!(
                owner.shared.lock().snapshot,
                initial,
                "no late reconciliation"
            );
            barrier.await.unwrap();
            assert!(matches!(
                failure.await,
                Err(RegistryError::OutcomeUnknown(_))
            ));
            stop(session, owner).await;
        }
    });
}

#[test]
fn command_resource_settings_conflict_followup_completed_before_invalidation_withheld() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        session
            .handle
            .set_command_resource_settings(initial.saved.revision, changed(&initial, 1))
            .await
            .unwrap();
        let reads = session.handle.test_settings_reads();
        let (entered, entering) = mpsc::channel();
        let (release, released) = mpsc::channel();
        let mut first = Box::pin(session.handle.test_submit(move |_| {
            entered.send(()).unwrap();
            released.recv_timeout(Duration::from_secs(10)).unwrap();
            Ok(())
        }));
        pending(first.as_mut());
        entering.recv_timeout(Duration::from_secs(10)).unwrap();
        let operations = owner.operations();
        let mut conflict = Box::pin(operations.save(initial.saved.revision, changed(&initial, 2)));
        pending(conflict.as_mut());
        until(|| session.handle.test_queue_len() == 1).await;
        let (entered_second, entering_second) = mpsc::channel();
        let (release_second, released_second) = mpsc::channel();
        let mut second = Box::pin(session.handle.test_submit(move |_| {
            entered_second.send(()).unwrap();
            released_second
                .recv_timeout(Duration::from_secs(10))
                .unwrap();
            Ok(())
        }));
        pending(second.as_mut());
        release.send(()).unwrap();
        entering_second
            .recv_timeout(Duration::from_secs(10))
            .unwrap();
        until(|| session.handle.test_queue_len() == 1).await;
        let mut failure = Box::pin(
            session
                .handle
                .test_submit(|store| unrelated_failure(store, 0)),
        );
        pending(failure.as_mut());
        release_second.send(()).unwrap();
        wait_invalid(&session.handle);
        match conflict.await.unwrap() {
            SaveOutcome::Conflict {
                error,
                current,
                read_error,
            } => {
                assert!(matches!(error, RegistryError::Conflict(_)));
                assert!(current.is_none());
                assert!(matches!(read_error, Some(RegistryError::Unavailable(_))));
            }
            _ => panic!("conflict must remain confirmed"),
        }
        assert_eq!(session.handle.test_settings_reads(), reads + 1);
        assert_eq!(owner.shared.lock().snapshot, initial);
        first.await.unwrap();
        second.await.unwrap();
        assert!(matches!(
            failure.await,
            Err(RegistryError::OutcomeUnknown(_))
        ));
        stop(session, owner).await;
    });
}

#[test]
fn command_resource_settings_validity_exit_unpolled_cancel_and_panic_release_slot() {
    run(async {
        let dir = tempfile::tempdir().unwrap();
        let session = Registry::create(
            dir.path().join("db"),
            limits(),
            RegistryCapacity::with_observers(8, 1, 1).unwrap(),
        )
        .await
        .unwrap();
        let saved = session
            .handle
            .read_command_resource_settings()
            .await
            .unwrap();
        for mode in 0..3 {
            // Isolate the watcher from delivery so its own exit guard must close
            // the association and certify completion. The reader is real/charged.
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
                    delivery_running: false,
                    watcher_running: true,
                    next_subscription: 0,
                    subscribers: BTreeMap::new(),
                }),
                delivery: Notify::new(),
                closed: Notify::new(),
                drained: Notify::new(),
                fail_delivery_turn: std::sync::atomic::AtomicBool::new(false),
            });
            let exit = ValidityExit {
                shared: shared.clone(),
                observer: Some(session.handle.observe_validity().unwrap()),
            };
            assert!(matches!(
                session.handle.observe_validity(),
                Err(RegistryError::LimitExceeded(_))
            ));
            let mut drain = Box::pin(shared.drain());
            pending(drain.as_mut());
            if mode == 0 {
                drop(Box::pin(watch_validity(exit)));
            } else if mode == 1 {
                let (entered, entering) = oneshot::channel();
                let task = tokio::spawn(async move {
                    let watcher = watch_validity(exit);
                    tokio::pin!(watcher);
                    std::future::poll_fn(|cx| {
                        assert!(watcher.as_mut().poll(cx).is_pending());
                        Poll::Ready(())
                    })
                    .await;
                    entered.send(()).unwrap();
                    watcher.await;
                });
                entering.await.unwrap();
                task.abort();
                assert!(task.await.unwrap_err().is_cancelled());
            } else {
                let task = tokio::spawn(async move {
                    let _exit = exit;
                    panic!("unexpected validity task panic");
                });
                assert!(task.await.unwrap_err().is_panic());
            }
            drain.await;
            assert!(shared.lock().closed);
            assert!(!shared.lock().watcher_running);
            assert!(session.handle.is_service_valid());
            assert!(session.handle.observe_validity().unwrap().is_valid());
        }
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn command_resource_settings_invalidation_during_selected_callback_allows_finish_only() {
    run(async {
        let (_dir, session, owner) = fixture().await;
        let initial = owner.association().read().await.unwrap();
        let historical = owner.shared.select_read(initial.clone()).unwrap();
        let (selected, selection) = mpsc::channel();
        let mut failure = Box::pin(session.handle.test_submit(move |store| {
            selection.recv_timeout(Duration::from_secs(10)).unwrap();
            unrelated_failure(store, 0)
        }));
        pending(failure.as_mut());
        let handle = session.handle.clone();
        let association = owner.association();
        let calls = Arc::new(AtomicUsize::new(0));
        let first_calls = calls.clone();
        let _first = owner
            .association()
            .subscribe(move |_| {
                assert!(!association.is_closed());
                selected.send(()).unwrap();
                wait_invalid(&handle);
                assert!(association.is_closed());
                assert!(matches!(
                    association.subscribe(|_| {}),
                    Err(RegistryError::Unavailable(_))
                ));
                first_calls.fetch_add(1, Ordering::SeqCst);
            })
            .unwrap();
        let second_calls = calls.clone();
        let _second = owner
            .association()
            .subscribe(move |_| {
                second_calls.fetch_add(100, Ordering::SeqCst);
            })
            .unwrap();
        assert!(matches!(
            failure.await,
            Err(RegistryError::OutcomeUnknown(_))
        ));
        owner.shutdown().await;
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            historical, initial,
            "a response selected before invalidation remains historical"
        );
        session.owner.shutdown().await.unwrap();
    });
}

#[test]
fn command_resource_settings_same_registry_coalesced_replacement_keeps_old_service_closed() {
    run(async {
        use crate::plugin_registry::LifecyclePhase;

        for late_save in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let restored_path = dir.path().join("restored.sqlite");
            let restored = Registry::create(
                restored_path.clone(),
                limits(),
                RegistryCapacity::with_observers(8, 1, 1).unwrap(),
            )
            .await
            .unwrap();
            let restored_settings = restored
                .handle
                .read_command_resource_settings()
                .await
                .unwrap();
            restored.owner.shutdown().await.unwrap();
            let session = Registry::create(
                dir.path().join("registry.sqlite"),
                limits(),
                RegistryCapacity::with_observers(8, 1, 1).unwrap(),
            )
            .await
            .unwrap();
            let owner = SettingsOwner::start(session.handle.clone(), 1, 2)
                .await
                .unwrap();
            let old = owner.association();
            let operations = owner.operations();
            let initial = old.read().await.unwrap();
            let previous = saved(
                operations
                    .save(initial.saved.revision, changed(&initial, 1))
                    .await
                    .unwrap(),
            );
            assert!(previous.saved.revision > restored_settings.revision);
            let calls = Arc::new(AtomicUsize::new(0));
            let called = calls.clone();
            let subscription = old
                .subscribe(move |_| {
                    called.fetch_add(1, Ordering::SeqCst);
                })
                .unwrap();
            until(|| calls.load(Ordering::SeqCst) == 1).await;
            assert!(subscription.acknowledge(&previous.epoch, previous.saved.revision));

            let control = session.owner.control();
            let lifecycle = control.observe().unwrap();
            let before = lifecycle.current();
            assert_eq!(before.phase, LifecyclePhase::Ready);
            let (entered, entering) = mpsc::channel();
            let (release, released) = mpsc::channel();
            let mut barrier = Box::pin(session.handle.test_submit(move |_| {
                entered.send(()).unwrap();
                released.recv_timeout(Duration::from_secs(10)).unwrap();
                Ok(())
            }));
            pending(barrier.as_mut());
            entering.recv_timeout(Duration::from_secs(10)).unwrap();
            let mut save =
                Box::pin(operations.save(previous.saved.revision, changed(&previous, 2)));
            if late_save {
                pending(save.as_mut());
                until(|| session.handle.test_queue_len() == 1).await;
            }
            let mut replacement = Box::pin(control.test_replace_service(
                before.revision.clone(),
                restored_path,
                limits(),
            ));
            pending(replacement.as_mut());
            assert_eq!(control.snapshot().phase, LifecyclePhase::Maintenance);
            assert!(!session.handle.is_service_valid());
            release.send(()).unwrap();

            // Keep Tokio, its validity watcher and the old save completion
            // unpolled until the SQLite worker has established replacement readiness.
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            while control.snapshot().phase != LifecyclePhase::Ready {
                assert!(std::time::Instant::now() < deadline, "replacement watchdog");
                std::thread::yield_now();
            }
            let after = lifecycle.current();
            assert_eq!(
                after.phase,
                LifecyclePhase::Ready,
                "latest-state observation coalesced maintenance"
            );
            assert_ne!(after.revision, before.revision);
            assert!(
                !owner.shared.lock().closed,
                "settings watcher has not resumed"
            );
            assert!(
                old.is_closed(),
                "replacement readiness cannot revive the old latch"
            );
            assert!(matches!(
                owner.shared.reserve(),
                Err(RegistryError::Unavailable(_))
            ));
            assert!(matches!(
                old.subscribe(|_| {}),
                Err(RegistryError::Unavailable(_))
            ));
            assert!(matches!(
                session.handle.observe_validity(),
                Err(RegistryError::Unavailable(_))
            ));
            let fresh = control.ready_handle(&after.revision).unwrap();
            assert!(fresh.is_service_valid());
            assert!(
                matches!(
                    fresh.observe_validity(),
                    Err(RegistryError::LimitExceeded(_))
                ),
                "old watcher still owns the only reader slot"
            );
            replacement.await.unwrap();
            barrier.await.unwrap();
            let confirmed = if late_save {
                let result = saved(save.await.unwrap());
                assert_eq!(result.epoch, previous.epoch);
                assert!(result.saved.revision > previous.saved.revision);
                assert_eq!(result.saved.settings.max_payload_depth, 2);
                Some(result)
            } else {
                drop(save);
                None
            };
            until(|| {
                let state = owner.shared.lock();
                state.closed && !state.watcher_running
            })
            .await;
            assert!(owner.shared.lock().subscribers.is_empty());
            assert_eq!(
                owner.shared.lock().snapshot,
                previous,
                "old completion cannot reconcile after replacement"
            );
            assert_eq!(
                calls.load(Ordering::SeqCst),
                1,
                "no late old-service publication"
            );

            // A single reader slot proves the old watcher released its charge
            // even though the old settings owner and handles are still retained.
            let fresh_owner = SettingsOwner::start(fresh.clone(), 1, 1).await.unwrap();
            let current = fresh_owner.association().read().await.unwrap();
            assert_eq!(current.saved, restored_settings);
            assert!(current.saved.revision < previous.saved.revision);
            assert_ne!(current.epoch, previous.epoch);
            if let Some(confirmed) = confirmed {
                assert_ne!(confirmed.epoch, current.epoch);
                owner.shared.reconcile(confirmed);
            }
            assert_eq!(owner.shared.lock().snapshot, previous);
            assert_eq!(fresh_owner.shared.lock().snapshot, current);
            assert!(matches!(
                old.read().await,
                Err(RegistryError::Unavailable(_))
            ));
            assert!(matches!(
                operations
                    .save(previous.saved.revision, changed(&previous, 3))
                    .await,
                Err(RegistryError::Unavailable(_))
            ));
            assert_eq!(
                fresh.read_command_resource_settings().await.unwrap(),
                restored_settings,
                "old writes were not replayed into the replacement"
            );
            owner.shutdown().await;
            assert!(fresh.is_service_valid());
            assert!(
                matches!(
                    fresh.observe_validity(),
                    Err(RegistryError::LimitExceeded(_))
                ),
                "fresh service owns the only slot"
            );
            fresh_owner.shutdown().await;
            assert!(
                fresh.observe_validity().unwrap().is_valid(),
                "fresh shutdown released its slot"
            );
            session.owner.shutdown().await.unwrap();
        }
    });
}
