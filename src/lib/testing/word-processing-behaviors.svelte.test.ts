import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { schema } from 'prosemirror-schema-basic';
import { EditorState, Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { EditorView, Decoration, DecorationSet } from 'prosemirror-view';
import type { PluginView } from 'prosemirror-state';
import { history, undo, undoDepth } from 'prosemirror-history';
import { Slice } from 'prosemirror-model';
import { createBehaviorManager } from '../../../packages-js/word-processing/src/behaviors.svelte';
import type { PluginApiConnection } from '@writers-ide/plugins';
import {
	createWordProcessingConnection,
	createWordProcessingService,
} from '../../../packages-js/word-processing';
import type {
	EditorBehaviorContext,
	WordProcessingSources,
} from '../../../packages-js/word-processing';

const cleanups: (() => void)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	await Promise.resolve();
	vi.restoreAllMocks();
});
function setup(plugins: Plugin[] = []) {
	const listeners = new Set<() => void>();
	const all: EditorView[] = [];
	function view() {
		const mount = document.createElement('div');
		document.body.append(mount);
		const result = new EditorView(mount, {
			state: EditorState.create({
				schema,
				doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('hello'))]),
				plugins,
			}),
			dispatchTransaction(tr) {
				result.updateState(result.state.applyTransaction(tr).state);
				emit();
			},
		});
		all.push(result);
		cleanups.push(() => {
			if (!result.isDestroyed) {
				result.destroy();
			}
			mount.remove();
		});
		return result;
	}
	const first = view();
	let entries = $state.raw([{ viewId: 'one', documentId: 'doc', name: 'Chapter', view: first }]);
	function emit() {
		for (const listener of [...listeners]) {
			listener();
		}
	}
	const report = vi.fn();
	const sources: WordProcessingSources = {
		listViews: () => entries,
		activeViewId: () => 'one',
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		reportBehaviorError: report,
	};
	const service = createWordProcessingService(sources);
	cleanups.push(() => service.dispose());
	return {
		service,
		sources,
		first,
		view,
		report,
		emit,
		listeners,
		set: (next: typeof entries) => {
			entries = next;
		},
		add: (id: string, next = view()) => {
			entries = [...entries, { viewId: id, documentId: 'doc', name: id, view: next }];
			emit();
			return next;
		},
	};
}
function owner(service: ReturnType<typeof createWordProcessingService>, id = 'consumer') {
	const controller = new AbortController();
	const releases = new Set<() => void>();
	const connection: PluginApiConnection = {
		reportError: vi.fn(),
		consumerId: id,
		signal: controller.signal,
		own(dispose) {
			let live = true;
			const release = () => {
				if (live) {
					live = false;
					releases.delete(release);
					dispose();
				}
			};
			releases.add(release);
			return release;
		},
		guard: (fn) =>
			function (this: unknown, ...args) {
				return controller.signal.aborted ? undefined : fn.apply(this, args);
			},
	};
	return {
		api: createWordProcessingConnection(service, connection),
		connection,
		revoke() {
			controller.abort();
			for (const release of [...releases]) {
				release();
			}
		},
	};
}
const registration = (
	create: (context: EditorBehaviorContext) => Plugin | readonly Plugin[],
	id = 'behavior',
	priority = 0,
) => ({ id, name: id, priority, create });

