# Project file metadata index

**Status: approved direction; not implemented.** This plan describes a SQLite-backed index of files and filesystem metadata within a registered project. It is not a document content store or an authoritative catalog of books, scenes or other application documents.

The filesystem remains the source of truth for indexed files. File contents stay in their existing storage. The index does not contain manuscript text or binary file contents. This does not select the project's content format.

**Approved storage location; not implemented:** keep the index in application-managed local storage, outside the project folder. Associate it with the registered project. Use a separate rebuildable index database, not the database holding host settings, installation records and permission grants. Each computer builds and maintains its own observations. Copying or synchronizing a project does not need to carry its index. Indexing does not require write access to the project folder. Exact local directory and schema remain implementation details. Do not assume a fixed scan cost for every project.

## Automatic index recovery

**Approved recovery policy; not implemented:** automatically rebuild a corrupt or incompatible index without requiring user approval. Stop serving the unusable cache, report recovery through index status and diagnostics, and create a replacement from filesystem observations. Return available partial replacement records with `initialized: false` until initialization succeeds. If no usable query state is available, queries reject under the native error model rather than returning corrupt data.

Recovery must not modify project files, permission grants, installation records or host settings. If rebuilding fails, expose the failure. Bound automatic retries; do not repeatedly restart recovery without a limit. Exact retry limits, replacement mechanics and schema compatibility checks still need implementation design. An ordinary query or filesystem scan failure is not by itself evidence that the database is corrupt.

## Approved responsibilities

The host maintains the index and exposes bounded metadata queries to authorized plugins. Plugins should not each need to enumerate the filesystem to discover the same files. The approved query API is described below. It does not permit unrestricted SQL or cross-project access.

Metadata queries must finish their SQLite statements and read transactions before returning a page. Pagination must not retain a filesystem iterator, directory handle, SQLite statement or read transaction between plugin requests. Continuations use the approved stateless keyset design below. The query method and page envelope are approved below; production integration remains outstanding.

**Approved discovery policy; not implemented:** do not automatically apply `.gitignore` or other Git ignore rules to indexing. Version-control tracking does not determine whether an entry appears in plugin queries. Index entries within the registered project subject to containment, unsupported-entry handling and host resource limits. Explicit host-configurable indexing exclusions are future work. Their effect on query completeness and status must be defined before introduction.

The indexer itself necessarily accesses the filesystem. Its active scans and watchers may hold native resources and must have bounded work, cancellation and cleanup. Removing resource-owning pagination does not remove the need to manage those resources.

The existing file-service requirements still apply:

- Authorize access against the activation's registered project. Metadata access and saved-file reads are separate operations.
- Preserve project-relative paths and containment. Index records are not authority to read a path.
- Do not follow prohibited links or reparse points. Identified unsupported entries disclose no target or contents.
- Keep directory views nonrecursive initially. Use explicit `'.'` for the registered project root, with empty/missing paths rejected.
- Keep the approved initial response maximum of 256 entries per page, with no caller-selected page size. Bound query work and payloads separately.
- Read saved bytes through the separately approved `ProjectFiles.read()` operation. Revalidate the actual filesystem target and permissions at read time; the index may be stale.

Query/page, entry/status and async subscription contracts are approved below. Reconciliation remains host-controlled initially. Plugins have no scan-request API.

## Query API

**Approved shape; not implemented:**

```ts
type FileIndexQueryOptions = NativeRequestOptions & {
	readonly after?: string;
};

type FileIndexPage = {
	readonly entries: readonly FileIndexEntry[];
	readonly status: FileIndexStatus;
	readonly nextToken: string | null;
};

interface ProjectFiles {
	queryIndex(directory: string, options?: FileIndexQueryOptions): Promise<FileIndexPage>;
}
```

The directory is project-relative, with explicit `'.'` for the root. Return immediate children in deterministic non-locale-aware path order, up to 256 entries. `after` accepts a returned opaque token, not a file path or row number. There is no caller-selected page size, custom sorting or SQL.

