//! Consuming publication contracts. Native production publication is not qualified.
use super::super::{publication_platform as platform, selector};
use super::*;
use std::io::{self, Write};

/// Only exclusive root creation under the location lease constructs this proof.
pub(in crate::plugin_registry) struct InitialRoot {
    lease: LocationLease,
}
impl InitialRoot {
    pub(in crate::plugin_registry) fn claim(lease: &LocationLease) -> Result<Self> {
        platform::production_preflight(lease)?;
        Self::claim_exclusive(lease)
    }
    fn claim_exclusive(lease: &LocationLease) -> Result<Self> {
        fs::create_dir(lease.root())?;
        Ok(Self {
            lease: lease.clone(),
        })
    }
    #[cfg(test)]
    pub(in crate::plugin_registry) fn claim_for_test(lease: &LocationLease) -> Result<Self> {
        Self::claim_exclusive(lease)
    }
}

pub(in crate::plugin_registry) enum PublicationMode {
    First(InitialRoot),
    Replace { expected: GenerationId },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::plugin_registry) enum PublicationStage {
    BeforeSelection,
    SelectionAttempted,
}

pub(in crate::plugin_registry) struct PublishedGeneration {
    sealed: SealedGeneration,
}
pub(in crate::plugin_registry) struct PublicationFailure {
    error: RegistryError,
    cause: Option<Box<RegistryError>>,
    stage: PublicationStage,
    sealed: Box<SealedGeneration>,
}
pub(in crate::plugin_registry) struct ReadyGeneration {
    store: Store,
    generation: Generation,
}
pub(in crate::plugin_registry) struct ReopenFailure {
    error: RegistryError,
    cause: Option<Box<RegistryError>>,
    _ownership: Option<File>,
    generation: Box<Generation>,
}

/// Production always refuses until the platform/storage qualification gates pass.
/// Even preflight failure returns the consumed ownership, never just an error.
pub(in crate::plugin_registry) fn publish(
    sealed: SealedGeneration,
    mode: PublicationMode,
) -> std::result::Result<PublishedGeneration, PublicationFailure> {
    if let Err(error) = platform::production_preflight(&sealed.generation._lease) {
        return Err(PublicationFailure {
            error,
            cause: None,
            stage: PublicationStage::BeforeSelection,
            sealed: Box::new(sealed),
        });
    }
    publish_with(sealed, mode, &mut NativeCandidate)
}

#[cfg(test)]
pub(in crate::plugin_registry) fn publish_candidate_for_test(
    sealed: SealedGeneration,
    mode: PublicationMode,
) -> std::result::Result<PublishedGeneration, PublicationFailure> {
    publish_with(sealed, mode, &mut NativeCandidate)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    GenerationDirectory,
    RootDirectory,
    StableParent,
    TemporaryCreate,
    SelectorWrite,
    SelectorFileSync,
    BeforeSelection,
    AfterSelection,
    FinalDirectorySync,
}

// Implementations and bypasses are private. Only test code supplies another
// adapter; application code cannot manufacture platform qualification.
trait Adapter {
    fn at(&mut self, _phase: Phase) -> io::Result<()> {
        Ok(())
    }
    fn sync_directory(&mut self, path: &Path) -> io::Result<()>;
    fn select(&mut self, temporary: &Path, active: &Path, replace: bool) -> io::Result<()>;
    fn write_record(&mut self, file: &mut File, record: &[u8]) -> io::Result<()> {
        file.write_all(record)
    }
    fn sync_file(&mut self, file: &File) -> io::Result<()> {
        file.sync_all()
    }
}
struct NativeCandidate;
impl Adapter for NativeCandidate {
    fn sync_directory(&mut self, path: &Path) -> io::Result<()> {
        platform::sync_directory(path)
    }
    fn select(&mut self, temporary: &Path, active: &Path, replace: bool) -> io::Result<()> {
        platform::replace_selector(temporary, active, replace)
    }
}

fn validate_selection(sealed: &SealedGeneration, mode: &PublicationMode) -> Result<()> {
    let generation = &sealed.generation;
    match mode {
        PublicationMode::First(initial) => {
            if !initial.lease.same_owner(&generation._lease) {
                return Err(RegistryError::InvalidInput(
                    "first publication belongs to another location owner".into(),
                ));
            }
            match fs::symlink_metadata(generation._lease.root().join(selector::ACTIVE)) {
                Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
                Err(error) => Err(error.into()),
                Ok(_) => Err(RegistryError::RecoveryRequired(
                    "first publication found unexpected selection metadata".into(),
                )),
            }
        }
        PublicationMode::Replace { expected } => {
            if selector::read(&generation._lease)? != *expected {
                return Err(RegistryError::RecoveryRequired(
                    "active generation changed before publication".into(),
                ));
            }
            Ok(())
        }
    }
}