describe('behavior adversarial lifecycle and reporting', () => {
	it('does not run factories or subscribe for a preaborted registration', () => {
		const s = setup();
		const manager = createBehaviorManager(s.sources, () => false);
		cleanups.push(() => manager.dispose());
		const controller = new AbortController();
		controller.abort();
		const create = vi.fn(() => new Plugin({}));
		manager.register(registration(create), 'owner', controller.signal)();
		expect(create).not.toHaveBeenCalled();
		expect(s.listeners.size).toBe(0);
		expect(manager.behaviors()).toEqual([]);
	});
	it.each(['owner', 'observer'])(
		'isolates a throwing %s error reporter and attributes runtime errors to the consumer',
		async (thrower) => {
			const s = setup();
			const a = owner(s.service, 'actual-consumer');
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			if (thrower === 'owner') {
				vi.mocked(a.connection.reportError).mockImplementation(() => {
					throw new Error('reporter failed');
				});
			} else {
				s.report.mockImplementation(() => {
					throw new Error('observer failed');
				});
			}
			a.api.registerBehavior(
				registration(
					() =>
						new Plugin({
							props: {
								handleKeyDown() {
									throw new TypeError('broken key');
								},
							},
						}),
				),
			);
			s.first.someProp('handleKeyDown', (fn) => fn(s.first, new KeyboardEvent('keydown')));
			expect(a.connection.reportError).toHaveBeenCalledWith(
				expect.objectContaining({
					message: 'Behavior behavior (props.handleKeyDown, view one): TypeError: broken key',
				}),
			);
			expect(s.report).toHaveBeenCalledWith(
				expect.objectContaining({ ownerId: 'actual-consumer', phase: 'props.handleKeyDown' }),
			);
			expect(log).toHaveBeenCalled();
			await Promise.resolve();
			expect(s.first.state.plugins).toHaveLength(0);
		},
	);
	it('logs standalone failures when neither reporter is supplied', () => {
		const s = setup();
		delete s.sources.reportBehaviorError;
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		s.service.registerBehavior(
			registration(() => {
				throw new Error('factory failed');
			}),
		);
		expect(log).toHaveBeenCalledWith(expect.stringContaining('behavior'), expect.any(Error));
	});
	it('detaches registration abort listeners when disposed after the last view is destroyed', async () => {
		const s = setup();
		const a = owner(s.service);
		const remove = vi.spyOn(a.connection.signal, 'removeEventListener');
		a.api.registerBehavior(registration(() => new Plugin({})));
		s.first.destroy();
		s.set([]);
		s.emit();
		await Promise.resolve();
		s.service.dispose();
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(s.listeners.size).toBe(0);
	});
	it('removes behavior plugins even when source cleanup throws during disposal', () => {
		const s = setup();
		const subscribe = s.sources.subscribe;
		s.sources.subscribe = (listener) => {
			const stop = subscribe(listener);
			return () => {
				stop();
				throw new Error('source cleanup failed');
			};
		};
		const manager = createBehaviorManager(s.sources, () => false);
		cleanups.push(() => manager.dispose());
		manager.register(
			registration(() => new Plugin({})),
			'owner',
		);
		expect(() => manager.dispose()).toThrow('source cleanup failed');
		expect(s.first.state.plugins).toHaveLength(0);
		expect(s.listeners.size).toBe(0);
	});
	it('cleans late source setup when subscription disposes the service', () => {
		const s = setup();
		const subscribe = s.sources.subscribe;
		const create = vi.fn(() => new Plugin({}));
		s.sources.subscribe = (listener) => {
			const stop = subscribe(listener);
			s.service.dispose();
			return stop;
		};
		s.service.registerBehavior(registration(create));
		expect(create).not.toHaveBeenCalled();
		expect(s.listeners.size).toBe(0);
		expect(s.first.state.plugins).toHaveLength(0);
	});
	it.each(['managed', 'baseline'])(
		'does not reconcile notifications or snapshot reads inside a %s hook',
		async (kind) => {
			const late = new Plugin({});
			let hook = () => {};
			const plugin = new Plugin({
				filterTransaction() {
					hook();
					return true;
				},
			});
			const s = setup(kind === 'baseline' ? [plugin] : []);
			s.service.registerBehavior(registration(() => (kind === 'managed' ? plugin : late)));
			const second = s.view();
			const update = vi.spyOn(second, 'updateState');
			hook = () => {
				s.add('two', second);
				s.service.snapshot();
				expect(update).not.toHaveBeenCalled();
			};
			s.first.dispatch(s.first.state.tr.insertText('!'));
			expect(update).not.toHaveBeenCalled();
			await Promise.resolve();
			expect(update).toHaveBeenCalledTimes(1);
		},
	);
	it.each(['factory', 'init'])(
		'discards staged states when a %s changes another view state',
		(phase) => {
			const s = setup();
			const second = s.add('two');
			let changed = false;
			const change = () => {
				if (!changed) {
					changed = true;
					s.first.dispatch(s.first.state.tr.insertText('!'));
				}
			};
			s.service.registerBehavior(
				registration(({ viewId }) => {
					if (phase === 'factory' && viewId === 'two') {
						change();
					}
					return new Plugin({
						state: {
							init() {
								if (phase === 'init' && viewId === 'two') {
									change();
								}
								return 1;
							},
							apply: (_tr, value) => value,
						},
					});
				}),
			);
			expect(s.first.state.doc.textContent).toBe('!hello');
			expect(s.first.state.plugins).toHaveLength(1);
			expect(second.state.plugins).toHaveLength(1);
		},
	);
	it('does not install a later view stage over a dispatch from plugin-view initialization', () => {
		const s = setup();
		const second = s.add('two');
		let changed = false;
		s.service.registerBehavior(
			registration(
				({ viewId }) =>
					new Plugin({
						view() {
							if (viewId === 'one' && !changed) {
								changed = true;
								second.dispatch(second.state.tr.insertText('!'));
							}
							return {};
						},
					}),
			),
		);
		expect(second.state.doc.textContent).toBe('!hello');
		expect(second.state.plugins).toHaveLength(1);
	});
	it('installs the live identity when a factory renames a source on the same view', () => {
		const s = setup();
		const contexts: EditorBehaviorContext[] = [];
		s.service.registerBehavior(
			registration((context) => {
				contexts.push(context);
				if (context.viewId === 'one') {
					s.set([{ viewId: 'renamed', documentId: 'other', name: 'Renamed', view: s.first }]);
					s.emit();
				}
				return new Plugin({});
			}),
		);
		expect(contexts.map((context) => context.viewId)).toEqual(['one', 'renamed']);
		expect(contexts[0].signal.aborted).toBe(true);
		expect(contexts[1].signal.aborted).toBe(false);
		expect(s.first.state.plugins).toHaveLength(1);
	});
	it('does not create further instances after factory cancellation', () => {
		const s = setup();
		s.add('two');
		const a = owner(s.service);
		const create = vi.fn(() => {
			a.revoke();
			return new Plugin({});
		});
		a.api.registerBehavior(registration(create));
		expect(create).toHaveBeenCalledTimes(1);
		expect(s.first.state.plugins).toHaveLength(0);
	});
	it('quarantines late-view initialization failures and rolls back every existing view', async () => {
		const s = setup();
		const destroy = vi.fn();
		s.service.registerBehavior(
			registration(
				({ viewId }) =>
					new Plugin({
						state: {
							init() {
								if (viewId === 'two') {
									throw new Error('late init');
								}
								return 0;
							},
							apply: (_tr, value) => value,
						},
						view: () => ({ destroy }),
					}),
			),
		);
		const second = s.add('two');
		await Promise.resolve();
		expect(s.first.state.plugins).toHaveLength(0);
		expect(second.state.plugins).toHaveLength(0);
		expect(destroy).toHaveBeenCalledTimes(1);
		expect(s.service.behaviors()[0].status).toBe('failed');
	});
	it('bounds reconciliation when plugin-view initialization continuously replaces sources', async () => {
		const s = setup();
		let next = false;
		const peer = s.view();
		const create = vi.fn(
			() =>
				new Plugin({
					view() {
						next = !next;
						s.set([
							{ viewId: 'one', documentId: 'doc', name: 'moving', view: next ? peer : s.first },
						]);
						s.emit();
						return {};
					},
				}),
		);
		s.service.registerBehavior(registration(create));
		expect(create.mock.calls.length).toBeLessThanOrEqual(16);
		expect(s.service.behaviors()[0]).toMatchObject({
			status: 'failed',
			error: expect.stringContaining('16 passes'),
		});
		await Promise.resolve();
		expect(s.first.state.plugins).toHaveLength(0);
		expect(peer.state.plugins).toHaveLength(0);
	});
	it('contains subscription setup failures and leaves removable diagnostics without factories', () => {
		const s = setup();
		const create = vi.fn(() => new Plugin({}));
		s.sources.subscribe = () => {
			throw new Error('subscribe failed');
		};
		const release = s.service.registerBehavior(registration(create));
		expect(create).not.toHaveBeenCalled();
		expect(s.service.behaviors()[0]).toMatchObject({
			status: 'failed',
			error: expect.stringContaining('subscribe failed'),
		});
		release();
		expect(s.service.behaviors()).toEqual([]);
	});
	it('contains late source-read failures and still removes installed behaviors on disposal', async () => {
		const s = setup();
		const a = owner(s.service);
		a.api.registerBehavior(registration(() => new Plugin({})));
		s.sources.listViews = () => {
			throw new Error('sources unavailable');
		};
		s.emit();
		await Promise.resolve();
		expect(s.service.behaviors()[0].status).toBe('failed');
		s.service.dispose();
		expect(s.first.state.plugins).toHaveLength(0);
		expect(s.listeners.size).toBe(0);
	});
	it('rejects lifecycle reentrancy from source setup without starting nested factories', () => {
		const s = setup();
		const original = s.sources.subscribe;
		s.sources.subscribe = (listener) => {
			expect(() =>
				s.service.registerBehavior(registration(() => new Plugin({}), 'nested')),
			).toThrow('deferred');
			return original(listener);
		};
		s.service.registerBehavior(registration(() => new Plugin({})));
		expect(s.service.behaviors()).toHaveLength(1);
	});
	it('permits dispatch from plugin-view update without nested behavior reconfiguration', async () => {
		const s = setup();
		const peer = s.view();
		let updated = false;
		s.service.registerBehavior(
			registration(
				() =>
					new Plugin({
						view: () => ({
							update(view) {
								if (!updated) {
									updated = true;
									s.add('two', peer);
									view.dispatch(view.state.tr.insertText('?'));
									expect(peer.state.plugins).toHaveLength(0);
								}
							},
						}),
					}),
			),
		);
		s.first.dispatch(s.first.state.tr.insertText('!'));
		expect(s.first.state.doc.textContent).toBe('!?hello');
		await Promise.resolve();
		expect(peer.state.plugins).toHaveLength(1);
	});
	it('defers signal-driven cancellation from a baseline hook and immediately guards managed callbacks', async () => {
		let cancel = () => {};
		const baseline = new Plugin({
			filterTransaction() {
				cancel();
				return true;
			},
		});
		const s = setup([baseline]);
		const a = owner(s.service);
		const apply = vi.fn((_tr, value) => value);
		a.api.registerBehavior(registration(() => new Plugin({ state: { init: () => 0, apply } })));
		const update = vi.spyOn(s.first, 'updateState');
		cancel = () => {
			a.revoke();
			expect(update).not.toHaveBeenCalled();
		};
		s.first.dispatch(s.first.state.tr.insertText('!'));
		expect(apply).not.toHaveBeenCalled();
		expect(update).toHaveBeenCalledTimes(1);
		await Promise.resolve();
		expect(s.first.state.plugins).toEqual([baseline]);
	});
	it('does not commit later view stages after revocation in view initialization', () => {
		const s = setup();
		const second = s.add('two');
		const a = owner(s.service);
		const initialize = vi.fn(() => {
			a.revoke();
			return {};
		});
		a.api.registerBehavior(registration(() => new Plugin({ view: initialize })));
		expect(initialize).toHaveBeenCalledTimes(1);
		expect(s.first.state.plugins).toHaveLength(0);
		expect(second.state.plugins).toHaveLength(0);
	});
	it('does not reconcile reactive arrivals during a baseline hook even with flushSync', async () => {
		let hook = () => {};
		const s = setup([
			new Plugin({
				filterTransaction() {
					hook();
					return true;
				},
			}),
		]);
		s.service.registerBehavior(registration(() => new Plugin({})));
		flushSync();
		const peer = s.view();
		hook = () => {
			s.add('two', peer);
			flushSync();
			expect(peer.state.plugins).toHaveLength(1);
		};
		s.first.dispatch(s.first.state.tr.insertText('!'));
		await Promise.resolve();
		expect(peer.state.plugins).toHaveLength(2);
	});
	it('contains arbitrary thrown values with hostile string conversion', () => {
		const s = setup();
		s.service.registerBehavior(
			registration(() => {
				throw {
					toString() {
						throw new Error('conversion');
					},
				};
			}),
		);
		expect(s.service.behaviors()[0]).toMatchObject({
			status: 'failed',
			error: 'Unknown thrown value',
		});
	});
	it.each([
		'transformPastedText',
		'transformPastedHTML',
		'transformPasted',
		'transformCopied',
		'editable',
		'attributes',
		'clipboardTextSerializer',
	])('provides a safe fallback for throwing %s props', (name) => {
		const s = setup();
		let armed = false;
		s.service.registerBehavior(
			registration(
				() =>
					new Plugin({
						props: {
							[name]: () => {
								if (!armed) {
									return name === 'editable' ? true : {};
								}
								throw new Error('bad prop');
							},
						},
					}),
			),
		);
		armed = true;
		const props = s.first.state.plugins[0].props as Record<string, (...args: unknown[]) => unknown>;
		const slice = s.first.state.doc.slice(0, s.first.state.doc.content.size);
		const input =
			name === 'transformPasted' || name === 'transformCopied' || name === 'clipboardTextSerializer'
				? slice
				: 'text';
		const result = props[name](input);
		if (name.startsWith('transform')) {
			expect(result).toBe(input);
		} else if (name === 'editable') {
			expect(result).toBe(true);
		} else if (name === 'attributes') {
			expect(result).toEqual({});
		} else {
			expect(result).toBe('hello');
		}
	});
	it.each([
		'filterTransaction',
		'appendTransaction',
		'transformPasted',
		'transformPastedText',
		'decorations',
	])('rejects malformed runtime return values from %s', (name) => {
		const s = setup();
		let armed = false;
		const callback = () => (name === 'decorations' && !armed ? null : { invalid: true });
		s.service.registerBehavior(
			registration(
				() =>
					new Plugin(
						name === 'filterTransaction' || name === 'appendTransaction'
							? ({ [name]: callback } as never)
							: { props: { [name]: callback } },
					),
			),
		);
		armed = true;
		if (name === 'filterTransaction' || name === 'appendTransaction') {
			s.first.dispatch(s.first.state.tr.insertText('!'));
		} else {
			const fn = (
				s.first.state.plugins[0].props as Record<string, (...args: unknown[]) => unknown>
			)[name];
			fn(name === 'transformPasted' ? Slice.empty : 'text');
		}
		expect(s.service.behaviors()[0].status).toBe('failed');
	});
});

