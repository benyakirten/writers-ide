use crate::plugin_registry::{
    command_resource_settings::{SettingsSnapshot, SettingsSubscription},
    CommandResourceRevision,
};
use crate::{
    owned::random_marker,
    policy::{Host, Role},
    wire::{self, Reply},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    future::{poll_fn, Future},
    panic::{catch_unwind, AssertUnwindSafe},
    pin::pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    task::Poll,
    time::{Duration, Instant},
};
use tauri::ipc::Channel;
use tokio::sync::Notify;

pub(crate) fn isolate<T>(action: impl FnOnce() -> T) -> Option<T> {
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(value) => Some(value),
        Err(payload) => {
            // Panic payload destructors are foreign too. Contain a second panic.
            if let Err(nested) = catch_unwind(AssertUnwindSafe(|| drop(payload))) {
                std::mem::forget(nested);
            }
            None
        }
    }
}

pub struct Delivery {
    pub snapshot: Arc<SettingsSnapshot>,
    pub sequence: i64,
    pub deadline: Instant,
}
pub struct AttachmentState {
    pub subscription: Option<SettingsSubscription>,
    pub delivery: Option<Delivery>,
    pub sequence: i64,
    pub initial_deadline: Instant,
    pub lease: Instant,
    pub applied: Option<CommandResourceRevision>,
    pub closed: bool,
    pub reading: bool,
    // One selected snapshot and one terminal notification, never a history queue.
    outbound: Option<Value>,
    close_reason: Option<String>,
    sending: bool,
    activated: bool,
    cleanup_done: bool,
    events: Option<Channel<Value>>,
}
pub struct Attachment {
    pub id: String,
    pub session: String,
    pub label: String,
    pub epoch: String,

    pub state: Mutex<AttachmentState>,
    pub cancel: Notify,
    pub done: Notify,
    pub finished: AtomicBool,
}
impl Attachment {
    pub(crate) fn new(
        label: &str,
        session: String,
        epoch: String,
        events: Channel<Value>,
    ) -> Arc<Self> {
        Arc::new(Self {
            id: random_marker(),
            session,
            label: label.into(),
            epoch,
            state: Mutex::new(AttachmentState {
                subscription: None,
                delivery: None,
                sequence: 0,
                initial_deadline: Instant::now() + Duration::from_secs(10),
                lease: Instant::now() + Duration::from_secs(30),
                applied: None,
                closed: false,
                reading: false,
                outbound: None,
                close_reason: None,
                sending: false,
                activated: false,
                cleanup_done: false,
                events: Some(events),
            }),
            cancel: Notify::new(),
            done: Notify::new(),
            finished: AtomicBool::new(false),
        })
    }
    pub(crate) fn activate(&self) {
        self.lock().activated = true;
        self.flush();
    }
    pub fn lock(&self) -> std::sync::MutexGuard<'_, AttachmentState> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn close(&self, reason: &str) {
        {
            let mut s = self.lock();
            if s.closed {
                return;
            }
            s.closed = true;
            s.outbound = None;
            s.close_reason = Some(reason.into());
        }
        self.cancel.notify_one();
        self.flush();
    }
    fn deliver(&self, snapshot: Arc<SettingsSnapshot>) {
        let mut s = self.lock();
        if s.closed {
            return;
        }
        if s.delivery.is_some() {
            drop(s);
            self.close("native-delivery-invariant");
            return;
        }
        let Some(sequence) = s.sequence.checked_add(1) else {
            drop(s);
            self.close("sequence-exhausted");
            return;
        };
        s.sequence = sequence;
        let event = json!({"kind":"snapshot","version":1,"epoch":self.epoch,"attachment":self.id,"sequence":sequence.to_string(),"revision":snapshot.saved.revision,"settings":wire::Limits::from(&snapshot.saved.settings)});
        s.delivery = Some(Delivery {
            snapshot,
            sequence,
            deadline: Instant::now() + Duration::from_secs(10),
        });
        s.outbound = Some(event);
        drop(s);
        self.flush();
    }
    fn flush(&self) {
        let mut events = {
            let mut s = self.lock();
            if s.sending || !s.activated || self.finished.load(Ordering::Acquire) {
                return;
            }
            s.sending = true;
            s.events.take()
        };
        loop {
            let event = {
                let mut s = self.lock();
                let event = s.outbound.take().or_else(|| {
                    s.close_reason.take().map(|reason| json!({"kind":"closed","version":1,"epoch":self.epoch,"attachment":self.id,"reason":reason}))
                });
                if event.is_none() {
                    if s.cleanup_done {
                        drop(s);
                        // The last channel capture can contain a foreign destructor.
                        // Keep the send latch until it is disposed, then certify draining.
                        let _ = isolate(|| drop(events.take()));
                        self.lock().sending = false;
                        self.finished.store(true, Ordering::Release);
                        self.done.notify_waiters();
                    } else {
                        s.events = events.take();
                        s.sending = false;
                    }
                    return;
                }
                event
            };
            let Some(event) = event else { unreachable!() };
            // Native channels can invoke arbitrary synchronous handlers, including ack,
            // status and close. Reentrant sends only select the next bounded event.
            if !matches!(
                isolate(|| events.as_ref().expect("active channel").send(event)),
                Some(Ok(()))
            ) {
                let mut s = self.lock();
                s.closed = true;
                s.outbound = None;
                s.close_reason = None;
                drop(s);
                self.cancel.notify_one();
            }
        }
    }
    pub(crate) fn finish(&self) {
        self.close("association-closed");
        let (subscription, delivery) = {
            let mut s = self.lock();
            (s.subscription.take(), s.delivery.take())
        };
        // Subscription destruction can drop foreign observer captures.
        let _ = isolate(|| drop(subscription));
        let _ = isolate(|| drop(delivery));
        self.lock().cleanup_done = true;
        self.flush();
    }
    pub fn acknowledge(&self, sequence: i64, revision: CommandResourceRevision) -> bool {
        let mut s = self.lock();
        if s.closed || Instant::now() >= s.lease {
            return false;
        }
        let Some(d) = s.delivery.as_ref() else {
            return false;
        };
        if d.sequence != sequence
            || d.snapshot.saved.revision != revision
            || Instant::now() >= d.deadline
        {
            return false;
        }
        let Some(sub) = s.subscription.as_ref() else {
            return false;
        };
        if !sub.acknowledge(&d.snapshot.epoch, revision) {
            return false;
        }
        s.delivery = None;
        s.applied = Some(revision);
        true
    }
    pub async fn drained(&self) {
        let notified = self.done.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        if !self.finished.load(Ordering::Acquire) {
            notified.await;
        }
    }
}
pub(crate) struct AttachmentCompletion(pub Arc<Attachment>);
impl Drop for AttachmentCompletion {
    fn drop(&mut self) {
        self.0.finish();
    }
}