`status` describes the index state used for this page. A null `nextToken` means no further indexed entries after this position at query time. It does not establish filesystem completeness; inspect the status, especially during initialization or uncertainty. Entries and status must describe a coherent query-visible state. Different pages may have different revisions.

The method uses the existing metadata permission, cancellation and native error policies. Author types belong to the approved `@writers-ide/plugins/native` entry point. Build/profile integration, concrete error mapping and implementation remain outstanding.

## Query pagination

**Approved strategy; not implemented:** use opaque stateless keyset continuation tokens, initially with deterministic non-locale-aware path ordering. A token describes the last ordering key, not an open iterator or database transaction. Every request finishes its native database resources before returning.

Validate token structure and binding to the live project opening and directory/query. Check the caller's active authorization on every use. The token grants no authority; its contents and internal encoding are not an author contract. Do not expose an absolute filesystem location. Use the same ordering comparison for page queries and continuation boundaries.

Tokens are reusable while their project/query scope remains valid. Each use queries the current index and returns its own status/revision. No single-use tracking or resource-reclamation timeout is needed. Deleting the last returned entry does not prevent continuation because its key remains sufficient. Token reuse does not provide a historical snapshot or freeze the index at a previous revision.

Concurrent insertions before the continuation point may require refresh to appear. Renames and other changes can affect membership or repeat a file under a new path. Use invalidation to refresh relevant queries. Do not promise duplicate-free traversal or a stable snapshot across pages of a changing index.

The initial API does not provide direct page-number jumps or configurable ordering. Directory-first ordering, metadata sorting and random-access navigation are future candidates needing explicit continuation semantics. The query signature, page envelope and completion signaling are approved above.

## Indexed entry metadata

**Approved data shape; not implemented:**

```ts
type FileIndexEntry = {
	readonly path: string;
	readonly kind: 'file' | 'directory' | 'unsupported';
	readonly sizeBytes: number | null;
	readonly modifiedAt: number | null;
};
```

`path` is project-relative. `kind` identifies a file, directory or an identified unsupported entry. `sizeBytes` is the observed file size; use null for directories, unsupported entries or unavailable metadata. `modifiedAt` is the observed file/directory modification time in Unix-epoch milliseconds; use null when unavailable or unsupported. Do not substitute zero for unknown values.

**Approved hard-link classification; not implemented:** classify regular files detected to have multiple hard links as `unsupported`. Keep the project-relative name discoverable, with null size and modification time under the existing unsupported-entry rules. Expose no contents or link targets. One unsupported entry does not fail the listing. Do not apply regular-file link-count rules to directories. This adds no detailed unsupported-reason field. Saved-file reads independently validate the live target and reject detected multiple hard links with `unsupported-entry`.

These are cached observations, not guaranteed current properties. Metadata inspection failures remain visible through index uncertainty/error reporting; they are not a reason to classify an unknown entry as unsupported or declare its deletion. Modification time does not prove unchanged contents. Saved reads still validate the actual target and grants.

The entry exposes no file contents, link target, checksum or stable application-document ID. A path is a filesystem location and may change on rename. Entry and query/page contracts are approved, but no database schema is selected.

## Permissions

**Approved grouping; not implemented:** `project.files.list` with resource `project` covers indexed metadata queries, reading `FileIndexStatus` and subscribing to coalesced invalidation. `project.files.read` remains separately required for saved file contents. Neither permission implies the other.

A component with only read permission may read a known permitted path but cannot enumerate indexed metadata, read index status or subscribe to index changes. A metadata-only component can observe indexed state without reading contents. Each operation still needs authorization even when the shared project-file service object is non-null.

This selects no new permission name and does not grant unrestricted SQL, cross-project metadata, unsaved editor content, raw OS-event streams or caller-triggered rescans. Plugins cannot request reconciliation initially. Any future plugin scan-request API needs separate permission and resource-policy review. Preserve activation/project scope, mandatory consent and revocation for queries and subscriptions.

## Change detection and reconciliation