describe('behavior adapter edge cases', () => {
	it('cleans late subscription setup after immediate factory revocation', () => {
		const s = setup();
		const original = s.sources.subscribe;
		s.sources.subscribe = (listener) => {
			const stop = original(listener);
			listener();
			return stop;
		};
		const a = owner(s.service);
		a.api.registerBehavior(
			registration(() => {
				a.revoke();
				return new Plugin({});
			}),
		);
		expect(s.listeners.size).toBe(0);
		expect(s.first.state.plugins).toHaveLength(0);
	});
	it('drains synchronous source notifications raised by updateState without recursive updateState', () => {
		const s = setup();
		const late = s.view();
		const update = s.first.updateState.bind(s.first);
		let added = false;
		let updating = false;
		vi.spyOn(s.first, 'updateState').mockImplementation((state) => {
			expect(updating).toBe(false);
			updating = true;
			update(state);
			if (!added) {
				added = true;
				s.add('late', late);
			}
			updating = false;
		});
		s.service.registerBehavior(registration(() => new Plugin({})));
		expect(late.state.plugins).toHaveLength(1);
	});
	it('preserves Plugin and plugin-view callback receivers', () => {
		const s = setup();
		const seen: unknown[] = [];
		const resource = {
			update() {
				seen.push(this);
			},
			destroy() {
				seen.push(this);
			},
		};
		const original = new Plugin({
			state: {
				init() {
					seen.push(this);
					return 0;
				},
				apply(_tr, value) {
					seen.push(this);
					return value;
				},
			},
			filterTransaction() {
				seen.push(this);
				return true;
			},
			view() {
				seen.push(this);
				return resource;
			},
			props: {
				handleKeyDown() {
					seen.push(this);
					return false;
				},
			},
		});
		const release = s.service.registerBehavior(registration(() => original));
		s.first.dispatch(s.first.state.tr.insertText('!'));
		s.first.someProp('handleKeyDown', (fn) => fn(s.first, new KeyboardEvent('keydown')));
		release();
		expect(seen).toEqual([
			original,
			original.spec,
			original,
			original,
			resource,
			original,
			resource,
		]);
	});
	it.each(['init', 'apply', 'filter', 'append', 'view', 'update', 'destroy'])(
		'rejects thenables from %s callbacks',
		async (phase) => {
			const s = setup();
			const thenable = { then() {} };
			const plugin = new Plugin({
				state: {
					init: () => (phase === 'init' ? thenable : 1),
					apply: (_tr, previous) => (phase === 'apply' ? thenable : previous),
				},
				filterTransaction: () => (phase === 'filter' ? (thenable as unknown as boolean) : true),
				appendTransaction: () => (phase === 'append' ? (thenable as unknown as null) : null),
				view: () =>
					phase === 'view'
						? (thenable as unknown as PluginView)
						: {
								update: () => (phase === 'update' ? thenable : undefined),
								destroy: () => (phase === 'destroy' ? thenable : undefined),
							},
			});
			const release = s.service.registerBehavior(registration(() => plugin));
			if (phase === 'destroy') {
				release();
			} else if (phase !== 'init' && phase !== 'view') {
				s.first.dispatch(s.first.state.tr.insertText('!'));
			}
			expect(s.report).toHaveBeenCalledWith(
				expect.objectContaining({ error: expect.any(TypeError) }),
			);
			await Promise.resolve();
			expect(s.first.state.plugins).toHaveLength(0);
		},
	);
});