fn publish_with(
    sealed: SealedGeneration,
    mode: PublicationMode,
    adapter: &mut impl Adapter,
) -> std::result::Result<PublishedGeneration, PublicationFailure> {
    let mut stage = PublicationStage::BeforeSelection;
    let attempt = (|| -> Result<()> {
        let generation = &sealed.generation;
        let lease = &generation._lease;
        if generation.directory != generation.id.directory(lease)
            || generation.database != generation.id.database_path(lease)
        {
            return Err(RegistryError::InvalidInput(
                "sealed generation identity/path mismatch".into(),
            ));
        }
        selector::validate_generation(lease, generation.id)?;
        validate_selection(&sealed, &mode)?;
        for (phase, directory) in [
            (Phase::GenerationDirectory, generation.directory.as_path()),
            (Phase::RootDirectory, lease.root()),
            (
                Phase::StableParent,
                lease.root().parent().expect("leased stable parent"),
            ),
        ] {
            adapter.at(phase)?;
            adapter.sync_directory(directory)?;
        }
        adapter.at(Phase::TemporaryCreate)?;
        let temporary = lease
            .root()
            .join(format!("active-{}.tmp", GenerationId::random()?.name()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        adapter.at(Phase::SelectorWrite)?;
        adapter.write_record(&mut file, &selector::encode(generation.id))?;
        adapter.at(Phase::SelectorFileSync)?;
        adapter.sync_file(&file)?;
        drop(file);
        adapter.at(Phase::BeforeSelection)?;
        // Validate again immediately before the one attempted selection. This
        // is not compare-and-swap against arbitrary native writers.
        validate_selection(&sealed, &mode)?;
        stage = PublicationStage::SelectionAttempted;
        adapter.select(
            &temporary,
            &lease.root().join(selector::ACTIVE),
            matches!(mode, PublicationMode::Replace { .. }),
        )?;
        adapter.at(Phase::AfterSelection)?;
        adapter.at(Phase::FinalDirectorySync)?;
        adapter.sync_directory(lease.root())?;
        Ok(())
    })();
    match attempt {
        Ok(()) => Ok(PublishedGeneration { sealed }),
        Err(error) => {
            let (error, cause) = match stage {
                PublicationStage::BeforeSelection => (error, None),
                PublicationStage::SelectionAttempted => (
                    RegistryError::OutcomeUnknown(format!("selector publication: {error}")),
                    Some(Box::new(error)),
                ),
            };
            Err(PublicationFailure {
                error,
                cause,
                stage,
                sealed: Box::new(sealed),
            })
        }
    }
}

impl PublishedGeneration {
    pub(in crate::plugin_registry) fn id(&self) -> GenerationId {
        self.sealed.generation.id
    }

    pub(in crate::plugin_registry) fn open(
        self,
        limits: RegistryLimits,
    ) -> std::result::Result<ReadyGeneration, ReopenFailure> {
        let SealedGeneration {
            _ownership: ownership,
            generation,
        } = self.sealed;
        let validation = (|| -> Result<()> {
            if selector::read(&generation._lease)? != generation.id {
                return Err(RegistryError::RecoveryRequired(
                    "selected generation changed after confirmed publication".into(),
                ));
            }
            selector::validate_generation(&generation._lease, generation.id)?;
            Ok(())
        })();
        if let Err(error) = validation {
            return Err(ReopenFailure {
                error,
                cause: None,
                _ownership: Some(ownership),
                generation: Box::new(generation),
            });
        }
        // The location lease remains held while the destination lock is handed
        // back to SQLite's store opener. It is never released and reacquired.
        drop(ownership);
        match Store::open(&generation.database, limits) {
            Ok(store) => Ok(ReadyGeneration { store, generation }),
            Err(error) => Err(ReopenFailure {
                error: RegistryError::RecoveryRequired(format!(
                    "published generation failed readiness: {error}"
                )),
                cause: Some(Box::new(error)),
                _ownership: None,
                generation: Box::new(generation),
            }),
        }
    }
}
impl ReadyGeneration {
    /// Only an existing lifecycle owner of the very same lease may take the
    /// store. That thread retains its lease through the store's actual cleanup.
    pub(in crate::plugin_registry) fn into_store(
        self,
        owner: &LocationLease,
    ) -> std::result::Result<Store, Box<Self>> {
        if !owner.same_owner(&self.generation._lease) {
            return Err(Box::new(self));
        }
        Ok(self.store)
    }
}
impl PublicationFailure {
    pub(in crate::plugin_registry) fn diagnostic_cause(&self) -> &RegistryError {
        self.cause.as_deref().unwrap_or(&self.error)
    }
    pub(in crate::plugin_registry) fn error(&self) -> &RegistryError {
        &self.error
    }
    pub(in crate::plugin_registry) fn stage(&self) -> PublicationStage {
        self.stage
    }
    pub(in crate::plugin_registry) fn database_path(&self) -> &Path {
        &self.sealed.generation.database
    }
}
impl ReopenFailure {
    pub(in crate::plugin_registry) fn diagnostic_cause(&self) -> &RegistryError {
        self.cause.as_deref().unwrap_or(&self.error)
    }
    pub(in crate::plugin_registry) fn error(&self) -> &RegistryError {
        &self.error
    }
    pub(in crate::plugin_registry) fn database_path(&self) -> &Path {
        &self.generation.database
    }
}
impl fmt::Debug for PublishedGeneration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PublishedGeneration")
            .field("id", &self.id())
            .finish_non_exhaustive()
    }
}
impl fmt::Debug for PublicationFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PublicationFailure")
            .field("error", &self.error)
            .field("stage", &self.stage)
            .finish_non_exhaustive()
    }
}
impl fmt::Debug for ReadyGeneration {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ReadyGeneration")
            .field("id", &self.generation.id)
            .finish_non_exhaustive()
    }
}
impl fmt::Debug for ReopenFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ReopenFailure")
            .field("error", &self.error)
            .field("id", &self.generation.id)
            .finish_non_exhaustive()
    }
}

#[cfg(test)]
#[path = "publisher_tests.rs"]
mod tests;
