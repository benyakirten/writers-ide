use super::*;

pub(crate) struct ReaderBudget {
    limit: usize,
    used: AtomicUsize,
}
impl ReaderBudget {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            limit,
            used: AtomicUsize::new(0),
        }
    }
    fn admit(self: &Arc<Self>) -> Result<ReaderSlot> {
        let mut used = self.used.load(Ordering::Acquire);
        loop {
            if used >= self.limit {
                return Err(RegistryError::LimitExceeded(
                    "registry observation readers".into(),
                ));
            }
            match self.used.compare_exchange_weak(
                used,
                used + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(current) => used = current,
            }
        }
        Ok(ReaderSlot(self.clone()))
    }
}
struct ReaderSlot(Arc<ReaderBudget>);
impl Drop for ReaderSlot {
    fn drop(&mut self) {
        self.0.used.fetch_sub(1, Ordering::AcqRel);
    }
}

pub(crate) struct ServiceValidity {
    valid: AtomicBool,
    publisher: watch::Sender<bool>,
}
impl ServiceValidity {
    pub(crate) fn new() -> Self {
        Self {
            valid: AtomicBool::new(true),
            publisher: watch::channel(true).0,
        }
    }
    pub(crate) fn is_valid(&self) -> bool {
        self.valid.load(Ordering::Acquire)
    }
    pub(crate) fn invalidate(&self) {
        self.valid.store(false, Ordering::Release);
        self.publisher.send_replace(false);
    }
}

/// Owned latest-state observations, not a transition history. No borrowed watch guards escape.
pub(crate) struct LifecycleObserver {
    receiver: watch::Receiver<LifecycleSnapshot>,
    _slot: ReaderSlot,
}
impl LifecycleObserver {
    pub(crate) fn current(&self) -> LifecycleSnapshot {
        self.receiver.borrow().clone()
    }
    pub(crate) async fn next(&mut self) -> Option<LifecycleSnapshot> {
        self.receiver.changed().await.ok()?;
        Some(self.receiver.borrow_and_update().clone())
    }
}
pub(crate) struct ServiceValidityObserver {
    receiver: watch::Receiver<bool>,
    _slot: ReaderSlot,
}
impl ServiceValidityObserver {
    pub(crate) fn is_valid(&self) -> bool {
        *self.receiver.borrow()
    }
    pub(crate) async fn invalidated(&mut self) {
        // changed tracks a version even when publication precedes first polling.
        while *self.receiver.borrow_and_update() {
            if self.receiver.changed().await.is_err() {
                return;
            }
        }
    }
}
impl RegistryControl {
    pub(crate) fn observe(&self) -> Result<LifecycleObserver> {
        let mut state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
        let slot = self.shared.lifecycle_readers.admit()?;
        let lifecycle = &mut state.lifecycle;
        let receiver = if let Some(publisher) = &lifecycle.publisher {
            publisher.subscribe()
        } else {
            let (publisher, receiver) = watch::channel(lifecycle.snapshot.clone());
            if lifecycle.snapshot.phase != LifecyclePhase::Stopped {
                lifecycle.publisher = Some(publisher);
            }
            receiver
        };
        Ok(LifecycleObserver {
            receiver,
            _slot: slot,
        })
    }
}
impl RegistryHandle {
    /// Lock-free ordering point usable while another service holds its own mutex.
    pub(crate) fn is_service_valid(&self) -> bool {
        self.validity.is_valid()
    }
    pub(crate) fn observe_validity(&self) -> Result<ServiceValidityObserver> {
        let state = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
        if state.lifecycle.service != self.service || !self.is_service_valid() {
            return Err(RegistryError::Unavailable(
                "registry service permanently invalid".into(),
            ));
        }
        let slot = self.shared.validity_readers.admit()?;
        Ok(ServiceValidityObserver {
            receiver: self.validity.publisher.subscribe(),
            _slot: slot,
        })
    }
}