describe('behavior reconfiguration and upstream identity', () => {
	it('preserves schema/doc/selection/stored marks/history and surviving plugin state without dispatch', () => {
		const key = new PluginKey('baseline');
		const baseline = new Plugin({
			key,
			state: { init: () => ({ count: 0 }), apply: (_tr, value) => ({ count: value.count + 1 }) },
		});
		const h = history();
		const s = setup([baseline, h]);
		const transaction = s.first.state.tr.insertText('!');
		s.first.dispatch(
			transaction
				.setSelection(TextSelection.create(transaction.doc, 3))
				.setStoredMarks([schema.marks.strong.create()]),
		);
		const before = s.first.state;
		const dispatch = vi.spyOn(s.first, 'dispatch');
		const original = new Plugin({
			state: { init: () => ({ value: 7 }), apply: (_tr, value) => value },
		});
		const create = vi.fn(() => original);
		const release = s.service.registerBehavior(registration(create));
		const installed = s.first.state.plugins[0];
		expect(installed).not.toBe(original);
		expect(installed).toBeInstanceOf(Plugin);
		expect(original.getState(s.first.state)).toEqual({ value: 7 });
		const value = original.getState(s.first.state);
		const peer = s.service.registerBehavior(registration(() => new Plugin({}), 'peer'));
		expect(s.first.state.plugins[0]).toBe(installed);
		expect(original.getState(s.first.state)).toBe(value);
		peer();
		release();
		release();
		expect(s.first.state.plugins).toEqual([baseline, h]);
		expect(s.first.state.schema).toBe(before.schema);
		expect(s.first.state.doc).toBe(before.doc);
		expect(s.first.state.selection).toBe(before.selection);
		expect(s.first.state.storedMarks).toBe(before.storedMarks);
		expect(key.getState(s.first.state)).toBe(key.getState(before));
		expect(undoDepth(s.first.state)).toBe(1);
		expect(dispatch).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledTimes(1);
		expect(undo(s.first.state, s.first.dispatch)).toBe(true);
		expect(s.first.state.doc.textContent).toBe('hello');
	});
	it('retains unkeyed source singleton getState and setMeta identity', () => {
		const s = setup();
		const original: Plugin<number> = new Plugin({
			state: { init: () => 0, apply: (tr, value) => tr.getMeta(original) ?? value },
		});
		s.service.registerBehavior(registration(() => original));
		s.first.dispatch(s.first.state.tr.setMeta(original, 42));
		expect(original.getState(s.first.state)).toBe(42);
	});
	it('preserves foreign plugin additions and baseline order on removal', () => {
		const base = new Plugin({});
		const foreign = new Plugin({});
		const s = setup([base]);
		const release = s.service.registerBehavior(registration(() => new Plugin({})));
		s.first.updateState(
			s.first.state.reconfigure({ plugins: [...s.first.state.plugins, foreign] }),
		);
		release();
		expect(s.first.state.plugins).toEqual([base, foreign]);
	});
	it('invalidates exact targets but makes no document edit on reconfigure', () => {
		const s = setup();
		const target = s.service.snapshot().views[0];
		s.service.registerBehavior(registration(() => new Plugin({})));
		expect(s.service.inspect(target, () => true)).toEqual({ ok: false, reason: 'stale' });
	});
	it('orders priority descending then registration order before baseline synchronous event handlers', () => {
		const calls: string[] = [];
		const plugin = (id: string, handled = false) =>
			new Plugin({
				props: {
					handleKeyDown() {
						calls.push(id);
						return handled;
					},
				},
			});
		const s = setup([plugin('base', true)]);
		s.service.registerBehavior(registration(() => plugin('a'), 'a', 1));
		s.service.registerBehavior(registration(() => plugin('b'), 'b', 10));
		s.service.registerBehavior(registration(() => plugin('c'), 'c', 1));
		s.first.someProp('handleKeyDown', (fn) =>
			fn(s.first, new KeyboardEvent('keydown', { key: 'x' })),
		);
		expect(calls).toEqual(['b', 'a', 'c', 'base']);
	});
});