Use native filesystem notifications to discover changes promptly. Treat events as hints, not a complete or ordered record of every change. Events can be combined or lost, and no watcher runs while the application is closed.

**Approved lifetime; not implemented:** opening a project starts its filesystem watcher and initial reconciliation. Periodic reconciliation runs while the project remains open. The host owns this work. It does not depend on plugin activation, query use or subscription count. Disabling a plugin or releasing its last subscription does not stop indexing. Plugins need no indexing usage handle.

Closing the project stops its watcher and timer and cancels pending indexing work. Reopening starts a new indexing lifetime and initial reconciliation. Cached records may remain available under the readiness rules below, but they do not establish initialization for the new opening.

Run reconciliation on a timer to repair missed changes. Allow at most one reconciliation at a time for each open project. If a request arrives during a scan, mark one additional pass as pending. Combine further requests into that pending pass rather than queueing each request separately. Project closure cancels active and pending work. This applies to reconciliation requests; it does not require a full scan for every filesystem notification.

**Approved watcher-gap response; not implemented:** when the watcher reports an overflow or another known event gap, set `needsReconciliation: true` and notify subscribers after that status becomes query-visible. Request reconciliation without waiting for the periodic timer. Keep scheduling/resource limits and bounded failure retries. If a scan is already running, combine the request into the single pending pass. Continue serving usable indexed results with their uncertainty status. A completed scan must not clear uncertainty from a newer, unresolved gap.

**Approved watcher-failure fallback; not implemented:** if the watcher cannot start or stops working, keep usable records available and continue periodic reconciliation. Report watcher failure through status and diagnostics. Set `needsReconciliation: true` when observations are known to need checking. Retry watcher setup with increasing delay after repeated failures, not a continuous retry loop. Reconcile after restoration to cover the notification gap. A later watcher failure does not undo initialization that already succeeded. A successful scan does not prove notifications are working and must not hide an unresolved watcher failure.

Use the same off-frontend-thread work, bounded scan/database batches, single active reconciliation and cancellation checkpoints as normal indexing. Project closure stops scans, timers and watcher retries. Exact intervals, batch sizes, retry/backoff defaults and interruption mechanics remain implementation work. Reconciliation is host-controlled initially. Repeating a plugin query reads the current index; it does not request a filesystem scan. A host-owned user refresh action remains a candidate whose UI and behavior need design. Plugin-requested reconciliation is future work, not an initial API.

Reconciliation compares filesystem observations with indexed metadata and updates the index. It must not treat an unreadable directory or incomplete scan as proof that all its previous entries were deleted. **Approved directory-failure policy; not implemented:** continue scanning accessible directories after a directory-specific failure. Preserve previous records for the failed area. Update successfully observed areas and track scan coverage before confirming deletions. Report the failure through `lastError` and keep `needsReconciliation: true`. During initial reconciliation, keep `initialized: false` until initialization fully succeeds. If initialization already succeeded in this opening, retain `initialized: true`; the error and uncertainty fields describe the later failure. A partial pass does not advance the last successful full-reconciliation time. Retry through bounded host scheduling. Cancellation, project closure or an unusable database can still stop the entire pass.

A stored file can change or disappear between a query and a read. SQLite transactions do not make filesystem observations atomic.

Keep indexing work off the frontend UI thread. Use bounded scanning and database updates. Apply the approved watcher-gap response. Implement the approved scan-error and watcher-recovery policies. Specify interruption mechanics and measure work before selecting timer defaults or promising freshness.

## Readiness and freshness

**Approved query behavior; not implemented:** return available indexed metadata while initialization or reconciliation continues. Cached records may be shown during checking, and an initial build may return only records found so far. Include explicit readiness/freshness information and identify the index revision used by the query. The approved status shape is shown below. Revision strings are opaque; their internal format is not an author contract.

An incomplete empty result does not prove that a directory is empty. Missing observations during a partial or failed scan are not confirmed deletions. Preserve visible error/uncertainty information rather than presenting a failed scan as a complete result.

