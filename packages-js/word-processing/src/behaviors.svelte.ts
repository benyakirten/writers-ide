import { untrack } from 'svelte';
import { wrapRenderer } from './renderers';
import { createRendererLayoutObserver } from './renderer-layout';
import type { RendererType } from './renderers';
import { Plugin, Selection, Transaction } from 'prosemirror-state';
import { Slice } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { Dispose } from '@writers-ide/plugins';
import type {
	EditorBehaviorFailure,
	EditorBehaviorRegistration,
	EditorBehaviorSnapshot,
	WordProcessingSources,
} from './contracts';

type Source = ReturnType<WordProcessingSources['listViews']>[number];
// Callback signatures vary across ProseMirror props; erasure is confined to this adapter.
type Callback = (...args: never[]) => unknown;
type Instance = { source: Source; controller: AbortController; plugins: Plugin[] };
type Entry = {
	registration: EditorBehaviorRegistration;
	renderer?: RendererType;
	ownerId: string;
	signal?: AbortSignal;
	onError?: (failure: EditorBehaviorFailure) => void;
	detach?: Dispose;
	active: boolean;
	removed: boolean;
	error?: string;
	instances: Map<string, Instance>;
};
// ProseMirror's runtime plugin key is intentionally not public in its declarations.
const key = (plugin: Plugin) => (plugin as unknown as { key: string }).key;
function syncResult<T>(value: T): T {
	if (value != null && typeof (value as { then?: unknown }).then === 'function') {
		if (value instanceof Promise) {
			void value.catch(() => {});
		}
		throw new TypeError('Behavior factories and callbacks must be synchronous');
	}
	return value;
}

export function behaviorErrorMessage(error: unknown): string {
	try {
		return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
	} catch {
		return 'Unknown thrown value';
	}
}

function validateResult(phase: string, result: unknown) {
	const name = phase.split('.').at(-1)!;
	let valid = true;
	if (phase === 'filterTransaction' || name === 'editable' || name === 'dragCopies') {
		valid = typeof result === 'boolean';
	} else if (phase === 'appendTransaction') {
		valid = result == null || result instanceof Transaction;
	} else if (name.startsWith('handle') || phase.startsWith('props.handleDOMEvents.')) {
		valid = result === undefined || typeof result === 'boolean';
	} else if (
		name === 'transformPastedHTML' ||
		name === 'transformPastedText' ||
		name === 'clipboardTextSerializer'
	) {
		valid = typeof result === 'string';
	} else if (
		name === 'transformPasted' ||
		name === 'transformCopied' ||
		name === 'clipboardTextParser'
	) {
		valid = result instanceof Slice;
	} else if (name === 'createSelectionBetween') {
		valid = result === null || result instanceof Selection;
	} else if (name === 'attributes') {
		valid =
			result !== null &&
			typeof result === 'object' &&
			Object.values(result).every((value) => typeof value === 'string');
	} else if (name === 'decorations') {
		valid =
			result == null ||
			(typeof result === 'object' &&
				['map', 'locals', 'forChild', 'eq'].every(
					(method) => typeof (result as Record<string, unknown>)[method] === 'function',
				));
	}
	if (!valid) {
		throw new TypeError(`Invalid synchronous return value from behavior ${phase}`);
	}
}

