import { untrack } from 'svelte';
import { behaviorErrorMessage, createBehaviorManager } from './behaviors.svelte';
import { createRenderingManager } from './rendering-manager.svelte';
import { Transaction } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import type { Dispose, PluginApiConnection } from '@writers-ide/plugins';
import type {
	EditorCommandRegistration,
	EditorContext,
	EditorEditOptions,
	EditorFailureReason,
	EditorReadOptions,
	EditorResult,
	EditorTarget,
	WordProcessingApi,
	WordProcessingService,
	WordProcessingSnapshot,
	WordProcessingSources,
} from './contracts';

// Tokens never repeat when a view or an entire provider service is replaced.
let revisionSequence = 0;
const connections = new WeakMap<
	WordProcessingService,
	(connection: PluginApiConnection) => WordProcessingApi
>();
const noop = () => {};
const failure = (reason: EditorFailureReason): EditorResult<never> => ({ ok: false, reason });

function synchronous<T>(value: T): T {
	if (
		value !== null &&
		(typeof value === 'object' || typeof value === 'function') &&
		typeof (value as { then?: unknown }).then === 'function'
	) {
		// An async callback has already executed up to its first await. We cannot undo it.
		if (value instanceof Promise) {
			void value.catch(noop);
		}
		throw new TypeError('Word-processing callbacks must return synchronously, not a thenable');
	}
	return value;
}

