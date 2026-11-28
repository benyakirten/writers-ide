use super::*;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Barrier,
};

fn connected() -> (Arc<ShutdownController>, SessionRequest, Instant) {
    let controller = Arc::new(ShutdownController::new());
    let now = Instant::now();
    controller.begin_at(now);
    let session = controller.register_document().unwrap();
    let reply = controller
        .connect(&session, ConnectRequest { version: 1 }, Arc::new(|_| true))
        .unwrap();
    (
        controller,
        SessionRequest {
            version: 1,
            session,
            attempt: reply.attempt,
        },
        now,
    )
}
fn confirmation(request: &SessionRequest, token: String) -> ConfirmRequest {
    ConfirmRequest {
        version: request.version,
        session: request.session.clone(),
        attempt: request.attempt.clone(),
        confirmation: token,
    }
}
#[test]
fn strict_dtos_reject_oversize_unknown_duplicate_arrays_and_wrong_versions() {
    assert!(wire::parse::<ConnectRequest>(&" ".repeat(4097)).is_err());
    for raw in [
        r#"[1]"#,
        r#"{"version":1,"role":"shutdown"}"#,
        r#"{"version":1,"version":1}"#,
        r#"{"version":"1"}"#,
    ] {
        assert!(wire::parse::<ConnectRequest>(raw).is_err());
    }
    assert!(wire::parse::<SessionRequest>(
        r#"{"version":1,"session":"s","attempt":"a","confirmation":"t"}"#
    )
    .is_err());
    assert!(wire::parse::<ConfirmRequest>(
        r#"{"version":1,"session":"s","attempt":"a","confirmation":"t","extra":true}"#
    )
    .is_err());
    let (c, r, now) = connected();
    let mut wrong = r.clone();
    wrong.version = 2;
    assert!(c
        .prepare_at(&r.session, &wrong, now + DISPLAY_DELAY)
        .is_err());
    c.revoke_document(&r.session);
    let session = c.register_document().unwrap();
    let dto = wire::parse::<ConnectRequest>(r#"{"version":2}"#).unwrap();
    assert!(c.connect(&session, dto, Arc::new(|_| true)).is_err());
}
#[test]
fn exact_threshold_sticky_begin_and_no_automatic_force() {
    let (c, r, now) = connected();
    c.begin_at(now + Duration::from_secs(100));
    assert!(!c.due_at(now + DISPLAY_DELAY - Duration::from_nanos(1)));
    assert!(c
        .prepare_at(
            &r.session,
            &r,
            now + DISPLAY_DELAY - Duration::from_nanos(1)
        )
        .is_err());
    assert!(c.due_at(now + DISPLAY_DELAY));
    assert!(c.prepare_at(&r.session, &r, now + DISPLAY_DELAY).is_ok());
    assert!(c.due_at(now + Duration::from_secs(1000)));
    assert!(!c.is_forced());
    assert!(c.complete());
    assert!(!c.due_at(now + Duration::from_secs(1000)));
}
#[test]
fn failed_cleanup_is_immediately_eligible_and_preserves_original_failure() {
    let (c, r, now) = connected();
    c.fail("original failure");
    c.progress("registry", "Still waiting for registry cleanup");
    c.fail("later failure");
    assert!(c.due_at(now));
    assert_eq!(c.snapshot().failure.as_deref(), Some("original failure"));
    assert_eq!(c.snapshot().phase, Phase::Failed);
    assert!(c.prepare_at(&r.session, &r, now).is_ok());
    assert!(c.complete());
    assert_eq!(c.snapshot().failure.as_deref(), Some("original failure"));
    assert!(!c.snapshot().force_eligible);
}
#[test]
fn replacement_cancellation_exact_expiry_and_single_use() {
    let (c, r, now) = connected();
    let now = now + DISPLAY_DELAY;
    let first = c.prepare_at(&r.session, &r, now).unwrap();
    assert_eq!(first.expires_in_ms, 30_000);
    let second = c.prepare_at(&r.session, &r, now).unwrap();
    assert_ne!(first.confirmation, second.confirmation);
    assert!(c
        .confirm_at(&r.session, &confirmation(&r, first.confirmation), now)
        .is_err());
    c.cancel(&r.session, &r).unwrap();
    assert!(c
        .confirm_at(&r.session, &confirmation(&r, second.confirmation), now)
        .is_err());
    let expired = c.prepare_at(&r.session, &r, now).unwrap();
    let expired = confirmation(&r, expired.confirmation);
    assert!(c
        .confirm_at(&r.session, &expired, now + CONFIRMATION_LIFETIME)
        .is_err());
    assert!(c
        .confirm_at(
            &r.session,
            &expired,
            now + CONFIRMATION_LIFETIME + Duration::from_nanos(1)
        )
        .is_err());
    let fresh = c.prepare_at(&r.session, &r, now).unwrap();
    let fresh = confirmation(&r, fresh.confirmation);
    let evidence = c
        .confirm_at(
            &r.session,
            &fresh,
            now + CONFIRMATION_LIFETIME - Duration::from_nanos(1),
        )
        .unwrap();
    assert!(!evidence.ok);
    assert!(!evidence.cleanup_complete);
    assert_eq!(evidence.snapshot.phase, Phase::Forced);
    assert!(!evidence.snapshot.force_eligible);
    assert!(c.confirm_at(&r.session, &fresh, now).is_err());
    assert!(c.prepare_at(&r.session, &r, now).is_err());
    assert!(!c.complete());
    c.progress("ignored", "ignored");
    c.fail("ignored");
    assert_eq!(c.snapshot().phase, Phase::Forced);
}
#[test]
fn foreign_caller_attempt_session_and_recreated_lifetime_are_denied() {
    let (c, r, now) = connected();
    let now = now + DISPLAY_DELAY;
    let token = c.prepare_at(&r.session, &r, now).unwrap().confirmation;
    assert!(c.prepare_at("manager", &r, now).is_err());
    assert!(c.cancel("manager", &r).is_err());
    assert!(c
        .confirm_at("manager", &confirmation(&r, token.clone()), now)
        .is_err());
    for field in ["session", "attempt"] {
        let mut wrong = r.clone();
        if field == "session" {
            wrong.session = "foreign".into();
        } else {
            wrong.attempt = "foreign".into();
        }
        assert!(c.prepare_at(&r.session, &wrong, now).is_err());
        assert!(c.cancel(&r.session, &wrong).is_err());
        assert!(c
            .confirm_at(&r.session, &confirmation(&wrong, token.clone()), now)
            .is_err());
    }
    c.revoke_document(&r.session);
    let fresh = c.register_document().unwrap();
    c.connect(&fresh, ConnectRequest { version: 1 }, Arc::new(|_| true))
        .unwrap();
    assert!(c.prepare_at(&fresh, &r, now).is_err());
    assert!(c.confirm_at(&fresh, &confirmation(&r, token), now).is_err());
    let other = ShutdownController::new();
    assert_ne!(other.snapshot().attempt, r.attempt);
}
#[test]
fn completion_invalidates_confirmation_and_all_later_progress() {
    let (c, r, now) = connected();
    let now = now + DISPLAY_DELAY;
    let token = c.prepare_at(&r.session, &r, now).unwrap().confirmation;
    assert!(c.complete());
    assert!(c
        .confirm_at(&r.session, &confirmation(&r, token), now)
        .is_err());
    c.fail("too late");
    c.progress("too late", "too late");
    c.begin();
    assert_eq!(c.snapshot().phase, Phase::Complete);
}
#[test]
fn completion_and_force_have_exactly_one_winner_under_contention() {
    for _ in 0..100 {
        let (c, r, now) = connected();
        let now = now + DISPLAY_DELAY;
        let token = c.prepare_at(&r.session, &r, now).unwrap().confirmation;
        let barrier = Arc::new(Barrier::new(3));
        let complete = {
            let c = c.clone();
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                c.complete()
            })
        };
        let force = {
            let c = c.clone();
            let b = barrier.clone();
            std::thread::spawn(move || {
                b.wait();
                c.confirm_at(&r.session, &confirmation(&r, token), now)
                    .is_ok()
            })
        };
        barrier.wait();
        assert_ne!(complete.join().unwrap(), force.join().unwrap());
    }
}
#[test]
fn reentrant_send_coalesces_and_failed_channel_cannot_be_replaced() {
    let c = Arc::new(ShutdownController::new());
    c.begin();
    let session = c.register_document().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let callback = {
        let weak = Arc::downgrade(&c);
        let calls = calls.clone();
        Arc::new(move |_: Snapshot| {
            let c = weak.upgrade().unwrap();
            if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                c.progress("settings", "nested update");
                c.progress("registry", "latest update");
                assert_eq!(c.snapshot().stage, "registry");
                true
            } else {
                false
            }
        }) as Sink
    };
    c.connect(&session, ConnectRequest { version: 1 }, callback)
        .unwrap();
    c.progress("attachments", "first update");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    c.progress("ownership", "no channel");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert!(c
        .connect(&session, ConnectRequest { version: 1 }, Arc::new(|_| true))
        .is_err());
}
#[test]
fn channel_destructor_can_reenter_on_revocation_rejection_and_send_failure() {
    struct Reenter(std::sync::Weak<ShutdownController>, Arc<AtomicUsize>);
    impl Drop for Reenter {
        fn drop(&mut self) {
            let _ = self.0.upgrade().unwrap().snapshot();
            self.1.fetch_add(1, Ordering::SeqCst);
        }
    }
    for failed_send in [false, true] {
        let (c, r, _) = connected();
        c.revoke_document(&r.session);
        let session = c.register_document().unwrap();
        let drops = Arc::new(AtomicUsize::new(0));
        let guard = Reenter(Arc::downgrade(&c), drops.clone());
        let sink: Sink = Arc::new(move |_| {
            let _ = &guard;
            !failed_send
        });
        c.connect(&session, ConnectRequest { version: 1 }, sink)
            .unwrap();
        let rejected_guard = Reenter(Arc::downgrade(&c), drops.clone());
        assert!(c
            .connect(
                &session,
                ConnectRequest { version: 1 },
                Arc::new(move |_| {
                    let _ = &rejected_guard;
                    true
                })
            )
            .is_err());
        assert_eq!(drops.load(Ordering::SeqCst), 1);
        if failed_send {
            c.progress("send", "fail channel");
        } else {
            c.revoke_document(&session);
        }
        assert_eq!(drops.load(Ordering::SeqCst), 2);
    }
}
#[test]
fn retired_in_flight_channel_cannot_clear_a_reentrant_replacement() {
    let c = Arc::new(ShutdownController::new());
    c.begin();
    let session = c.register_document().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let sink = {
        let old = session.clone();
        let weak = Arc::downgrade(&c);
        let calls = calls.clone();
        Arc::new(move |_: Snapshot| {
            let c = weak.upgrade().unwrap();
            c.revoke_document(&old);
            let fresh = c.register_document().unwrap();
            let calls = calls.clone();
            c.connect(
                &fresh,
                ConnectRequest { version: 1 },
                Arc::new(move |_| {
                    calls.fetch_add(1, Ordering::SeqCst);
                    true
                }),
            )
            .unwrap();
            c.progress("registry", "new lifetime update");
            false
        }) as Sink
    };
    c.connect(&session, ConnectRequest { version: 1 }, sink)
        .unwrap();
    c.progress("attachments", "old lifetime update");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    c.progress("ownership", "replacement still connected");
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}
#[test]
fn reporter_can_reenter_and_observes_forced_incomplete_evidence() {
    let (c, r, now) = connected();
    let now = now + DISPLAY_DELAY;
    let token = c.prepare_at(&r.session, &r, now).unwrap().confirmation;
    let evidence = c
        .confirm_at(&r.session, &confirmation(&r, token), now)
        .unwrap();
    let called = Arc::new(AtomicUsize::new(0));
    let reporter = {
        let called = called.clone();
        let c = c.clone();
        crate::shutdown_commands::ShutdownForceReporter::new(move |e| {
            assert!(!e.ok && !e.cleanup_complete);
            assert!(c.is_forced());
            assert!(!c.complete());
            called.fetch_add(1, Ordering::SeqCst);
        })
    };
    reporter.record(&evidence);
    assert_eq!(called.load(Ordering::SeqCst), 1);
}
struct PanickingSinkDrop {
    controller: std::sync::Weak<ShutdownController>,
    drops: Arc<AtomicUsize>,
}
impl Drop for PanickingSinkDrop {
    fn drop(&mut self) {
        let c = self.controller.upgrade().unwrap();
        c.progress("destructor", "reentrant update before panic");
        self.drops.fetch_add(1, Ordering::SeqCst);
        panic!("foreign shutdown sink destructor");
    }
}
#[test]
fn panicking_send_and_destructor_do_not_stick_delivery_or_unwind_progress() {
    let c = Arc::new(ShutdownController::new());
    c.begin();
    let session = c.register_document().unwrap();
    let drops = Arc::new(AtomicUsize::new(0));
    let guard = PanickingSinkDrop {
        controller: Arc::downgrade(&c),
        drops: drops.clone(),
    };
    let weak = Arc::downgrade(&c);
    c.connect(
        &session,
        ConnectRequest { version: 1 },
        Arc::new(move |_| {
            let _ = &guard;
            weak.upgrade()
                .unwrap()
                .progress("callback", "reentrant update before panic");
            panic!("foreign shutdown send");
        }),
    )
    .unwrap();
    c.progress("attachments", "first delivery");
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert!(!c.lock().delivering);
    c.progress("registry", "cleanup continues");
    assert_eq!(c.snapshot().stage, "registry");
    c.revoke_document(&session);
    let fresh = c.register_document().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let delivered = calls.clone();
    c.connect(
        &fresh,
        ConnectRequest { version: 1 },
        Arc::new(move |_| {
            delivered.fetch_add(1, Ordering::SeqCst);
            true
        }),
    )
    .unwrap();
    c.progress("ownership", "replacement receives progress");
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert!(c.complete());
}
#[test]
fn panicking_destructors_are_isolated_on_rejection_and_retired_document() {
    let (c, r, _) = connected();
    let drops = Arc::new(AtomicUsize::new(0));
    let guard = PanickingSinkDrop {
        controller: Arc::downgrade(&c),
        drops: drops.clone(),
    };
    assert!(c
        .connect(
            &r.session,
            ConnectRequest { version: 1 },
            Arc::new(move |_| {
                let _ = &guard;
                true
            })
        )
        .is_err());
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    c.revoke_document(&r.session);
    let fresh = c.register_document().unwrap();
    let guard = PanickingSinkDrop {
        controller: Arc::downgrade(&c),
        drops: drops.clone(),
    };
    c.connect(
        &fresh,
        ConnectRequest { version: 1 },
        Arc::new(move |_| {
            let _ = &guard;
            true
        }),
    )
    .unwrap();
    c.revoke_document(&fresh);
    assert_eq!(drops.load(Ordering::SeqCst), 2);
    c.progress("registry", "revocation did not unwind cleanup");
    assert_eq!(c.snapshot().stage, "registry");
    assert!(!c.lock().delivering);
}
#[test]
fn confirm_returns_evidence_despite_panicking_send_and_destructor() {
    let c = Arc::new(ShutdownController::new());
    let now = Instant::now();
    c.begin_at(now);
    let session = c.register_document().unwrap();
    let drops = Arc::new(AtomicUsize::new(0));
    let guard = PanickingSinkDrop {
        controller: Arc::downgrade(&c),
        drops: drops.clone(),
    };
    let reply = c
        .connect(
            &session,
            ConnectRequest { version: 1 },
            Arc::new(move |_| {
                let _ = &guard;
                panic!("foreign forced-snapshot send");
            }),
        )
        .unwrap();
    let r = SessionRequest {
        version: 1,
        session,
        attempt: reply.attempt,
    };
    let now = now + DISPLAY_DELAY;
    let token = c.prepare_at(&r.session, &r, now).unwrap().confirmation;
    let evidence = c
        .confirm_at(&r.session, &confirmation(&r, token), now)
        .unwrap();
    assert!(!evidence.ok && !evidence.cleanup_complete);
    assert_eq!(evidence.snapshot.phase, Phase::Forced);
    assert_eq!(drops.load(Ordering::SeqCst), 1);
    assert!(!c.lock().delivering);
    let reported = Arc::new(AtomicUsize::new(0));
    let count = reported.clone();
    crate::shutdown_commands::ShutdownForceReporter::new(move |_| {
        count.fetch_add(1, Ordering::SeqCst);
    })
    .record(&evidence);
    assert_eq!(reported.load(Ordering::SeqCst), 1);
}
#[test]
fn snapshots_are_bounded_in_utf8_even_with_json_escaping() {
    let (c, _, _) = connected();
    c.progress(&"\0".repeat(5000), &"\0".repeat(5000));
    c.fail(&"\0".repeat(5000));
    assert!(serde_json::to_vec(&c.snapshot()).unwrap().len() <= 4096);
    c.progress("registry", &"é".repeat(5000));
    assert!(serde_json::to_vec(&c.snapshot()).unwrap().len() <= 4096);
}