describe('behavior validation and atomic registration', () => {
	it('accepts an empty plugin array without changing state', () => {
		const s = setup();
		const before = s.first.state;
		const release = s.service.registerBehavior(registration(() => []));
		expect(s.first.state).toBe(before);
		expect(s.service.behaviors()[0].status).toBe('active');
		release();
	});
	it('rejects duplicate registration IDs without disturbing original handles', () => {
		const s = setup();
		const release = s.service.registerBehavior(registration(() => new Plugin({})));
		expect(() => s.service.registerBehavior(registration(() => new Plugin({})))).toThrow(
			'Duplicate behavior ID',
		);
		release();
		expect(s.service.behaviors()).toEqual([]);
	});
	it.each(['baseline', 'managed', 'array'] as const)(
		'quarantines %s plugin-key collisions',
		(kind) => {
			const original = new Plugin({});
			const s = setup(kind === 'baseline' ? [original] : []);
			if (kind === 'managed') {
				s.service.registerBehavior(registration(() => original, 'original'));
			}
			const before = s.first.state;
			const release = s.service.registerBehavior(
				registration(() => (kind === 'array' ? [original, original] : original), 'behavior', 100),
			);
			expect(s.first.state).toBe(before);
			expect(s.service.behaviors().find((entry) => entry.id === 'behavior')).toMatchObject({
				status: 'failed',
				error: expect.stringContaining('Duplicate'),
			});
			expect(s.report).toHaveBeenCalledWith(
				expect.objectContaining({ id: 'behavior', phase: 'reconfigure', viewId: 'one' }),
			);
			release();
		},
	);
	it.each(['malformed', 'async', 'nodeViews', 'markViews'])(
		'rejects %s factory output and keeps a removable diagnostic',
		(kind) => {
			const s = setup();
			const create = () => {
				if (kind === 'malformed') {
					return {} as Plugin;
				}

				if (kind === 'async') {
					return Promise.resolve(new Plugin({})) as unknown as Plugin;
				}
				return new Plugin({ props: { [kind]: {} } });
			};
			const before = s.first.state;
			const release = s.service.registerBehavior(registration(create));
			expect(s.service.behaviors()[0].status).toBe('failed');
			expect(s.first.state).toBe(before);
			release();
			expect(s.service.behaviors()).toEqual([]);
		},
	);
	it('rolls back all current views when a later factory or init fails', () => {
		for (const phase of ['create', 'init']) {
			const s = setup();
			const second = s.add('two');
			const before = [s.first.state, second.state];
			const signals: AbortSignal[] = [];
			s.service.registerBehavior(
				registration(({ viewId, signal }) => {
					signals.push(signal);
					if (viewId === 'two' && phase === 'create') {
						throw new Error('bad create');
					}
					return new Plugin({
						state: {
							init() {
								if (viewId === 'two') {
									throw new Error('bad init');
								}
								return 1;
							},
							apply: (_tr, value) => value,
						},
					});
				}),
			);
			expect([s.first.state, second.state]).toEqual(before);
			expect(signals.every((signal) => signal.aborted)).toBe(true);
			expect(s.service.behaviors()[0].status).toBe('failed');
		}
	});
});