### Approved status shape

```ts
type FileIndexStatus = {
	readonly revision: string;
	readonly initialized: boolean;
	readonly reconciling: boolean;
	readonly needsReconciliation: boolean;
	readonly lastReconciledAt: number | null;
	readonly lastError: string | null;
};
```

- `revision` identifies the query-visible index state. Treat it as opaque, not a timestamp or permission token.
- `initialized` means required initial reconciliation succeeded for this project opening. Cached records alone do not establish it.
- `reconciling` means reconciliation is running. It can be true while initialized data remains usable.
- `needsReconciliation` means the host knows observations need checking, such as after watcher overflow or a failed scan. False does not prove that every filesystem change is observed.
- `lastReconciledAt` is the last known successful full reconciliation time in milliseconds since the Unix epoch. It may come from a previous opening. Null means no successful time is known.
- `lastError` is a display-only summary of background indexing failure. Clear resolved scan failures after successful reconciliation, but do not hide an unresolved watcher failure merely because a scan succeeded. Do not parse it as an error code or expose credentials/absolute paths in it.

A query that cannot run still rejects under the native error model. A background scan error can instead coexist with useful indexed results and status. The type and field meanings are approved. The subscription signature is approved below; the query API is approved above, with author types exported through `@writers-ide/plugins/native`. Build/profile and production integration remain outstanding.

Ready means the required index initialization has completed. It does not promise a frozen filesystem, immediate watcher processing or a consistent snapshot across separate page requests. Reads of known paths remain separately authorized filesystem operations and do not wait for index readiness.

Readiness transitions must notify subscribers even when no file entries changed. Make the new state query-visible before delivering its invalidation. Plugins cannot explicitly request fresher filesystem observations through the initial API.

## Subscriptions

**Approved notification strategy; not implemented:** send coalesced invalidation notices after index updates commit. A notice tells a plugin to refresh relevant queries; it does not describe every file change or expose raw operating-system events. Several committed updates may produce one notice. Do not promise one notification per filesystem operation or a reliable operation history.

A directory view should refresh its visible/dependent queries rather than reload the entire project index. Notifications must follow the corresponding committed state so a new query can observe it, subject to further concurrent updates. Subscriptions belong to activation lifetime and stop when access is revoked or the project opening closes.

Readiness changes also invalidate subscriptions even when no file entries changed. Detailed added/updated/removed feeds and more selective invalidation are future candidates, not requirements for the initial API.

### Approved asynchronous subscription

```ts
subscribeIndex(
	listener: (status: FileIndexStatus) => void,
	options?: NativeRequestOptions,
): Promise<Dispose>;
```

This method belongs to the project-file service and requires `project.files.list` authority. Native authorization/setup failures reject its promise. Establish the subscription, deliver an initial `FileIndexStatus`, then resolve with an idempotent cleanup function. Subsequent deliveries contain coalesced status/invalidation updates, not every intermediate revision. Coordinate initial and ongoing delivery without losing an intervening committed update.

The subscription remains activation-owned even if its caller drops the cleanup handle. Cancellation, access revocation and project closure end it. Cancellation during setup must release resources even if native setup finishes late. Isolate listener failures and report them through plugin diagnostics.

Setup started during activation waits behind the native activation gate. Activation remains synchronous; perform the await inside managed async work or an asynchronous UI handler, not directly in `activate()`. The returned cleanup handle supports early unsubscribe. The approved author entry point is `@writers-ide/plugins/native`; build/profile and production transport integration remain outstanding.

Subscriptions do not make the index immediately consistent with the filesystem. Query and notification contracts must explain initialization, staleness, errors and shutdown.

## Decisions before implementation