pub(crate) fn attachment_task(
    task: Arc<Attachment>,
    association: crate::plugin_registry::command_resource_settings::SettingsAssociation,
) -> impl Future<Output = ()> + Send {
    let completion = AttachmentCompletion(task.clone());
    async move {
        let _completion = completion;
        let mut closed = pin!(association.closed());
        let mut cancelled = pin!(task.cancel.notified());
        poll_fn(|cx| {
            if closed.as_mut().poll(cx).is_ready() || cancelled.as_mut().poll(cx).is_ready() {
                Poll::Ready(())
            } else {
                Poll::Pending
            }
        })
        .await;
    }
}

impl Host {
    pub fn attach(
        self: &Arc<Self>,
        label: &str,
        request: wire::Attach,
        events: Channel<Value>,
    ) -> Reply<Value> {
        wire::challenge(&request.challenge)?;
        let mut s = self.lock();
        let finished = s
            .attachments
            .values()
            .filter(|a| a.finished.load(Ordering::Acquire))
            .map(|a| a.id.clone())
            .collect::<Vec<_>>();
        let removed = finished
            .into_iter()
            .filter_map(|id| s.attachments.remove(&id))
            .collect::<Vec<_>>();
        drop(s);
        let _ = isolate(|| drop(removed));
        let mut s = self.lock();
        // Authorization and slot reservation are atomic with shutdown/lifetime revocation.
        let w = s
            .windows
            .get(label)
            .ok_or_else(|| wire::error("denied", "Unknown caller"))?;
        if s.stopping
            || request.version != 1
            || w.role != Role::Workspace
            || w.session != request.session
            || self.association.is_closed()
        {
            return Err(wire::error("denied", "Workspace lifetime unavailable"));
        }

        if s.attachments.len() >= 8
            || s.attachments
                .values()
                .any(|a| a.session == request.session && !a.lock().closed)
        {
            return Err(wire::error(
                "busy",
                "Attachment capacity or workspace association already occupied",
            ));
        }
        let a = Attachment::new(label, request.session, self.epoch.clone(), events);
        let observed = Arc::downgrade(&a);
        let sub = self.association.subscribe(move |snapshot| {
            if let Some(a) = observed.upgrade() {
                a.deliver(snapshot);
            }
        });
        let sub = match sub {
            Ok(sub) => sub,
            Err(_) => {
                drop(s);
                let _ = isolate(|| drop(a));
                return Err(wire::error(
                    "unavailable",
                    "Native subscription unavailable",
                ));
            }
        };
        a.lock().subscription = Some(sub);
        s.attachments.insert(a.id.clone(), a.clone());
        let task = attachment_task(a.clone(), self.association.clone());
        drop(s);
        a.activate();
        tauri::async_runtime::spawn(task);
        Ok(json!({"version":1,"epoch":self.epoch,"attachment":a.id,"challenge":request.challenge}))
    }
    pub fn attachment(
        &self,
        label: &str,
        version: u8,
        session: &str,
        epoch: &str,
        id: &str,
    ) -> Reply<Arc<Attachment>> {
        self.authorize(label, session, version, Some(Role::Workspace))?;
        if epoch != self.epoch || self.association.is_closed() {
            return Err(wire::error("closed", "Service association closed"));
        }
        let s = self.lock();
        let a = s
            .attachments
            .get(id)
            .cloned()
            .ok_or_else(|| wire::error("denied", "Unknown attachment"))?;
        drop(s);
        if a.session != session || a.label != label {
            return Err(wire::error("denied", "Foreign attachment"));
        }
        let state = a.lock();
        if state.closed
            || (state.applied.is_none() && Instant::now() >= state.initial_deadline)
            || Instant::now() >= state.lease
            || state
                .delivery
                .as_ref()
                .is_some_and(|d| Instant::now() >= d.deadline)
        {
            drop(state);
            a.close("attachment-deadline");
            return Err(wire::error("closed", "Attachment expired"));
        }
        drop(state);
        Ok(a.clone())
    }
    pub fn application_status(&self) -> Value {
        let s = self.lock();
        let mut rows = BTreeMap::new();
        for (label, w) in &s.windows {
            if w.role == Role::Workspace {
                rows.insert(
                    label.clone(),
                    json!({"window":label,"state":"stale","revision":Value::Null}),
                );
            }
        }
        let mut active = BTreeSet::new();
        for a in s.attachments.values() {
            if !s
                .windows
                .get(&a.label)
                .is_some_and(|w| w.session == a.session)
            {
                continue;
            }
            let state = a.lock();
            // Closed tasks can remain registered until their foreign callbacks and
            // destructors drain. They must not obscure a replacement association.
            if state.closed && active.contains(&a.label) {
                continue;
            }
            if !state.closed {
                active.insert(a.label.clone());
            }
            let status =
                if state.closed || self.association.is_closed() || Instant::now() >= state.lease {
                    "stale"
                } else if state.delivery.is_some() || state.applied.is_none() {
                    "pending"
                } else {
                    "applied"
                };
            rows.insert(
                a.label.clone(),
                json!({"window":a.label,"state":status,"revision":state.applied}),
            );
        }
        Value::Array(rows.into_values().collect())
    }
    pub fn scheduler(self: &Arc<Self>) -> std::thread::JoinHandle<()> {
        let weak = Arc::downgrade(self);
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(100));
            let Some(host) = weak.upgrade() else {
                break;
            };
            let attachments = {
                let mut s = host.lock();
                if s.stopping {
                    break;
                }
                let finished = s
                    .attachments
                    .values()
                    .filter(|a| a.finished.load(Ordering::Acquire))
                    .map(|a| a.id.clone())
                    .collect::<Vec<_>>();
                let removed = finished
                    .into_iter()
                    .filter_map(|id| s.attachments.remove(&id))
                    .collect::<Vec<_>>();
                let attachments = s.attachments.values().cloned().collect::<Vec<_>>();
                drop(s);
                let _ = isolate(|| drop(removed));
                attachments
            };
            for a in attachments {
                let expired = {
                    let state = a.lock();
                    (state.applied.is_none() && Instant::now() >= state.initial_deadline)
                        || Instant::now() >= state.lease
                        || state
                            .delivery
                            .as_ref()
                            .is_some_and(|d| Instant::now() >= d.deadline)
                };
                if expired {
                    a.close("attachment-deadline");
                }
            }
        })
    }
    pub async fn drain_attachments(&self) {
        let attachments = {
            let mut s = self.lock();
            s.stopping = true;
            s.attachments.values().cloned().collect::<Vec<_>>()
        };
        for a in &attachments {
            a.close("application-shutdown");
        }
        for a in attachments {
            a.drained().await;
        }
        let removed = std::mem::take(&mut self.lock().attachments);
        let _ = isolate(|| drop(removed));
    }
}