describe('behavior view and connection lifetime', () => {
	it('creates once per live view identity, isolates signals, and reconciles late/replaced/detached views without snapshot subscriptions', async () => {
		const s = setup();
		const contexts: EditorBehaviorContext[] = [];
		const release = s.service.registerBehavior(
			registration((context) => {
				contexts.push(context);
				return new Plugin({});
			}),
		);
		const second = s.add('two');
		await Promise.resolve();
		expect(contexts).toHaveLength(2);
		expect(contexts[0].signal).not.toBe(contexts[1].signal);
		s.first.dispatch(s.first.state.tr.insertText('!'));
		expect(contexts).toHaveLength(2);
		const replacement = s.view();
		s.set([
			{ viewId: 'one', documentId: 'doc', name: 'New', view: replacement },
			{ viewId: 'two', documentId: 'doc', name: 'Two', view: second },
		]);
		s.emit();
		await Promise.resolve();
		expect(contexts).toHaveLength(3);
		expect(contexts[0].signal.aborted).toBe(true);
		expect(s.first.state.plugins).toHaveLength(0);
		expect(contexts[1].signal.aborted).toBe(false);
		s.set([{ viewId: 'one', documentId: 'doc', name: 'New', view: replacement }]);
		s.emit();
		await Promise.resolve();
		expect(contexts[1].signal.aborted).toBe(true);
		expect(second.state.plugins).toHaveLength(0);
		release();
		expect(contexts[2].signal.aborted).toBe(true);
		expect(s.listeners.size).toBe(0);
	});
	it('tracks reactive-only arrivals while registrations exist', async () => {
		const s = setup();
		const create = vi.fn(() => new Plugin({}));
		s.service.registerBehavior(registration(create));
		flushSync();
		const second = s.view();
		s.set([{ viewId: 'two', documentId: 'doc', name: 'Two', view: second }]);
		flushSync();
		await Promise.resolve();
		expect(create).toHaveBeenCalledTimes(2);
		expect(s.first.state.plugins).toHaveLength(0);
		expect(second.state.plugins).toHaveLength(1);
	});
	it('honors explicit view ID allowlists', async () => {
		const s = setup();
		const create = vi.fn(() => new Plugin({}));
		s.service.registerBehavior({ ...registration(create), views: ['two'] });
		expect(create).not.toHaveBeenCalled();
		s.add('two');
		s.add('three');
		await Promise.resolve();
		expect(create).toHaveBeenCalledTimes(1);
	});
	it('attributes connection ownership, revokes signals, and leaves peer registrations and EditorViews alive', () => {
		const s = setup();
		const a = owner(s.service, 'a');
		const b = owner(s.service, 'b');
		let signal!: AbortSignal;
		a.api.registerBehavior(
			registration((context) => {
				signal = context.signal;
				return new Plugin({});
			}, 'a'),
		);
		b.api.registerBehavior(registration(() => new Plugin({}), 'b'));
		expect(s.service.behaviors().map((entry) => entry.ownerId)).toEqual(['a', 'b']);
		a.revoke();
		expect(signal.aborted).toBe(true);
		expect(s.service.behaviors().map((entry) => entry.id)).toEqual(['b']);
		s.service.dispose();
		expect(s.first.isDestroyed).toBe(false);
		expect(s.first.state.plugins).toHaveLength(0);
	});
	it('cleans a factory canceled by connection revocation exactly once', () => {
		const s = setup();
		const a = owner(s.service);
		let signal!: AbortSignal;
		a.api.registerBehavior(
			registration((context) => {
				signal = context.signal;
				a.revoke();
				return new Plugin({});
			}),
		);
		expect(signal.aborted).toBe(true);
		expect(s.first.state.plugins).toHaveLength(0);
		expect(s.service.behaviors()).toEqual([]);
	});
});