/** Owns behaviors, never EditorViews. No application singletons or document traversal. */
export function createBehaviorManager(sources: WordProcessingSources, busy: () => boolean) {
	const entries = new Map<string, Entry>();
	const managed = new WeakSet<Plugin>();
	const rendererPlugins = new WeakSet<Plugin>();
	const layouts = new Map<
		string,
		{ source: Source; observer: ReturnType<typeof createRendererLayoutObserver> }
	>();
	const pendingLayoutChanges = new Map<string, Source>();
	const retired = new Set<Instance>();
	const listeners = new Set<(snapshot: readonly EditorBehaviorSnapshot[]) => void>();
	let syncing = false;
	let resync = false;
	let starting = false;
	let depth = 0;
	let notifying = false;
	let disposed = false;
	let queued = false;
	let mutation = 0;
	let stop: Dispose | undefined;

	function sourceIsLive(source: Source) {
		return (
			!source.view.isDestroyed &&
			sources
				.listViews()
				.some(
					(current) =>
						current.viewId === source.viewId &&
						current.view === source.view &&
						current.documentId === source.documentId,
				)
		);
	}

	function flushFinalLayoutChanges() {
		if (!disposed) {
			return;
		}
		for (const [viewId, source] of pendingLayoutChanges) {
			if (!sourceIsLive(source)) {
				pendingLayoutChanges.delete(viewId);
				continue;
			}
			if (source.view.state.plugins.some((plugin) => rendererPlugins.has(plugin))) {
				continue;
			}
			// The observer's frame is canceled during teardown. Fallback geometry
			// still needs one notification after physical renderer removal.
			pendingLayoutChanges.delete(viewId);
			sources.invalidateLayout?.(viewId);
		}
	}

	function layoutFor(source: Source) {
		if (!sources.invalidateLayout || disposed || source.view.isDestroyed) {
			return undefined;
		}
		let layout = layouts.get(source.viewId);
		if (
			layout &&
			(layout.source.view !== source.view || layout.source.documentId !== source.documentId)
		) {
			layout.observer.dispose();
			layouts.delete(source.viewId);
			layout = undefined;
		}
		if (!layout) {
			layout = {
				source,
				observer: createRendererLayoutObserver(source.view, source.viewId, (viewId) => {
					if (!sourceIsLive(source)) {
						return;
					}
					pendingLayoutChanges.delete(viewId);
					sources.invalidateLayout?.(viewId);
				}),
			};
			layouts.set(source.viewId, layout);
		}
		return layout.observer;
	}

	function snapshots(): readonly EditorBehaviorSnapshot[] {
		return Object.freeze(
			[...entries.values()]
				.filter((entry) => !entry.renderer)
				.map((entry) =>
					Object.freeze({
						id: entry.registration.id,
						name: entry.registration.name,
						ownerId: entry.ownerId,
						priority: entry.registration.priority ?? 0,
						...(entry.registration.views ? { views: entry.registration.views } : {}),
						status: entry.active ? ('active' as const) : ('failed' as const),
						...(entry.error === undefined ? {} : { error: entry.error }),
					}),
				),
		);
	}
	function notify() {
		if (notifying || disposed) {
			return;
		}
		notifying = true;
		try {
			const snapshot = snapshots();
			for (const listener of [...listeners]) {
				try {
					listener(snapshot);
				} catch (error) {
					console.error('Behavior subscriber failed', error);
				}
			}
		} finally {
			notifying = false;
		}
	}
	function schedule() {
		if (!queued) {
			queued = true;
			queueMicrotask(() => {
				queued = false;
				sync();
			});
		}
	}
	function retire(instance: Instance) {
		retired.add(instance);
		instance.controller.abort();
	}
	function report(entry: Entry, phase: string, error: unknown, viewId?: string) {
		const failure: EditorBehaviorFailure = {
			ownerId: entry.ownerId,
			id: entry.registration.id,
			viewId,
			phase,
			error,
		};
		const reporters = [entry.onError, sources.reportBehaviorError?.bind(sources)];
		if (!reporters.some(Boolean)) {
			console.error(`Behavior ${failure.id} (${phase}) failed`, error);
		}
		for (const reporter of reporters) {
			try {
				reporter?.(failure);
			} catch (reportError) {
				console.error('Behavior error reporter failed', reportError);
			}
		}
	}
	function fail(entry: Entry, phase: string, error: unknown, viewId?: string) {
		if (entry.active) {
			mutation++;
			entry.active = false;
			entry.error = behaviorErrorMessage(error);
			for (const instance of entry.instances.values()) {
				retire(instance);
			}
			entry.instances.clear();
			schedule();
			notify();
		}
		report(entry, phase, error, viewId);
	}
	function wrap(original: Plugin, entry: Entry, instance: Instance): Plugin {
		const live = () =>
			entry.active &&
			!entry.removed &&
			!entry.signal?.aborted &&
			!instance.controller.signal.aborted;
		function callback(
			fn: Callback,
			receiver: unknown,
			phase: string,
			fallback: (...args: unknown[]) => unknown,
			cleanup = false,
		) {
			return function (this: unknown, ...args: unknown[]) {
				if (!cleanup && !live()) {
					return phase === 'filterTransaction' ? true : fallback(...args);
				}
				depth++;
				try {
					let result = syncResult(fn.apply(receiver, args as never[]));
					validateResult(phase, result);
					if (phase === 'appendTransaction' && result != null) {
						if (sources.prepareTransaction) {
							result = syncResult(sources.prepareTransaction(result as Transaction));
							validateResult(phase, result);
						}
						if (
							!(result instanceof Transaction) ||
							result.before !== (args[2] as EditorState).doc
						) {
							throw new TypeError(
								'Appended transactions must start from the supplied current state',
							);
						}
					}
					return result;
				} catch (error) {
					fail(entry, phase, error, instance.source.viewId);
					if (phase === 'state.init') {
						throw error;
					}
					return fallback(...args);
				} finally {
					depth--;
				}
			};
		}
		function props(value: object, path: string): Record<string, unknown> {
			const result: Record<string, unknown> = {};
			for (const name of Object.keys(value)) {
				const item = (value as Record<string, unknown>)[name];
				if (entry.renderer && (name === 'nodeViews' || name === 'markViews')) {
					const constructors: Record<string, unknown> = {};
					for (const [type, constructor] of Object.entries(item as object)) {
						constructors[type] = wrapRenderer(
							constructor as Callback,
							entry.renderer.kind,
							live,
							(fn) => {
								depth++;
								try {
									return fn();
								} finally {
									depth--;
								}
							},
							(phase, error) => fail(entry, `renderer.${phase}`, error, instance.source.viewId),
							sources.invalidateLayout
								? (dom, contentDOM) =>
										layoutFor(instance.source)?.observe(dom, contentDOM) ?? (() => {})
								: undefined,
						);
					}
					result[name] = constructors;
				} else if (name === 'handleDOMEvents' && item && typeof item === 'object') {
					result[name] = props(item, `${path}.${name}`);
				} else if (typeof item === 'function') {
					result[name] = callback(item as Callback, original, `${path}.${name}`, (...args) => {
						if (name.startsWith('transform')) {
							return args[0];
						}
						if (name === 'clipboardTextSerializer') {
							return (args[0] as Slice).content.textBetween(
								0,
								(args[0] as Slice).content.size,
								'\n\n',
							);
						}
						if (name === 'editable') {
							return true;
						}
						if (name === 'attributes') {
							return {};
						}
						return name === 'decorations' || name === 'createSelectionBetween'
							? null
							: name.startsWith('handle') ||
								  name === 'dragCopies' ||
								  path === 'props.handleDOMEvents'
								? false
								: undefined;
					});
				} else {
					result[name] = item;
				}
			}
			return result;
		}
		const spec = { ...original.spec };
		if (spec.state) {
			spec.state = {
				...spec.state,
				init: callback(
					spec.state.init,
					original,
					'state.init',
					() => undefined,
				) as typeof spec.state.init,
				apply: callback(
					spec.state.apply,
					original,
					'state.apply',
					(_tr, previous) => previous,
				) as typeof spec.state.apply,
			};
		}
		if (spec.filterTransaction) {
			spec.filterTransaction = callback(
				spec.filterTransaction,
				original,
				'filterTransaction',
				() => false,
			) as typeof spec.filterTransaction;
		}
		if (spec.appendTransaction) {
			spec.appendTransaction = callback(
				spec.appendTransaction,
				original,
				'appendTransaction',
				() => null,
			) as typeof spec.appendTransaction;
		}
		if (spec.view) {
			const create = spec.view;
			spec.view = callback(
				(...args: unknown[]) => {
					const resource = syncResult(create.apply(original.spec, args as [Source['view']]));
					if (
						!resource ||
						typeof resource !== 'object' ||
						(resource.update !== undefined && typeof resource.update !== 'function') ||
						(resource.destroy !== undefined && typeof resource.destroy !== 'function')
					) {
						throw new TypeError(
							'Behavior view must return an object with optional update/destroy callbacks',
						);
					}
					let destroyed = false;
					const result = {
						update: resource.update
							? callback(resource.update, resource, 'view.update', () => undefined)
							: undefined,
						destroy: () => {
							if (destroyed) {
								return;
							}
							destroyed = true;
							if (resource.destroy) {
								callback(resource.destroy, resource, 'view.destroy', () => undefined, true)();
							}
						},
					};
					if (!live()) {
						result.destroy();
					}
					return result;
				},
				original,
				'view',
				() => ({}),
			) as typeof spec.view;
		}
		// Inherit the actual generated key, including for unkeyed upstream plugins.
		const wrapped = Object.create(original) as Plugin;
		Object.defineProperties(wrapped, {
			spec: { value: spec },
			props: { value: props(original.props, 'props') },
		});
		managed.add(wrapped);
		if (entry.renderer) {
			rendererPlugins.add(wrapped);
		}
		return wrapped;
	}
	function create(entry: Entry, source: Source): Instance {
		const instance: Instance = { source, controller: new AbortController(), plugins: [] };
		entry.instances.set(source.viewId, instance);
		depth++;
		try {
			const result = syncResult(
				entry.registration.create({
					...source,
					state: source.view.state,
					signal: instance.controller.signal,
					...(entry.renderer
						? {
								reportError(error: unknown) {
									if (
										!entry.active ||
										entry.removed ||
										entry.signal?.aborted ||
										instance.controller.signal.aborted ||
										source.view.isDestroyed
									) {
										return;
									}
									if (
										!sources
											.listViews()
											.some(
												(current) =>
													current.viewId === source.viewId &&
													current.documentId === source.documentId &&
													current.view === source.view,
											)
									) {
										return;
									}
									depth++;
									try {
										fail(entry, 'renderer.render', error, source.viewId);
									} finally {
										depth--;
									}
								},
							}
						: {}),
				}),
			);
			const plugins = Array.isArray(result) ? result : [result];
			if (plugins.some((plugin) => !(plugin instanceof Plugin))) {
				throw new TypeError('Behavior factories must return a Plugin or a Plugin array');
			}
			for (const plugin of plugins) {
				if (!entry.renderer && (plugin.props.nodeViews || plugin.props.markViews)) {
					throw new TypeError('Use dedicated registerNodeView/registerMarkView APIs');
				}
				instance.plugins.push(wrap(plugin, entry, instance));
			}
			return instance;
		} catch (error) {
			fail(entry, 'create', error, source.viewId);
			throw error;
		} finally {
			depth--;
		}
	}
	function reconcile() {
		const started = mutation;
		const pendingRetired = [...retired];
		const liveSources = () =>
			layouts.size > 0 || [...entries.values()].some((entry) => entry.active)
				? sources.listViews().filter((source) => !source.view.isDestroyed)
				: [];
		const views = liveSources().map((source) => ({ ...source }));
		if (new Set(views.map((source) => source.viewId)).size !== views.length) {
			throw new Error('Duplicate editor view IDs in behavior sources');
		}
		for (const [viewId, layout] of layouts) {
			if (
				!views.some(
					(source) =>
						source.viewId === viewId &&
						source.view === layout.source.view &&
						source.documentId === layout.source.documentId,
				)
			) {
				layout.observer.dispose();
				layouts.delete(viewId);
				pendingLayoutChanges.delete(viewId);
			}
		}
		const states = new Map(views.map((source) => [source.view, source.view.state]));
		const fresh = () => {
			const latest = liveSources();
			return (
				started === mutation &&
				latest.length === views.length &&
				latest.every(
					(source, index) =>
						source.view === views[index].view &&
						source.viewId === views[index].viewId &&
						source.documentId === views[index].documentId,
				) &&
				[...states].every(([view, state]) => !view.isDestroyed && view.state === state)
			);
		};
		for (const entry of entries.values()) {
			for (const [id, instance] of entry.instances) {
				const source = views.find((item) => item.viewId === id);
				if (
					!entry.active ||
					!source ||
					source.view !== instance.source.view ||
					source.documentId !== instance.source.documentId
				) {
					retire(instance);
					entry.instances.delete(id);
				}
			}
			if (!entry.active || entry.removed || disposed) {
				continue;
			}
			for (const source of views) {
				if (!entry.active || entry.removed || disposed) {
					break;
				}
				if (
					(!entry.registration.views || entry.registration.views.includes(source.viewId)) &&
					!entry.instances.has(source.viewId)
				) {
					try {
						create(entry, source);
						if (!fresh()) {
							return false;
						}
					} catch {
						break;
					}
				}
			}
		}
		if (!fresh()) {
			return false;
		}
		const ordered = [...entries.values()]
			.filter((entry) => entry.active && !entry.removed)
			.sort((a, b) => (b.registration.priority ?? 0) - (a.registration.priority ?? 0));
		const targets = new Map(views.map((source) => [source.view, source]));
		for (const instance of retired) {
			if (!targets.has(instance.source.view)) {
				targets.set(instance.source.view, instance.source);
			}
		}
		for (const source of targets.values()) {
			if (!source.view.isDestroyed && !states.has(source.view)) {
				states.set(source.view, source.view.state);
			}
		}
		const staged: { source: Source; state: EditorState }[] = [];
		for (const source of targets.values()) {
			if (source.view.isDestroyed) {
				continue;
			}
			const baseline = source.view.state.plugins.filter((plugin) => !managed.has(plugin));
			const plugins: Plugin[] = [];
			const keys = new Set(baseline.map(key));
			// Validate in registration order, not priority order: a newcomer cannot
			// displace an existing registration simply by choosing a higher priority.
			for (const entry of entries.values()) {
				if (!entry.active || entry.removed) {
					continue;
				}
				const instance = entry.instances.get(source.viewId);
				if (!instance || instance.source.view !== source.view) {
					continue;
				}
				if (entry.renderer) {
					const { kind, type } = entry.renderer;
					const schemaType =
						kind === 'node'
							? source.view.state.schema.nodes[type]
							: source.view.state.schema.marks[type];
					const baselineProps = [
						source.view.props,
						...(source.view.props.plugins ?? []).map((plugin) => plugin.props),
						...baseline.map((plugin) => plugin.props),
					];
					if (
						!schemaType ||
						baselineProps.some((props) => props.nodeViews?.[type] || props.markViews?.[type])
					) {
						fail(
							entry,
							'renderer.conflict',
							new Error(
								!schemaType
									? `Unknown schema ${kind} type: ${type}`
									: `Existing baseline renderer for type: ${type}`,
							),
							source.viewId,
						);
						return false;
					}
				}
				for (const plugin of instance.plugins) {
					if (keys.has(key(plugin))) {
						fail(
							entry,
							'reconfigure',
							new Error(`Duplicate behavior plugin key: ${key(plugin)}`),
							source.viewId,
						);
						return false;
					}
					keys.add(key(plugin));
				}
			}
			for (const entry of ordered) {
				const instance = entry.instances.get(source.viewId);
				if (instance?.source.view === source.view) {
					plugins.push(...instance.plugins);
				}
			}
			plugins.push(...baseline);
			if (
				plugins.length === source.view.state.plugins.length &&
				plugins.every((plugin, index) => plugin === source.view.state.plugins[index])
			) {
				continue;
			}
			try {
				staged.push({ source, state: source.view.state.reconfigure({ plugins }) });
				if (!fresh()) {
					return false;
				}
			} catch (error) {
				// init wrappers identify their own registration before propagating.
				if (ordered.every((entry) => entry.active)) {
					throw error;
				}
				return false;
			}
		}
		if (!fresh()) {
			return false;
		}
		for (const { source, state } of staged) {
			if (!fresh()) {
				return false;
			}
			const previousRenderers = source.view.state.plugins.filter((plugin) =>
				rendererPlugins.has(plugin),
			);
			source.view.updateState(state);
			const installedRenderers = source.view.state.plugins.filter((plugin) =>
				rendererPlugins.has(plugin),
			);
			if (
				(previousRenderers.length !== installedRenderers.length ||
					previousRenderers.some((plugin) => !installedRenderers.includes(plugin))) &&
				sources
					.listViews()
					.some(
						(current) =>
							current.viewId === source.viewId &&
							current.view === source.view &&
							current.documentId === source.documentId,
					)
			) {
				if (sources.invalidateLayout) {
					pendingLayoutChanges.set(source.viewId, source);
					layoutFor(source)?.invalidate();
				}
			}
			// Plugin-view initialization may dispatch. Retain that newer state, but
			// never install another view's stage if a callback changed its input.
			if (states.has(source.view)) {
				states.set(source.view, source.view.state);
			}
		}
		for (const instance of pendingRetired) {
			retired.delete(instance);
		}
		if (!entries.size && !layouts.size) {
			const cleanup = stop;
			stop = undefined;
			cleanup?.();
		}
		return fresh() && retired.size === 0;
	}
	function sync() {
		if (!entries.size && !retired.size && !layouts.size) {
			flushFinalLayoutChanges();
			return;
		}
		if (depth || busy() || notifying) {
			schedule();
			return;
		}
		if (syncing) {
			resync = true;
			return;
		}
		syncing = true;
		try {
			// Drain source notifications raised by updateState without reentering it.
			let settled = false;
			for (let pass = 0; pass < 16 && !settled; pass++) {
				resync = false;
				const reconciled = reconcile();
				settled = reconciled && !resync;
			}
			if (!settled) {
				for (const entry of entries.values()) {
					if (entry.active) {
						fail(
							entry,
							'reconfigure',
							new Error('Behavior reconciliation did not stabilize after 16 passes'),
						);
					}
				}
			}
		} catch (error) {
			for (const entry of entries.values()) {
				if (entry.active) {
					fail(entry, 'reconfigure', error);
				}
			}
		} finally {
			syncing = false;
			flushFinalLayoutChanges();
		}
	}
	function assertLifecycle() {
		if (notifying || depth || syncing || starting || busy()) {
			throw new Error(
				'Behavior lifecycle changes must be deferred outside editor callbacks and notifications',
			);
		}
	}
	function start() {
		if (stop || disposed) {
			return;
		}
		let stopSource: Dispose | undefined;
		let stopEffect: Dispose | undefined;
		let stopped = false;
		const cleanup = () => {
			if (stopped) {
				return;
			}
			stopped = true;
			try {
				stopEffect?.();
			} finally {
				stopSource?.();
			}
		};
		stop = cleanup;
		try {
			stopEffect = $effect.root(() => {
				$effect(() => {
					try {
						sources.listViews();
					} catch {
						// Reconciliation reports source failures through the owning entries.
					}
					untrack(schedule);
				});
			});
			starting = true;
			try {
				stopSource = sources.subscribe(schedule);
			} finally {
				starting = false;
			}
			if (stopped) {
				stopSource();
			}
		} catch (error) {
			if (stop === cleanup) {
				stop = undefined;
			}
			try {
				cleanup();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], 'Behavior source setup failed');
			}
			throw error;
		}
	}
	return {
		sync,
		isBusy: () => depth > 0 || notifying || syncing,
		assertDisposal() {
			if (notifying) {
				throw new Error('Defer behavior service disposal during notifications');
			}
		},
		behaviors: snapshots,
		subscribe(listener: (snapshot: readonly EditorBehaviorSnapshot[]) => void): Dispose {
			assertLifecycle();
			const deliver = (snapshot: readonly EditorBehaviorSnapshot[]) => listener(snapshot);
			listeners.add(deliver);
			notifying = true;
			try {
				listener(snapshots());
			} catch (error) {
				console.error('Behavior subscriber failed', error);
			} finally {
				notifying = false;
			}
			return () => {
				if (notifying) {
					throw new Error('Defer behavior subscription cleanup during notifications');
				}
				listeners.delete(deliver);
			};
		},
		register(
			registration: EditorBehaviorRegistration,
			ownerId: string,
			signal?: AbortSignal,
			onError?: (failure: EditorBehaviorFailure) => void,
			renderer?: RendererType,
		): Dispose {
			assertLifecycle();
			if (disposed || signal?.aborted) {
				return () => {};
			}
			if (
				typeof registration.id !== 'string' ||
				!registration.id.trim() ||
				typeof registration.name !== 'string' ||
				!registration.name.trim() ||
				typeof registration.create !== 'function' ||
				(registration.priority !== undefined && !Number.isFinite(registration.priority)) ||
				(registration.views !== undefined &&
					(!Array.isArray(registration.views) ||
						registration.views.some((id) => typeof id !== 'string')))
			) {
				throw new TypeError('Invalid behavior registration');
			}
			if (entries.has(registration.id)) {
				throw new Error(`Duplicate behavior ID: ${registration.id}`);
			}
			if (renderer) {
				for (const existing of entries.values()) {
					if (
						existing.renderer?.type === renderer.type &&
						existing.active &&
						(!registration.views ||
							!existing.registration.views ||
							registration.views.some((id) => existing.registration.views!.includes(id)))
					) {
						throw new Error(`Overlapping renderer registration for type: ${renderer.type}`);
					}
				}
			}
			const entry: Entry = {
				renderer,
				registration: {
					...registration,
					...(registration.views ? { views: Object.freeze([...registration.views]) } : {}),
				},
				ownerId,
				signal,
				onError,
				active: true,
				removed: false,
				instances: new Map(),
			};
			entries.set(registration.id, entry);
			const release = () => {
				if (entry.removed) {
					return;
				}
				if (notifying && !signal?.aborted) {
					throw new Error('Defer behavior removal during notifications');
				}
				mutation++;
				entry.removed = true;
				entry.active = false;
				entries.delete(registration.id);
				entry.detach?.();
				for (const instance of entry.instances.values()) {
					retire(instance);
				}
				entry.instances.clear();
				if (depth || busy() || syncing || notifying || starting || signal?.aborted) {
					schedule();
				} else {
					sync();
				}
				if (!entries.size && !layouts.size) {
					const cleanup = stop;
					stop = undefined;
					cleanup?.();
				}
				notify();
			};
			const abort = () => {
				try {
					release();
				} catch (error) {
					report(entry, 'cleanup', error);
				}
			};
			entry.detach = () => signal?.removeEventListener('abort', abort);
			signal?.addEventListener('abort', abort, { once: true });
			try {
				start();
				sync();
			} catch (error) {
				fail(entry, 'setup', error);
				// Keep diagnostics removable, but never retry a broken source setup
				// in this registration's error path.
				schedule();
			}
			if (signal?.aborted) {
				release();
			}
			notify();
			return release;
		},
		dispose() {
			disposed = true;
			for (const layout of layouts.values()) {
				layout.observer.dispose();
			}
			layouts.clear();
			mutation++;
			listeners.clear();
			for (const entry of entries.values()) {
				entry.detach?.();
				entry.active = false;
				entry.removed = true;
				for (const instance of entry.instances.values()) {
					retire(instance);
				}
				entry.instances.clear();
			}
			entries.clear();
			const cleanup = stop;
			stop = undefined;
			try {
				cleanup?.();
			} finally {
				if (depth || busy() || syncing) {
					schedule();
				} else {
					sync();
				}
			}
		},
	};
}