export function createWordProcessingService(sources: WordProcessingSources): WordProcessingService {
	let disposed = false;
	let current = new Map<string, EditorContext>();
	let activeViewId: string | null = null;
	let generation = 0;
	let deliveredGeneration = 0;
	let cleanup: Dispose | undefined;
	let pendingSubscriptions = 0;
	let notifying = false;
	let operationDepth = 0;
	const listeners = new Set<(snapshot: WordProcessingSnapshot) => void>();
	const registry = new Map<
		string,
		EditorCommandRegistration & { ownerId: string; connection?: PluginApiConnection }
	>();
	const resources = new Set<Dispose>();
	const behaviors = createBehaviorManager(sources, () => operationDepth > 0 || notifying);
	const renderers = createRenderingManager(behaviors);

	function read(): WordProcessingSnapshot {
		if (disposed) {
			return { activeViewId: null, views: [] };
		}

		const next = new Map<string, EditorContext>();
		for (const source of sources.listViews()) {
			if (source.view.isDestroyed) {
				continue;
			}
			if (next.has(source.viewId)) {
				throw new Error(`Duplicate editor view ID: ${source.viewId}`);
			}
			const previous = current.get(source.viewId);
			const state = source.view.state;
			const editable = source.view.editable;
			let revision = previous?.revision;
			if (
				!previous ||
				previous.view !== source.view ||
				previous.state !== state ||
				previous.documentId !== source.documentId ||
				previous.name !== source.name ||
				previous.editable !== editable
			) {
				revisionSequence++;
				revision = revisionSequence;
			}
			next.set(source.viewId, {
				viewId: source.viewId,
				documentId: source.documentId,
				name: source.name,
				view: source.view,
				state,
				editable,
				revision: revision!,
			});
		}
		const requestedActive = sources.activeViewId();
		const nextActive =
			requestedActive != null && next.has(requestedActive) ? requestedActive : null;
		const oldEntries = [...current.values()];
		const entries = [...next.values()];
		if (
			activeViewId !== nextActive ||
			oldEntries.length !== entries.length ||
			entries.some((entry, index) => entry.revision !== oldEntries[index]?.revision)
		) {
			generation++;
		}
		current = next;
		activeViewId = nextActive;
		return Object.freeze({
			activeViewId,
			views: Object.freeze(
				entries.map(({ view: _view, state: _state, ...snapshot }) => Object.freeze(snapshot)),
			),
		});
	}

	function notify(): void {
		if (disposed || notifying) {
			return;
		}
		notifying = true;
		try {
			read();
			while (!disposed && deliveredGeneration !== generation) {
				deliveredGeneration = generation;
				for (const listener of [...listeners]) {
					if (!disposed && listeners.has(listener)) {
						try {
							// Earlier listeners can change trusted sources; never deliver an old snapshot.
							listener(read());
						} catch (error) {
							console.error('Word-processing subscriber failed', error);
						}
					}
				}
				read();
			}
		} finally {
			notifying = false;
		}
	}

	function stopIfUnused(): void {
		if (listeners.size === 0 && (pendingSubscriptions === 0 || disposed)) {
			const stop = cleanup;
			cleanup = undefined;
			stop?.();
		}
	}

	function subscribe(listener: (snapshot: WordProcessingSnapshot) => void): Dispose {
		pendingSubscriptions++;
		let release = noop;
		const errors: unknown[] = [];
		try {
			release = subscribeListener(listener);
		} catch (error) {
			errors.push(error);
		} finally {
			pendingSubscriptions--;
		}
		try {
			stopIfUnused();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Word-processing subscription failed');
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		return release;
	}

	function subscribeListener(listener: (snapshot: WordProcessingSnapshot) => void): Dispose {
		if (disposed) {
			return noop;
		}
		if (!cleanup) {
			let stopped = false;
			let stopEffect: Dispose | undefined;
			let stopSource: Dispose | undefined;
			const stop = () => {
				if (stopped) {
					return;
				}
				stopped = true;
				if (cleanup === stop) {
					cleanup = undefined;
				}
				try {
					stopEffect?.();
				} finally {
					stopSource?.();
				}
			};
			// Publish the session before calling external setup, which may reenter or dispose.
			cleanup = stop;

			try {
				stopEffect = $effect.root(() => {
					$effect(() => {
						read();
						untrack(notify);
					});
				});
				stopSource = untrack(() => sources.subscribe(() => untrack(notify)));
				if (stopped) {
					stopSource();
				}
			} catch (error) {
				try {
					stop();
				} catch (cleanupError) {
					throw new AggregateError([error, cleanupError], 'Word-processing source setup failed');
				}
				throw error;
			}
		}
		if (disposed) {
			return noop;
		}
		const deliver = (snapshot: WordProcessingSnapshot) => listener(snapshot);
		const wasNotifying = notifying;
		try {
			untrack(notify);
			if (disposed) {
				return noop;
			}
			listeners.add(deliver);
			notifying = true;
			deliver(untrack(read));
		} catch (error) {
			listeners.delete(deliver);
			throw error;
		} finally {
			notifying = wasNotifying;
		}
		untrack(notify);
		return () => {
			listeners.delete(deliver);
			stopIfUnused();
		};
	}

	function owned(dispose: Dispose, connection?: PluginApiConnection): Dispose {
		let live = true;
		let releaseOwnership: Dispose | undefined;
		const release = () => {
			if (!live) {
				return;
			}
			live = false;
			resources.delete(disposeResource);
			dispose();
		};
		const disposeResource = () => {
			if (releaseOwnership) {
				releaseOwnership();
			} else {
				release();
			}
		};
		resources.add(disposeResource);
		try {
			releaseOwnership = connection?.own(release);
		} catch (error) {
			release();
			throw error;
		}
		if (disposed) {
			disposeResource();
		}
		return disposeResource;
	}

	function createApi(connection?: PluginApiConnection): WordProcessingApi {
		function status(options?: EditorReadOptions): EditorFailureReason | undefined {
			if (connection?.signal.aborted) {
				return 'revoked';
			}
			if (disposed) {
				return 'unavailable';
			}
			if (options?.signal?.aborted) {
				return 'cancelled';
			}
			return undefined;
		}

		function validate(
			target: EditorTarget,
			options?: EditorReadOptions,
			editing = false,
		): EditorResult<EditorContext> {
			const reason = status(options);
			if (reason) {
				return failure(reason);
			}
			read();
			const entry = current.get(target.viewId);
			if (!entry) {
				return failure('unavailable');
			}
			if (entry.documentId !== target.documentId || entry.revision !== target.revision) {
				return failure('stale');
			}
			if (options?.requireActive && activeViewId !== target.viewId) {
				return failure('stale');
			}
			if (editing && !entry.editable) {
				return failure('readonly');
			}
			return { ok: true, value: entry };
		}

		function operate<T>(
			target: EditorTarget,
			callback: (context: EditorContext) => T,
			options: EditorReadOptions | undefined,
			editing: boolean,
		): EditorResult<T> {
			const initial = validate(target, options, editing);
			if (!initial.ok) {
				return initial;
			}
			if (editing && (operationDepth > 0 || notifying || behaviors.isBusy())) {
				return failure('busy');
			}
			operationDepth++;
			try {
				const value = synchronous(callback(initial.value));
				const final = validate(target, options, editing);
				if (!final.ok) {
					return final;
				}
				return { ok: true, value };
			} finally {
				operationDepth--;
			}
		}

		function edit(
			target: EditorTarget,
			build: (current: EditorContext) => Transaction | null,
			options?: EditorEditOptions,
		): EditorResult<boolean> {
			return perform(
				target,
				(context) => ({ transaction: synchronous(build(context)), handled: true }),
				options,
				false,
			);
		}

		function perform(
			target: EditorTarget,
			build: (context: EditorContext) => { transaction: Transaction | null; handled: boolean },
			options: EditorEditOptions | undefined,
			command: boolean,
		): EditorResult<boolean> {
			const built = operate(target, build, options, true);
			if (!built.ok) {
				return built;
			}
			const { transaction, handled } = built.value;
			const final = validate(target, options, true);
			if (!final.ok) {
				return final;
			}
			if (transaction !== null && !(transaction instanceof Transaction)) {
				throw new TypeError('Editor callbacks must return a ProseMirror Transaction or null');
			}
			if (transaction && transaction.before !== final.value.state.doc) {
				return failure('stale');
			}
			if (!handled || (!transaction && !command)) {
				return { ok: true, value: false };
			}
			if (transaction) {
				final.value.view.dispatch(transaction);
			}
			// Dispatch may synchronously close/replace the view or revoke this connection.
			if (options?.focus && !status(options)) {
				read();
				const live = current.get(target.viewId);
				if (
					live?.view === final.value.view &&
					live.documentId === target.documentId &&
					live.editable &&
					(!options.requireActive || activeViewId === target.viewId)
				) {
					live.view.focus();
				}
			}
			untrack(notify);
			return { ok: true, value: true };
		}

		function runCommand(
			target: EditorTarget,
			command: Command,
			options?: EditorEditOptions,
		): EditorResult<boolean> {
			return perform(
				target,
				(context) => {
					let transaction: Transaction | null = null;
					let count = 0;
					let open = true;
					const capture = (next: Transaction) => {
						if (!open || status(options)) {
							return;
						}
						count++;
						if (count > 1) {
							throw new TypeError('A word-processing command may dispatch at most one transaction');
						}
						transaction = next;
					};
					let handled: boolean;
					try {
						handled = synchronous(
							command(
								context.state,
								connection ? connection.guard(capture) : capture,
								context.view,
							),
						);
					} finally {
						open = false;
					}
					if (typeof handled !== 'boolean' || count > 1) {
						throw new TypeError(
							'Commands must return a synchronous boolean and dispatch at most once',
						);
					}
					return { transaction, handled };
				},
				options,
				true,
			);
		}

		return {
			snapshot: () => (status() ? { activeViewId: null, views: [] } : read()),
			subscribe(listener) {
				if (status()) {
					return noop;
				}
				const guarded = (snapshot: WordProcessingSnapshot) => {
					if (!status()) {
						listener(snapshot);
					}
				};
				return owned(subscribe(connection ? connection.guard(guarded) : guarded), connection);
			},
			inspect: (target, callback, options) => operate(target, callback, options, false),
			edit,
			runCommand,
			registerNodeView(registration) {
				if (status()) {
					return noop;
				}
				return owned(
					renderers.registerNodeView(
						registration,
						connection?.consumerId ?? 'writers-ide.word-processing',
						connection?.signal,
						connection
							? (failure) => {
									connection.reportError(
										`Editor renderer ${failure.id} (${failure.phase}${failure.viewId ? `, view ${failure.viewId}` : ''}) failed: ${behaviorErrorMessage(failure.error)}`,
									);
								}
							: undefined,
					),
					connection,
				);
			},
			registerMarkView(registration) {
				if (status()) {
					return noop;
				}
				return owned(
					renderers.registerMarkView(
						registration,
						connection?.consumerId ?? 'writers-ide.word-processing',
						connection?.signal,
						connection
							? (failure) => {
									connection.reportError(
										`Editor renderer ${failure.id} (${failure.phase}${failure.viewId ? `, view ${failure.viewId}` : ''}) failed: ${behaviorErrorMessage(failure.error)}`,
									);
								}
							: undefined,
					),
					connection,
				);
			},
			registerBehavior(registration) {
				if (status()) {
					return noop;
				}
				return owned(
					behaviors.register(
						registration,
						connection?.consumerId ?? 'writers-ide.word-processing',
						connection?.signal,
						connection
							? (failure) => {
									const viewId = failure.viewId ? `, view ${failure.viewId}` : '';
									connection.reportError(
										new Error(
											`Behavior ${failure.id} (${failure.phase}${viewId}): ${behaviorErrorMessage(failure.error)}`,
											{ cause: failure.error },
										),
									);
								}
							: undefined,
					),
					connection,
				);
			},
			behaviors: () => (status() ? [] : behaviors.behaviors()),
			subscribeBehaviors(listener) {
				if (status()) {
					return noop;
				}
				return owned(
					behaviors.subscribe(connection ? connection.guard(listener) : listener),
					connection,
				);
			},
			registerCommand(registration) {
				if (status()) {
					return noop;
				}
				if (
					!registration.id.trim() ||
					!registration.name.trim() ||
					typeof registration.command !== 'function'
				) {
					throw new TypeError('Command registrations require a nonempty ID, name and command');
				}
				if (registry.has(registration.id)) {
					throw new Error(`Duplicate editor command ID: ${registration.id}`);
				}
				const entry = {
					...registration,
					ownerId: connection?.consumerId ?? 'writers-ide.word-processing',
					connection,
				};
				registry.set(entry.id, entry);
				return owned(() => {
					if (registry.get(entry.id) === entry) {
						registry.delete(entry.id);
					}
				}, connection);
			},
			executeCommand(target, id, options) {
				const reason = status(options);
				if (reason) {
					return failure(reason);
				}
				const entry = registry.get(id);
				if (!entry || entry.connection?.signal.aborted) {
					return failure('unknown-command');
				}
				return runCommand(
					target,
					(state, dispatch, view) => {
						const result = synchronous(entry.command(state, dispatch, view));
						// The command's owner can stop while a different consumer executes it.
						if (entry.connection?.signal.aborted || registry.get(id) !== entry) {
							return false;
						}
						return result;
					},
					options,
				);
			},
			commands: () =>
				status()
					? []
					: [...registry.values()]
							.filter((entry) => !entry.connection?.signal.aborted)
							.map(({ id, name, ownerId }) => Object.freeze({ id, name, ownerId })),
			applyResult: (target, result, apply, options) =>
				edit(target, (context) => apply(result, context), options),
		};
	}

	const service: WordProcessingService = {
		...createApi(),
		dispose() {
			if (disposed) {
				return;
			}
			behaviors.assertDisposal();

			disposed = true;
			listeners.clear();
			current.clear();
			registry.clear();
			const errors: unknown[] = [];
			for (const release of [...resources].reverse()) {
				try {
					release();
				} catch (error) {
					errors.push(error);
				}
			}

			try {
				behaviors.dispose();
			} catch (error) {
				errors.push(error);
			}
			try {
				stopIfUnused();
			} catch (error) {
				errors.push(error);
			}
			if (errors.length) {
				throw new AggregateError(errors, 'Word-processing cleanup failed');
			}
		},
	};
	connections.set(service, createApi);
	return service;
}

/** A plain method-only provider facade, scoped to both connection endpoints. */
export function createWordProcessingConnection(
	service: WordProcessingService,
	connection: PluginApiConnection,
): WordProcessingApi {
	const create = connections.get(service);
	if (!create) {
		throw new TypeError('Expected a service created by createWordProcessingService');
	}
	return create(connection);
}
