# Project file metadata index

**Status: approved direction; not implemented.** This plan describes a SQLite-backed index of files and filesystem metadata within a registered project. It is not a document content store or an authoritative catalog of books, scenes or other application documents.

The filesystem remains the source of truth for indexed files. File contents stay in their existing storage. The index does not contain manuscript text or binary file contents. Selecting SQLite for this index does not select the project's content format or the index database's location. It also does not require sharing the host plugin-management database.

## Approved responsibilities

The host maintains the index and exposes bounded metadata queries to authorized plugins. Plugins should not each need to enumerate the filesystem to discover the same files. The author query API remains undecided; recording the index does not approve unrestricted SQL or cross-project access.

Metadata queries must finish their SQLite statements and read transactions before returning a page. Pagination must not retain a filesystem iterator, directory handle, SQLite statement or read transaction between plugin requests. A continuation can describe a query position without owning such resources. The exact continuation representation and query API still need review.

The indexer itself necessarily accesses the filesystem. Its active scans and watchers may hold native resources and must have bounded work, cancellation and cleanup. Removing resource-owning pagination does not remove the need to manage those resources.

The existing file-service requirements still apply:

- Authorize access against the activation's registered project. Metadata access and saved-file reads are separate operations.
- Preserve project-relative paths and containment. Index records are not authority to read a path.
- Do not follow prohibited links or reparse points. Identified unsupported entries disclose no target or contents.
- Keep directory views nonrecursive initially. Use explicit `'.'` for the registered project root, with empty/missing paths rejected.
- Keep the approved initial response maximum of 256 entries per page, with no caller-selected page size. Bound query work and payloads separately.
- Read saved bytes through the separately approved `ProjectFiles.read()` operation. Revalidate the actual filesystem target and permissions at read time; the index may be stale.

These constraints do not finalize the indexed query method, result types, subscription API or permission declarations for new operations.

## Change detection and reconciliation

Use native filesystem notifications to discover changes promptly. Treat events as hints, not a complete or ordered record of every change. Events can be combined or lost, and no watcher runs while the application is closed.

Run reconciliation on a timer to repair missed changes. The interval, scanning strategy and watcher/reconciler lifetime are open. Startup/reopen recovery also needs a defined reconciliation policy. A manually requested refresh is a proposed addition; its caller permissions and scheduling behavior are not approved yet.

Reconciliation compares filesystem observations with indexed metadata and updates the index. It must not treat an unreadable directory or incomplete scan as proof that all its previous entries were deleted. A stored file can change or disappear between a query and a read. SQLite transactions do not make filesystem observations atomic.

Keep indexing work off the frontend UI thread. Use bounded scanning and database updates. Design handling for watcher overflow, scan errors, project closure and interruption before selecting timer defaults or promising freshness.

## Subscriptions

A way to subscribe to filesystem-related changes is accepted direction. The exact author API and delivery semantics remain open.

**Recommendation for review:** notify plugins about committed index changes or query invalidation, rather than forwarding raw operating-system events. A plugin can then query the updated metadata. This avoids presenting an event before the corresponding index update is visible. It also gives us a place to combine event bursts. The choice of detailed changes versus invalidation notices still needs owner approval.

Subscriptions do not make the index immediately consistent with the filesystem. Query and notification contracts must explain initialization, staleness, errors and shutdown.

## Decisions before implementation

1. **Query and continuation contract:** method names, directory/filter/sort inputs, result metadata and stateless continuation validation. Keyset pagination is a recommendation, not an approved token format or schema.
2. **Freshness and readiness:** what callers see while initial indexing or reconciliation is incomplete, and whether they can explicitly request fresher observations.
3. **Notifications:** invalidation versus detailed changes, delivery timing, initial notification and activation/project cleanup.
4. **Reconciliation:** timer policy, bounded scans, handling incomplete observations, interruption and any manual-refresh operation.
5. **Native permissions and resources:** map metadata queries and subscriptions to reviewed authority; bound queries, watcher work, queued reconciliation and memory. Do not infer a new grant from the table's existence.
6. **Persistence:** index schema, database placement, migration, rebuild and recovery. Keep rebuildable observations separate from permission grants and content ownership.

Native credentials, project containment and authorization remain required. This plan does not authorize file writes, general native networking or executable backend plugins.

## Validation to add

- Indexed query pages release statements/transactions before returning and require no retained native pagination cursor.
- Multiple authorized projects cannot query or subscribe to one another accidentally.
- Watcher events and reconciliation converge after missed events, overflow and reopen.
- Partial scans and permission errors do not cause false deletion records.
- Pagination and notifications handle concurrent index updates under the chosen consistency policy.
- Project closure, activation revocation and cancellation release active work and subscriptions.
- Reads reject missing, replaced or prohibited targets even when old index records still exist.

No implementation or validation is claimed by this plan. See the [native service proposal](package-api-proposal.md#5-native-permissions-and-a-research-component), [implementation plan](implementation-plan.md#native-request-attribution-and-authorization) and [plugin context](context.md).