describe('behavior runtime failure containment and reentrancy', () => {
	it.each(['apply', 'filter', 'append'])(
		'quarantines throwing state/%s hooks and removes after execution',
		async (phase) => {
			const s = setup();
			const error = new Error('hook failed');
			const original = new Plugin({
				state: {
					init: () => 9,
					apply: (_tr, value) => {
						if (phase === 'apply') {
							throw error;
						}
						return value;
					},
				},
				filterTransaction() {
					if (phase === 'filter') {
						throw error;
					}
					return true;
				},
				appendTransaction() {
					if (phase === 'append') {
						throw error;
					}
					return null;
				},
			});
			s.service.registerBehavior(registration(() => original));
			expect(() => s.first.dispatch(s.first.state.tr.insertText('!'))).not.toThrow();
			expect(s.service.behaviors()[0].status).toBe('failed');
			if (phase === 'filter') {
				expect(s.first.state.doc.textContent).toBe('hello');
			}
			expect(s.report).toHaveBeenCalledWith(
				expect.objectContaining({
					viewId: 'one',
					id: 'behavior',
					phase: phase === 'apply' ? 'state.apply' : `${phase}Transaction`,
				}),
			);
			await Promise.resolve();
			expect(s.first.state.plugins).toHaveLength(0);
		},
	);
	it.each(['view', 'update', 'destroy', 'decorations', 'event', 'thenable'])(
		'contains %s failures, reports diagnostics and cleans resources',
		async (phase) => {
			const s = setup();
			const destroy = vi.fn(() => {
				if (phase === 'destroy') {
					throw new Error('destroy failed');
				}
			});
			const plugin = new Plugin({
				view() {
					if (phase === 'view') {
						throw new Error('view failed');
					}
					return {
						update() {
							if (phase === 'update') {
								throw new Error('update failed');
							}
						},
						destroy,
					};
				},
				props: {
					decorations(state) {
						if (phase === 'decorations') {
							throw new Error('decoration failed');
						}
						return DecorationSet.create(state.doc, [
							Decoration.inline(1, 2, { class: 'highlight' }),
						]);
					},
					handleDOMEvents: {
						click() {
							if (phase === 'event') {
								throw new Error('event failed');
							}
							if (phase === 'thenable') {
								return Promise.resolve(false) as unknown as boolean;
							}
							return false;
						},
					},
				},
			});
			const release = s.service.registerBehavior(registration(() => plugin));
			if (phase === 'update') {
				s.first.dispatch(s.first.state.tr.insertText('!'));
			}
			if (phase === 'event' || phase === 'thenable') {
				s.first.dom.dispatchEvent(new MouseEvent('click', { bubbles: true }));
			}
			if (phase === 'destroy') {
				release();
			} else {
				expect(s.service.behaviors()[0].status).toBe('failed');
			}
			await Promise.resolve();
			expect(s.first.state.plugins).toHaveLength(0);
			expect(s.first.dom.querySelector('.highlight')).toBeNull();
			expect(s.report).toHaveBeenCalled();
			if (phase !== 'view' && phase !== 'decorations') {
				expect(destroy).toHaveBeenCalledTimes(1);
			}
		},
	);
	it('immediately guards callbacks on revoke inside a hook and defers removal', async () => {
		const s = setup();
		const a = owner(s.service);
		const later = vi.fn();
		const destroy = vi.fn();
		a.api.registerBehavior(
			registration(() => [
				new Plugin({
					filterTransaction() {
						a.revoke();
						return true;
					},
					view: () => ({ destroy }),
				}),
				new Plugin({
					state: {
						init: () => 1,
						apply: (_tr, value) => {
							later();
							return value;
						},
					},
				}),
			]),
		);
		s.first.dispatch(s.first.state.tr.insertText('!'));
		expect(later).not.toHaveBeenCalled();
		await Promise.resolve();
		expect(s.first.state.plugins).toHaveLength(0);
		expect(destroy).toHaveBeenCalledTimes(1);
	});
	it('rejects registration inside editor callbacks and hooks; cleanup is safely deferred', async () => {
		const s = setup();
		const reg = registration(() => new Plugin({}), 'nested');
		const target = s.service.snapshot().views[0];
		s.service.inspect(target, () => {
			expect(() => s.service.registerBehavior(reg)).toThrow('deferred');
		});
		const release = s.service.registerBehavior(
			registration(
				() =>
					new Plugin({
						props: {
							handleKeyDown() {
								expect(() => s.service.registerBehavior(reg)).toThrow('deferred');
								release();
								return false;
							},
						},
					}),
			),
		);
		s.first.someProp('handleKeyDown', (fn) => fn(s.first, new KeyboardEvent('keydown')));
		expect(s.service.behaviors()).toEqual([]);
		await Promise.resolve();
		expect(s.first.state.plugins).toHaveLength(0);
	});
	it('exposes frozen immediate diagnostics, isolates observers, and rejects notification lifecycle mutation', () => {
		const s = setup();
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const calls: unknown[] = [];
		const release = s.service.subscribeBehaviors((snapshot) => {
			calls.push(snapshot);
			expect(Object.isFrozen(snapshot)).toBe(true);
			expect(() =>
				s.service.registerBehavior(registration(() => new Plugin({}), 'nested')),
			).toThrow('deferred');
			expect(() => s.service.dispose()).toThrow('Defer');
			if (snapshot.length) {
				expect(Object.isFrozen(snapshot[0])).toBe(true);
				throw new Error('observer');
			}
		});
		s.service.registerBehavior(registration(() => new Plugin({})));
		expect(calls).toHaveLength(2);
		expect(log).toHaveBeenCalled();
		release();
	});
	it('disposes the service from a callback without destroying its source view', async () => {
		const s = setup();
		const destroy = vi.fn();
		s.service.registerBehavior(
			registration(
				() =>
					new Plugin({
						view: () => ({ destroy }),
						props: {
							handleKeyDown() {
								s.service.dispose();
								return false;
							},
						},
					}),
			),
		);
		s.first.someProp('handleKeyDown', (fn) => fn(s.first, new KeyboardEvent('keydown')));
		await Promise.resolve();
		expect(s.first.isDestroyed).toBe(false);
		expect(s.first.state.plugins).toHaveLength(0);
		expect(destroy).toHaveBeenCalledTimes(1);
	});
});
