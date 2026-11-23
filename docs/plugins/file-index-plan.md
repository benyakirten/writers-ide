# Project file metadata index

**Status: approved direction; not implemented.** This plan describes a SQLite-backed index of files and filesystem metadata within a registered project. It is not a document content store or an authoritative catalog of books, scenes or other application documents.

The filesystem remains the source of truth for indexed files. File contents stay in their existing storage. The index does not contain manuscript text or binary file contents. Selecting SQLite for this index does not select the project's content format or the index database's location. It also does not require sharing the host plugin-management database.

## Approved responsibilities

The host maintains the index and exposes bounded metadata queries to authorized plugins. Plugins should not each need to enumerate the filesystem to discover the same files. The author query API remains undecided; recording the index does not approve unrestricted SQL or cross-project access.

Metadata queries must finish their SQLite statements and read transactions before returning a page. Pagination must not retain a filesystem iterator, directory handle, SQLite statement or read transaction between plugin requests. Continuations use the approved stateless keyset design below. The query method and page envelope still need review.

The indexer itself necessarily accesses the filesystem. Its active scans and watchers may hold native resources and must have bounded work, cancellation and cleanup. Removing resource-owning pagination does not remove the need to manage those resources.

The existing file-service requirements still apply:

- Authorize access against the activation's registered project. Metadata access and saved-file reads are separate operations.
- Preserve project-relative paths and containment. Index records are not authority to read a path.
- Do not follow prohibited links or reparse points. Identified unsupported entries disclose no target or contents.
- Keep directory views nonrecursive initially. Use explicit `'.'` for the registered project root, with empty/missing paths rejected.
- Keep the approved initial response maximum of 256 entries per page, with no caller-selected page size. Bound query work and payloads separately.
- Read saved bytes through the separately approved `ProjectFiles.read()` operation. Revalidate the actual filesystem target and permissions at read time; the index may be stale.

These constraints do not finalize the indexed query method, page envelope or authority for future operations such as manual refresh. Entry/status types and the async subscription signature are approved below.

## Query pagination

**Approved strategy; not implemented:** use opaque stateless keyset continuation tokens, initially with deterministic non-locale-aware path ordering. A token describes the last ordering key, not an open iterator or database transaction. Every request finishes its native database resources before returning.

Validate token structure and binding to the live project opening and directory/query. Check the caller's active authorization on every use. The token grants no authority; its contents and internal encoding are not an author contract. Do not expose an absolute filesystem location. Use the same ordering comparison for page queries and continuation boundaries.

Tokens are reusable while their project/query scope remains valid. Each use queries the current index and returns its own status/revision. No single-use tracking or resource-reclamation timeout is needed. Deleting the last returned entry does not prevent continuation because its key remains sufficient. Token reuse does not provide a historical snapshot or freeze the index at a previous revision.

Concurrent insertions before the continuation point may require refresh to appear. Renames and other changes can affect membership or repeat a file under a new path. Use invalidation to refresh relevant queries. Do not promise duplicate-free traversal or a stable snapshot across pages of a changing index.

The initial API does not provide direct page-number jumps or configurable ordering. Directory-first ordering, metadata sorting and random-access navigation are future candidates needing explicit continuation semantics. The method name, page envelope, completion signaling and query inputs still need approval.

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

These are cached observations, not guaranteed current properties. Metadata inspection failures remain visible through index uncertainty/error reporting; they are not a reason to classify an unknown entry as unsupported or declare its deletion. Modification time does not prove unchanged contents. Saved reads still validate the actual target and grants.

The entry exposes no file contents, link target, checksum or stable application-document ID. A path is a filesystem location and may change on rename. This approves the entry type, not a database schema or query/page/continuation contract.

## Permissions

**Approved grouping; not implemented:** `project.files.list` with resource `project` covers indexed metadata queries, reading `FileIndexStatus` and subscribing to coalesced invalidation. `project.files.read` remains separately required for saved file contents. Neither permission implies the other.

A component with only read permission may read a known permitted path but cannot enumerate indexed metadata, read index status or subscribe to index changes. A metadata-only component can observe indexed state without reading contents. Each operation still needs authorization even when the shared project-file service object is non-null.

This selects no new permission name and does not grant unrestricted SQL, cross-project metadata, unsaved editor content, raw OS-event streams or caller-triggered rescans. Manual-refresh behavior and any associated authority need separate review. Preserve activation/project scope, mandatory consent and revocation for queries and subscriptions.

## Change detection and reconciliation

