use crate::plugin_registry::command_resource_settings::{SettingsAssociation, SettingsOperations};
use crate::{
    owned::random_marker,
    wire::{self, Reply, Save},
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::Notify;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Manager,
    Workspace,
    Probe,
}
impl Role {
    pub fn name(self) -> &'static str {
        match self {
            Self::Manager => "manager",
            Self::Workspace => "workspace",
            Self::Probe => "probe",
        }
    }
    pub fn shell(self) -> &'static str {
        match self {
            Self::Manager => "manager.html",
            Self::Workspace => "workspace.html",
            Self::Probe => "probe.html",
        }
    }
}
pub struct Lifetime {
    pub role: Role,
    pub session: String,
    pub highwater: i64,
    pub active_save: bool,
    pub handshaken: bool,
}
pub struct Record {
    pub session: String,
    pub id: i64,
    pub request: Save,
    pub result: Option<Reply<Value>>,
    pub completed: Option<Instant>,
}
pub struct State {
    pub windows: BTreeMap<String, Lifetime>,
    pub records: VecDeque<Record>,
    pub attachments: BTreeMap<String, Arc<crate::transport::Attachment>>,
    pub reports: BTreeMap<String, Vec<wire::Case>>,
    pub stopping: bool,
    pub native_stages: Vec<Value>,
}
pub struct Host {
    pub state: Mutex<State>,
    pub epoch: String,
    pub(crate) operations: SettingsOperations,
    pub(crate) association: SettingsAssociation,
    pub changed: Notify,
    pub invoke_slots: tokio::sync::Semaphore,
    pub navigation_denials: std::sync::atomic::AtomicUsize,
    pub popup_denials: std::sync::atomic::AtomicUsize,
}
impl Host {
    pub(crate) fn new(
        operations: SettingsOperations,
        association: SettingsAssociation,
    ) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                windows: BTreeMap::new(),
                records: VecDeque::new(),
                attachments: BTreeMap::new(),
                reports: BTreeMap::new(),
                stopping: false,
                native_stages: Vec::new(),
            }),
            epoch: random_marker(),
            operations,
            association,
            changed: Notify::new(),
            invoke_slots: tokio::sync::Semaphore::new(16),
            navigation_denials: std::sync::atomic::AtomicUsize::new(0),
            popup_denials: std::sync::atomic::AtomicUsize::new(0),
        })
    }
    pub fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
    pub fn register(&self, label: &str, role: Role) -> Reply<String> {
        let mut s = self.lock();
        if s.stopping
            || s.windows.contains_key(label)
            || (role == Role::Manager && s.windows.values().any(|w| w.role == Role::Manager))
        {
            return Err(wire::error("denied", "Lifetime registration refused"));
        }
        let session = random_marker();
        s.windows.insert(
            label.into(),
            Lifetime {
                role,
                session: session.clone(),
                highwater: 0,
                active_save: false,
                handshaken: false,
            },
        );
        Ok(session)
    }
    pub fn revoke_lifetime(&self, label: &str, session: &str) -> bool {
        let mut s = self.lock();
        if !s.windows.get(label).is_some_and(|w| w.session == session) {
            return false;
        }
        let attachments = Self::revoke_locked(&mut s, label);
        drop(s);
        for a in attachments {
            a.close("document-lifetime-ended");
        }
        self.changed.notify_waiters();
        true
    }
    pub fn revoke(&self, label: &str) {
        let mut s = self.lock();
        let attachments = Self::revoke_locked(&mut s, label);
        drop(s);
        for a in attachments {
            a.close("document-lifetime-ended");
        }
        self.changed.notify_waiters();
    }
    fn revoke_locked(s: &mut State, label: &str) -> Vec<Arc<crate::transport::Attachment>> {
        let mut attachments = Vec::new();
        s.reports.remove(label);
        if let Some(w) = s.windows.remove(label) {
            attachments.extend(
                s.attachments
                    .values()
                    .filter(|a| a.session == w.session)
                    .cloned(),
            );
            // Pending writes remain owned until completion. Completed results do not transfer.
            s.records
                .retain(|r| r.session != w.session || r.result.is_none());
        }
        attachments
    }
    pub fn stop_admission(&self) {
        let attachments = {
            let mut s = self.lock();
            s.stopping = true;
            s.attachments.values().cloned().collect::<Vec<_>>()
        };
        self.changed.notify_waiters();
        for a in attachments {
            a.close("application-shutdown");
        }
    }
    pub fn authorize(
        &self,
        label: &str,
        session: &str,
        version: u8,
        role: Option<Role>,
    ) -> Reply<()> {
        Self::authorize_locked(&self.lock(), label, session, version, role)
    }
    fn authorize_locked(
        s: &State,
        label: &str,
        session: &str,
        version: u8,
        role: Option<Role>,
    ) -> Reply<()> {
        if version != 1 {
            return Err(wire::invalid());
        }
        if s.stopping {
            return Err(wire::error("closed", "Fixture is shutting down"));
        }
        let w = s
            .windows
            .get(label)
            .ok_or_else(|| wire::error("denied", "Unknown native lifetime"))?;
        if w.session != session || role.is_some_and(|role| w.role != role) {
            return Err(wire::error("denied", "Caller lifetime or role denied"));
        }
        Ok(())
    }
    pub fn handshake(&self, label: &str) -> Reply<Value> {
        let mut s = self.lock();
        if s.stopping {
            return Err(wire::error("closed", "Shutting down"));
        }
        let w = s
            .windows
            .get_mut(label)
            .ok_or_else(|| wire::error("denied", "Unknown shell"))?;
        w.handshaken = true;
        let next = w
            .highwater
            .checked_add(1)
            .ok_or_else(|| wire::error("exhausted", "Create a new manager lifetime"))?;
        Ok(
            json!({"version":1,"session":w.session,"role":w.role.name(),"nextSaveSequence":next.to_string()}),
        )
    }
    pub fn reserve_save(&self, label: &str, request: Save, now: Instant) -> Reply<(i64, bool)> {
        request.settings.native()?;
        let id = wire::decimal(&request.request_id, true)?;
        let mut s = self.lock();
        Self::authorize_locked(
            &s,
            label,
            &request.session,
            request.version,
            Some(Role::Manager),
        )?;
        prune(&mut s.records, now);
        if let Some(r) = s
            .records
            .iter()
            .find(|r| r.session == request.session && r.id == id)
        {
            if r.request.expected_revision != request.expected_revision
                || r.request.settings != request.settings
            {
                return Err(wire::error(
                    "payload-mismatch",
                    "Save identity already has a different payload",
                ));
            }
            return Ok((id, false));
        }
        let w = s.windows.get(label).expect("authorized");
        if id <= w.highwater {
            return Err(expired());
        }
        if w.highwater.checked_add(1) != Some(id) {
            return Err(wire::error(
                "sequence-gap",
                "Save sequence must be exactly consecutive",
            ));
        }
        if w.active_save {
            return Err(wire::error("busy", "Manager already has an active save"));
        }
        if s.records.iter().filter(|r| r.result.is_none()).count() >= 16 {
            return Err(wire::error(
                "busy",
                "Global admitted save capacity occupied",
            ));
        }
        if s.records.len() == 32 {
            let Some(index) = s
                .records
                .iter()
                .enumerate()
                .filter_map(|(index, r)| r.completed.map(|at| (index, at)))
                .min_by_key(|(_, at)| *at)
                .map(|(index, _)| index)
            else {
                return Err(wire::error(
                    "busy",
                    "Result capacity occupied by pending saves",
                ));
            };
            s.records.remove(index);
        }
        let w = s.windows.get_mut(label).expect("authorized");
        w.highwater = id;
        w.active_save = true;
        s.records.push_back(Record {
            session: request.session.clone(),
            id,
            request,
            result: None,
            completed: None,
        });
        Ok((id, true))
    }
    pub fn result(
        &self,
        label: &str,
        session: &str,
        version: u8,
        id: i64,
        now: Instant,
    ) -> Reply<Value> {
        let mut s = self.lock();
        Self::authorize_locked(&s, label, session, version, Some(Role::Manager))?;
        prune(&mut s.records, now);
        s.records
            .iter()
            .find(|r| r.session == session && r.id == id)
            .map(|r| {
                r.result
                    .clone()
                    .unwrap_or_else(|| Ok(json!({"kind":"pending","requestId":id.to_string()})))
            })
            .unwrap_or_else(|| Err(expired()))
    }
    pub fn complete(&self, session: &str, id: i64, value: Reply<Value>) {
        let mut s = self.lock();
        if let Some(r) = s
            .records
            .iter_mut()
            .find(|r| r.session == session && r.id == id)
        {
            r.result = Some(value);
            r.completed = Some(Instant::now());
        }
        if let Some(w) = s.windows.values_mut().find(|w| w.session == session) {
            w.active_save = false;
        }
        self.changed.notify_waiters();
    }
    pub async fn drain_results(&self) {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.lock().records.iter().all(|r| r.result.is_some()) {
                break;
            }
            notified.await;
        }
    }
    pub fn stage(&self, name: &str, ok: bool) {
        eprintln!(
            "APPLICATION_INTEGRATION_STAGE {}",
            json!({"name":name,"ok":ok})
        );
        self.lock().native_stages.push(json!({"name":name,"ok":ok}));
    }
}
fn prune(records: &mut VecDeque<Record>, now: Instant) {
    records.retain(|r| {
        r.completed
            .is_none_or(|at| now.saturating_duration_since(at) < Duration::from_secs(600))
    });
}
fn expired() -> Value {
    wire::error("result-expired", "Exact save result is no longer retained")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_expiry_never_removes_pending() {
        let now = Instant::now();
        let req:Save=serde_json::from_value(json!({"version":1,"session":"a","requestId":"1","expectedRevision":"0","settings":wire::Limits::from(&crate::plugin_registry::CommandResourceSettings::default())})).unwrap();
        let mut records = VecDeque::new();
        records.push_back(Record {
            session: "a".into(),
            id: 1,
            request: req.clone(),
            result: Some(Ok(json!(true))),
            completed: Some(now),
        });
        records.push_back(Record {
            session: "a".into(),
            id: 2,
            request: req,
            result: None,
            completed: None,
        });
        prune(&mut records, now + Duration::from_secs(600));
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, 2);
    }
    #[test]
    fn authorization_is_lifetime_role_and_sticky_shutdown_bound() {
        let mut s = State {
            windows: BTreeMap::new(),
            records: VecDeque::new(),
            attachments: BTreeMap::new(),
            reports: BTreeMap::new(),
            stopping: false,
            native_stages: vec![],
        };
        s.windows.insert(
            "workspace-a".into(),
            Lifetime {
                role: Role::Workspace,
                session: "new".into(),
                highwater: 0,
                active_save: false,
                handshaken: false,
            },
        );
        assert!(Host::authorize_locked(&s, "workspace-a", "new", 1, Some(Role::Manager)).is_err());
        assert!(Host::authorize_locked(&s, "workspace-a", "old", 1, None).is_err());
        assert!(Host::authorize_locked(&s, "workspace-a", "new", 1, Some(Role::Workspace)).is_ok());
        s.stopping = true;
        assert!(Host::authorize_locked(&s, "workspace-a", "new", 1, None).is_err());
    }
}