1. **Reconciliation:** concrete timer/batch/retry defaults, bounded scan mechanics and interruption under the approved policies. Any host-owned user refresh action still needs separate UI/behavior design.
2. **Resources and native integration:** apply the approved permission grouping and bound queries, subscriptions, watcher work, queued reconciliation and memory. Finish native error/validation integration and build/profile delivery for the approved `@writers-ide/plugins/native` exports. Keep plugin scan requests out of the initial API. Internal token encoding is not a public contract.
3. **Persistence:** index schema, compatibility checks, replacement mechanics and bounded retry policy for approved automatic recovery within application-managed local storage. Keep rebuildable observations separate from permission grants and content ownership.

Native credentials, project containment and authorization remain required. This plan does not authorize file writes, general native networking or executable backend plugins.

## Validation to add

- Corrupt or incompatible indexes rebuild automatically without serving unusable records. Recovery reports status/diagnostics, returns available partial replacement data as uninitialized and leaves project files, grants and host settings unchanged. Rebuild failure is visible and does not cause unlimited retries.
- Indexed query pages release statements/transactions before returning and require no retained native pagination cursor.
- Git-ignored files and directories remain eligible for indexing. Projects without Git follow the same discovery policy. Containment, unsupported-entry handling and resource limits still apply.
- Multiple authorized projects cannot query or subscribe to one another accidentally.
- Metadata permission covers queries, status and invalidation but not contents. Read-only permission covers known-path reads but not metadata queries/status/subscriptions. Check denial and revocation independently of service-object availability.
- Opening a project starts its watcher and initial reconciliation without a plugin consumer. Periodic work continues after the last subscription ends or a plugin is disabled. Closure stops the watcher/timer and cancels pending indexing work; reopening requires fresh initialization.
- Reconciliations do not overlap within one open project. Requests during a scan combine into one pending pass, with no per-request backlog. Closure cancels active and pending work.
- Watcher setup/runtime failures leave usable records available and periodic reconciliation active. Test delayed retries with increasing failure backoff, reconciliation after restoration, retained initialization history, visible unresolved failure after a successful scan and cleanup of retries/scans/timers on closure.
- Watcher events and reconciliation converge after missed events, overflow and reopen. Known gaps publish uncertainty and request reconciliation without waiting for the timer, within scheduling/resource limits and bounded failure retries. Requests during a scan combine into one pending pass. Scan completion does not clear uncertainty from a newer unresolved gap.
- Directory-specific failures preserve records for failed areas while accessible areas continue updating. Confirm deletions only with sufficient successful observations. Report error/uncertainty, retain the correct initialization state and do not advance the successful full-reconciliation time for a partial pass. Retry within host limits; cancellation, closure and unusable databases can stop the entire pass.
- Partial scans and permission errors do not cause false deletion records; incomplete empty results do not claim empty directories.
- Cached/partial query results carry matching revision and status information. Test overlapping initialized/reconciling states, known gaps, background failures and preserved previous-reconciliation time. Known-path reads do not depend on index readiness.
- Readiness transitions invalidate subscribers even when file rows do not change.
- `queryIndex()` accepts directory/options, returns the approved entries/status/next-token page and reports completion only for indexed results at query time. Test empty partial pages without claiming filesystem completeness.
- Keyset pagination uses deterministic path ordering and validates malformed/foreign-query tokens. Tokens can be reused against current indexed state without retained native resources or single-use tracking.
- Continuation still works if the last returned entry is deleted; concurrent insertions and renames follow documented live-view semantics. Each page includes its own status/revision.
- Pagination and notifications handle concurrent index updates under the chosen consistency policy.
- Invalidation notices follow committed updates, can combine bursts, and require no per-filesystem-operation event log.
- Subscription setup rejects authorization/native failures, delivers initial status before resolving, and loses no update during attachment. Test cancellation/revocation during setup, late native completion, idempotent cleanup and isolated listener diagnostics.
- Project closure, activation revocation and cancellation release active work and subscriptions.
- Reads reject missing, replaced or prohibited targets even when old index records still exist.

No implementation or validation is claimed by this plan. See the [native service proposal](package-api-proposal.md#5-native-permissions-and-a-research-component), [implementation plan](implementation-plan.md#native-request-attribution-and-authorization) and [plugin context](context.md).