Use native filesystem notifications to discover changes promptly. Treat events as hints, not a complete or ordered record of every change. Events can be combined or lost, and no watcher runs while the application is closed.

Run reconciliation on a timer to repair missed changes. The interval, scanning strategy and watcher/reconciler lifetime are open. Startup/reopen recovery also needs a defined reconciliation policy. A manually requested refresh is a proposed addition; its caller permissions and scheduling behavior are not approved yet.

Reconciliation compares filesystem observations with indexed metadata and updates the index. It must not treat an unreadable directory or incomplete scan as proof that all its previous entries were deleted. A stored file can change or disappear between a query and a read. SQLite transactions do not make filesystem observations atomic.

Keep indexing work off the frontend UI thread. Use bounded scanning and database updates. Design handling for watcher overflow, scan errors, project closure and interruption before selecting timer defaults or promising freshness.

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
- `lastError` is a display-only summary of background indexing failure, cleared after successful reconciliation. Do not parse it as an error code or expose credentials/absolute paths in it.

A query that cannot run still rejects under the native error model. A background scan error can instead coexist with useful indexed results and status. The type and field meanings are approved. The subscription signature is approved below; the query API and native export grouping still need review.

Ready means the required index initialization has completed. It does not promise a frozen filesystem, immediate watcher processing or a consistent snapshot across separate page requests. Reads of known paths remain separately authorized filesystem operations and do not wait for index readiness.

Readiness transitions must notify subscribers even when no file entries changed. Make the new state query-visible before delivering its invalidation. A way to explicitly request fresher observations is still under review with manual refresh.

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

Setup started during activation waits behind the native activation gate. Activation remains synchronous; perform the await inside managed async work or an asynchronous UI handler, not directly in `activate()`. The returned cleanup handle supports early unsubscribe. Exact native export grouping and production transport integration remain outstanding.

Subscriptions do not make the index immediately consistent with the filesystem. Query and notification contracts must explain initialization, staleness, errors and shutdown.

## Decisions before implementation

1. **Query API:** method name, directory/query inputs, page envelope and completion signaling using the approved entry/status types and opaque live keyset continuation. Internal token encoding is not a public contract.
2. **Reconciliation:** timer policy, bounded scans, handling incomplete observations, interruption and any manual-refresh/freshness request.
3. **Resources and future authority:** apply the approved metadata/read permission grouping and bound queries, subscriptions, watcher work, queued reconciliation and memory. Review authority for any manual-refresh operation separately.
4. **Persistence:** index schema, database placement, migration, rebuild and recovery. Keep rebuildable observations separate from permission grants and content ownership.

Native credentials, project containment and authorization remain required. This plan does not authorize file writes, general native networking or executable backend plugins.

## Validation to add

- Indexed query pages release statements/transactions before returning and require no retained native pagination cursor.
- Multiple authorized projects cannot query or subscribe to one another accidentally.
- Metadata permission covers queries, status and invalidation but not contents. Read-only permission covers known-path reads but not metadata queries/status/subscriptions. Check denial and revocation independently of service-object availability.
- Watcher events and reconciliation converge after missed events, overflow and reopen.
- Partial scans and permission errors do not cause false deletion records; incomplete empty results do not claim empty directories.
- Cached/partial query results carry matching revision and status information. Test overlapping initialized/reconciling states, known gaps, background failures and preserved previous-reconciliation time. Known-path reads do not depend on index readiness.
- Readiness transitions invalidate subscribers even when file rows do not change.
- Keyset pagination uses deterministic path ordering and validates malformed/foreign-query tokens. Tokens can be reused against current indexed state without retained native resources or single-use tracking.
- Continuation still works if the last returned entry is deleted; concurrent insertions and renames follow documented live-view semantics. Each page includes its own status/revision.
- Pagination and notifications handle concurrent index updates under the chosen consistency policy.
- Invalidation notices follow committed updates, can combine bursts, and require no per-filesystem-operation event log.
- Subscription setup rejects authorization/native failures, delivers initial status before resolving, and loses no update during attachment. Test cancellation/revocation during setup, late native completion, idempotent cleanup and isolated listener diagnostics.
- Project closure, activation revocation and cancellation release active work and subscriptions.
- Reads reject missing, replaced or prohibited targets even when old index records still exist.

No implementation or validation is claimed by this plan. See the [native service proposal](package-api-proposal.md#5-native-permissions-and-a-research-component), [implementation plan](implementation-plan.md#native-request-attribution-and-authorization) and [plugin context](context.md).
