import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { schema } from 'prosemirror-schema-basic';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import type { PluginApiConnection } from '@writers-ide/plugins';
import { createTaskService, WorkQueue } from '../../../packages-js/tasks';
import {
	createWordProcessingConnection,
	createWordProcessingService,
	WORD_PROCESSING_PLUGIN_ID,
	wordProcessingApi,
} from '../../../packages-js/word-processing';
import type { EditorTarget, WordProcessingSources } from '../../../packages-js/word-processing';

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	vi.restoreAllMocks();
});

function state(text = 'hello') {
	return EditorState.create({
		schema,
		doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text(text))]),
	});
}

function setup() {
	const mount = document.createElement('div');
	document.body.append(mount);
	const dispatched = vi.fn();
	const view = new EditorView(mount, {
		state: state(),
		dispatchTransaction(transaction) {
			dispatched(transaction);
			view.updateState(view.state.apply(transaction));
			emit();
		},
	});
	let entries = $state.raw([{ viewId: 'view', documentId: 'document', name: 'Chapter', view }]);
	let active = $state<string | null | undefined>('view');
	const listeners = new Set<() => void>();
	const stop = vi.fn();
	const sources: WordProcessingSources = {
		listViews: () => entries,
		activeViewId: () => active,
		subscribe: vi.fn((listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
				stop();
			};
		}),
	};
	function emit() {
		for (const listener of [...listeners]) {
			listener();
		}
	}
	const service = createWordProcessingService(sources);
	cleanups.push(() => {
		service.dispose();
		if (!view.isDestroyed) {
			view.destroy();
		}
		mount.remove();
	});
	return {
		service,
		sources,
		view,
		dispatched,
		stop,
		emit,
		listeners,
		target: () => service.snapshot().views[0]!,
		setEntries: (next: typeof entries) => {
			entries = next;
		},
		setActive: (next: typeof active) => {
			active = next;
		},
	};
}

function connection(id = 'consumer') {
	const controller = new AbortController();
	const owned = new Set<() => void>();
	const conn: PluginApiConnection = {
		consumerId: id,
		signal: controller.signal,
		own(dispose) {
			let live = true;
			const release = () => {
				if (live) {
					live = false;
					owned.delete(release);
					dispose();
				}
			};
			if (controller.signal.aborted) {
				release();
			} else {
				owned.add(release);
			}
			return release;
		},
		guard:
			(callback) =>
			(...args) =>
				controller.signal.aborted ? undefined : callback(...args),
	};
	return {
		conn,
		owned,
		revoke() {
			controller.abort();
			for (const release of [...owned].reverse()) {
				release();
			}
		},
	};
}

const insert: Command = (current, dispatch) => {
	dispatch?.(current.tr.insertText('!'));
	return true;
};

describe('word-processing live service', () => {
	it('exports the exact provider contract and a method-only connection', () => {
		const s = setup();
		expect(WORD_PROCESSING_PLUGIN_ID).toBe('writers-ide.word-processing');
		expect(wordProcessingApi).toEqual({ id: WORD_PROCESSING_PLUGIN_ID, major: 1 });
		const api = createWordProcessingConnection(s.service, connection().conn);
		expect(Object.getPrototypeOf(api)).toBe(Object.prototype);
		expect(Object.values(api).every((value) => typeof value === 'function')).toBe(true);
	});

	it('reads live sources without subscriptions or an active view, exposing only frozen summaries', () => {
		const s = setup();
		s.setActive(undefined);
		const snapshot = s.service.snapshot();
		expect(snapshot).toMatchObject({
			activeViewId: null,
			views: [{ viewId: 'view', documentId: 'document', name: 'Chapter', editable: true }],
		});
		expect(snapshot.views[0]).not.toHaveProperty('view');
		expect(Object.isFrozen(snapshot.views[0])).toBe(true);
		expect(s.sources.subscribe).not.toHaveBeenCalled();
		expect(s.service.edit(s.target(), ({ state }) => state.tr.insertText('!'))).toEqual({
			ok: true,
			value: true,
		});
	});

	it('tracks state/selection, view, document, name and editability identity before reactive flush', () => {
		const s = setup();
		let previous = s.target();
		const assertChanged = () => {
			const next = s.target();
			expect(next.revision).toBeGreaterThan(previous.revision);
			expect(s.service.inspect(previous, () => 1)).toEqual({ ok: false, reason: 'stale' });
			previous = next;
		};
		s.view.updateState(
			s.view.state.apply(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, 2))),
		);
		assertChanged();
		s.view.setProps({ editable: () => false });
		assertChanged();
		s.setEntries([{ viewId: 'view', documentId: 'other', name: 'Chapter', view: s.view }]);
		assertChanged();
		s.setEntries([{ viewId: 'view', documentId: 'other', name: 'Renamed', view: s.view }]);
		assertChanged();
		const replacement = new EditorView(document.createElement('div'), { state: s.view.state });
		cleanups.push(() => replacement.destroy());
		s.setEntries([{ viewId: 'view', documentId: 'other', name: 'Renamed', view: replacement }]);
		assertChanged();
	});

	it('never reuses revisions after removal/readdition or provider restart', () => {
		const s = setup();
		const first = s.target();
		s.setEntries([]);
		expect(s.service.snapshot().views).toEqual([]);
		s.setEntries([{ viewId: 'view', documentId: 'document', name: 'Chapter', view: s.view }]);
		const second = s.target();
		expect(second.revision).toBeGreaterThan(first.revision);
		const other = createWordProcessingService(s.sources);
		cleanups.push(other.dispose);
		expect(other.snapshot().views[0]!.revision).toBeGreaterThan(second.revision);
		expect(other.inspect(second, () => 1)).toEqual({ ok: false, reason: 'stale' });
	});

	it('excludes destroyed views and resolves missing active IDs to null', () => {
		const s = setup();
		const target = s.target();
		s.view.destroy();
		expect(s.service.snapshot()).toEqual({ activeViewId: null, views: [] });
		expect(s.service.inspect(target, () => 1)).toEqual({ ok: false, reason: 'unavailable' });
	});

	it('lazily shares source subscriptions and releases on the last unsubscribe', () => {
		const s = setup();
		const listener = vi.fn();
		const a = s.service.subscribe(listener);
		const b = s.service.subscribe(listener);
		expect(listener).toHaveBeenCalledTimes(2);
		expect(s.sources.subscribe).toHaveBeenCalledTimes(1);
		a();
		a();
		expect(s.stop).not.toHaveBeenCalled();
		b();
		expect(s.stop).toHaveBeenCalledTimes(1);
		const c = s.service.subscribe(listener);
		expect(s.sources.subscribe).toHaveBeenCalledTimes(2);
		c();
	});

	it('tracks reactive source replacements without relying on an event', () => {
		const s = setup();
		const listener = vi.fn();
		s.service.subscribe(listener);
		flushSync();
		listener.mockClear();
		s.setEntries([]);
		flushSync();
		expect(listener).toHaveBeenLastCalledWith({ activeViewId: null, views: [] });
	});

	it('rolls back an initially throwing subscription and isolates later failures', () => {
		const s = setup();
		expect(() =>
			s.service.subscribe(() => {
				throw new Error('initial');
			}),
		).toThrow('initial');
		expect(s.listeners.size).toBe(0);
		expect(s.stop).toHaveBeenCalledTimes(1);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		let throws = false;
		s.service.subscribe(() => {
			if (throws) {
				throw new Error('later');
			}
		});
		const peer = vi.fn();
		s.service.subscribe(peer);
		throws = true;
		s.view.updateState(state('new'));
		expect(() => s.emit()).not.toThrow();
		expect(log).toHaveBeenCalled();
		expect(peer).toHaveBeenLastCalledWith(s.service.snapshot());
	});

	it('forbids notification edits and does not lose changes read during reentrant notification', () => {
		const s = setup();
		let changed = false;
		const revisions: number[] = [];
		s.service.subscribe((snapshot) => {
			if (!changed) {
				return;
			}
			expect(s.service.edit(snapshot.views[0]!, ({ state }) => state.tr)).toEqual({
				ok: false,
				reason: 'busy',
			});
			changed = false;
			s.view.updateState(state('latest'));
			s.service.snapshot();
			s.emit();
		});
		s.service.subscribe((snapshot) => {
			revisions.push(snapshot.views[0]!.revision);
		});
		changed = true;
		s.view.updateState(state('first'));
		s.emit();
		expect(revisions.at(-1)).toBe(s.target().revision);
		expect(s.view.state.doc.textContent).toBe('latest');
		expect(s.dispatched).not.toHaveBeenCalled();
	});

	it('allows inspection of readonly views but rejects editing before calling the builder', () => {
		const s = setup();
		s.view.setProps({ editable: () => false });
		const target = s.target();
		expect(
			s.service.inspect(target, ({ view, state }) => view === s.view && state === view.state),
		).toEqual({ ok: true, value: true });
		const builder = vi.fn();
		expect(s.service.edit(target, builder)).toEqual({ ok: false, reason: 'readonly' });
		expect(builder).not.toHaveBeenCalled();
	});

	it('dispatches through the actual provider pipeline and focuses only on requested success', () => {
		const s = setup();
		const focus = vi.spyOn(s.view, 'focus').mockImplementation(() => {});
		expect(s.service.edit(s.target(), () => null, { focus: true })).toEqual({
			ok: true,
			value: false,
		});
		expect(focus).not.toHaveBeenCalled();
		expect(
			s.service.edit(s.target(), ({ state }) => state.tr.insertText('!'), { focus: true }),
		).toEqual({ ok: true, value: true });
		expect(s.dispatched).toHaveBeenCalledTimes(1);
		expect(focus).toHaveBeenCalledTimes(1);
		expect(s.view.state.doc.textContent).toBe('!hello');
	});

	it.each(['state', 'editable', 'active', 'closed', 'cancelled', 'disposed'] as const)(
		'rechecks %s changes inside callbacks before dispatch',
		(change) => {
			const s = setup();
			const abort = new AbortController();
			const target = s.target();
			const result = s.service.edit(
				target,
				({ state: current }) => {
					const transaction = current.tr.insertText('!');
					if (change === 'state') {
						s.view.updateState(state('different'));
					}
					if (change === 'editable') {
						s.view.setProps({ editable: () => false });
					}
					if (change === 'active') {
						s.setActive(null);
					}
					if (change === 'closed') {
						s.setEntries([]);
					}
					if (change === 'cancelled') {
						abort.abort();
					}
					if (change === 'disposed') {
						s.service.dispose();
					}
					return transaction;
				},
				{ signal: abort.signal, requireActive: true },
			);
			expect(result).toEqual({
				ok: false,
				reason:
					change === 'cancelled'
						? 'cancelled'
						: change === 'closed' || change === 'disposed'
							? 'unavailable'
							: 'stale',
			});
			expect(s.dispatched).not.toHaveBeenCalled();
		},
	);

	it('checks cancellation/active requirement before callbacks and after inspection', () => {
		const s = setup();
		const abort = new AbortController();
		abort.abort();
		const callback = vi.fn();
		expect(s.service.inspect(s.target(), callback, { signal: abort.signal })).toEqual({
			ok: false,
			reason: 'cancelled',
		});
		s.setActive(null);
		expect(s.service.inspect(s.target(), callback, { requireActive: true })).toEqual({
			ok: false,
			reason: 'stale',
		});
		expect(callback).not.toHaveBeenCalled();
		expect(
			s.service.inspect(s.target(), () => {
				s.view.updateState(state());
				return 42;
			}),
		).toEqual({ ok: false, reason: 'stale' });
	});

	it('rejects transactions based on another document and state changes with identical documents', () => {
		const s = setup();
		const wrong = state('wrong').tr.insertText('!');
		expect(s.service.edit(s.target(), () => wrong)).toEqual({ ok: false, reason: 'stale' });
		const target = s.target();
		const old = s.view.state.tr.insertText('!');
		s.view.updateState(
			s.view.state.apply(s.view.state.tr.setSelection(TextSelection.create(s.view.state.doc, 3))),
		);
		expect(s.service.edit(target, () => old)).toEqual({ ok: false, reason: 'stale' });
		expect(s.dispatched).not.toHaveBeenCalled();
	});

	it('rejects thenables and propagates callback errors without dispatching', async () => {
		const s = setup();
		const promise = Promise.reject(new Error('async body'));
		expect(() => s.service.inspect(s.target(), () => promise)).toThrow(TypeError);
		expect(() => s.service.edit(s.target(), (() => ({ then() {} })) as never)).toThrow(TypeError);
		expect(() =>
			s.service.edit(s.target(), () => {
				throw new Error('builder');
			}),
		).toThrow('builder');
		expect(() =>
			s.service.runCommand(s.target(), ((
				current: EditorState,
				dispatch: (tr: Transaction) => void,
			) => {
				dispatch(current.tr.insertText('!'));
				return Promise.resolve(true);
			}) as never),
		).toThrow(TypeError);
		await Promise.resolve();
		expect(s.dispatched).not.toHaveBeenCalled();
	});

	it('prevents nested editing in live callbacks', () => {
		const s = setup();
		const target = s.target();
		s.service.inspect(target, () => {
			expect(s.service.runCommand(target, insert)).toEqual({ ok: false, reason: 'busy' });
		});
		expect(s.dispatched).not.toHaveBeenCalled();
	});

	it('captures at most one command transaction and never dispatches on throw, false or late callback', () => {
		const s = setup();
		let retained: ((transaction: Transaction) => void) | undefined;
		expect(
			s.service.runCommand(s.target(), (current, dispatch, view) => {
				expect(view).toBe(s.view);
				retained = dispatch;
				dispatch?.(current.tr.insertText('!'));
				expect(s.dispatched).not.toHaveBeenCalled();
				return false;
			}),
		).toEqual({ ok: true, value: false });
		retained?.(s.view.state.tr.insertText('?'));
		expect(() =>
			s.service.runCommand(s.target(), (current, dispatch) => {
				dispatch?.(current.tr);
				dispatch?.(current.tr);
				return true;
			}),
		).toThrow(TypeError);
		expect(() =>
			s.service.runCommand(s.target(), (current, dispatch) => {
				dispatch?.(current.tr);
				throw new Error('command');
			}),
		).toThrow('command');
		expect(s.dispatched).not.toHaveBeenCalled();
		expect(s.service.runCommand(s.target(), insert)).toEqual({ ok: true, value: true });
		expect(s.dispatched).toHaveBeenCalledTimes(1);
	});

	it('strictly applies worker/cooperative results only against the captured target', () => {
		const s = setup();
		const target: EditorTarget = s.target();
		const apply = vi.fn((text: string, current: { state: EditorState }) =>
			current.state.tr.insertText(text),
		);
		expect(s.service.applyResult(target, 'analysis', apply)).toEqual({ ok: true, value: true });
		expect(s.service.applyResult(target, 'late result', apply)).toEqual({
			ok: false,
			reason: 'stale',
		});
		expect(apply).toHaveBeenCalledTimes(1);
		const fresh = s.target();
		s.setEntries([]);
		expect(s.service.applyResult(fresh, 'closed', apply)).toEqual({
			ok: false,
			reason: 'unavailable',
		});
	});

	it('revokes a disposed service idempotently, including retained facade resources', () => {
		const s = setup();
		const owner = connection();
		const api = createWordProcessingConnection(s.service, owner.conn);
		const listener = vi.fn();
		const release = api.subscribe(listener);
		api.registerCommand({ id: 'insert', name: 'Insert', command: insert });
		const target = s.target();
		s.service.dispose();
		s.service.dispose();
		release();
		expect(s.stop).toHaveBeenCalledTimes(1);
		expect(owner.owned.size).toBe(0);
		expect(api.commands()).toEqual([]);
		expect(api.snapshot()).toEqual({ activeViewId: null, views: [] });
		expect(api.runCommand(target, insert)).toEqual({ ok: false, reason: 'unavailable' });
		expect(api.subscribe(listener)).toBeTypeOf('function');
	});
});

describe('word-processing reentrancy regressions', () => {
	it('allows nested inspection while keeping edits busy until the outer callback returns', () => {
		const s = setup();
		const target = s.target();
		expect(
			s.service.inspect(target, () => {
				expect(s.service.inspect(target, ({ state }) => state.doc.textContent)).toEqual({
					ok: true,
					value: 'hello',
				});
				expect(s.service.edit(target, ({ state }) => state.tr)).toEqual({
					ok: false,
					reason: 'busy',
				});
				return 42;
			}),
		).toEqual({ ok: true, value: 42 });
		expect(
			s.service.edit(target, ({ state }) => {
				expect(s.service.inspect(target, () => 'formatting')).toEqual({
					ok: true,
					value: 'formatting',
				});
				expect(s.service.runCommand(target, insert)).toEqual({ ok: false, reason: 'busy' });
				return state.tr.insertText('!');
			}),
		).toEqual({ ok: true, value: true });
		expect(s.dispatched).toHaveBeenCalledTimes(1);
	});

	it('restores nesting depth after a throwing inner inspection and revalidates both reads', () => {
		const s = setup();
		const target = s.target();
		expect(
			s.service.inspect(target, () => {
				expect(() =>
					s.service.inspect(target, () => {
						throw new Error('inner');
					}),
				).toThrow('inner');
				expect(s.service.edit(target, () => null)).toEqual({ ok: false, reason: 'busy' });
				expect(
					s.service.inspect(target, () => {
						s.view.updateState(state('changed'));
					}),
				).toEqual({ ok: false, reason: 'stale' });
			}),
		).toEqual({ ok: false, reason: 'stale' });
		expect(s.service.runCommand(s.target(), insert)).toEqual({ ok: true, value: true });
	});

	it('releases the tracking effect after source setup throws and can retry', () => {
		const s = setup();
		vi.mocked(s.sources.subscribe).mockImplementationOnce(() => {
			throw new Error('setup');
		});
		expect(() => s.service.subscribe(vi.fn())).toThrow('setup');
		const reads = vi.spyOn(s.sources, 'listViews');
		flushSync();
		expect(reads).not.toHaveBeenCalled();
		const listener = vi.fn();
		const release = s.service.subscribe(listener);
		expect(listener).toHaveBeenCalledTimes(1);
		release();
		expect(s.listeners.size).toBe(0);
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it('shares setup with a reentrant subscription rather than creating another source listener', () => {
		const s = setup();
		const original = vi.mocked(s.sources.subscribe).getMockImplementation()!;
		const peer = vi.fn();
		let releasePeer = () => {};
		vi.spyOn(s.sources, 'subscribe').mockImplementationOnce((listener) => {
			releasePeer = s.service.subscribe(peer);
			return original(listener);
		});
		const release = s.service.subscribe(vi.fn());
		expect(s.sources.subscribe).toHaveBeenCalledTimes(1);
		expect(s.listeners.size).toBe(1);
		release();
		expect(s.stop).not.toHaveBeenCalled();
		releasePeer();
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it('keeps the source session when the last old listener releases while a new subscriber joins', () => {
		const s = setup();
		let release = () => {};
		let leaving = false;
		release = s.service.subscribe(() => {
			if (leaving) {
				release();
			}
		});
		leaving = true;
		s.view.updateState(state('before joining'));
		const peer = vi.fn();
		const releasePeer = s.service.subscribe(peer);
		expect(s.stop).not.toHaveBeenCalled();
		s.view.updateState(state('after joining'));
		s.emit();
		expect(peer).toHaveBeenLastCalledWith(s.service.snapshot());
		expect(peer).toHaveBeenCalledTimes(2);
		releasePeer();
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it('aggregates initial subscriber and source cleanup failures without retaining the effect', () => {
		const s = setup();
		vi.mocked(s.sources.subscribe).mockImplementationOnce(() => () => {
			throw new Error('cleanup');
		});
		let caught: unknown;
		try {
			s.service.subscribe(() => {
				throw new Error('initial');
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(AggregateError);
		expect((caught as AggregateError).errors.map((error: Error) => error.message)).toEqual([
			'initial',
			'cleanup',
		]);
		const reads = vi.spyOn(s.sources, 'listViews');
		flushSync();
		expect(reads).not.toHaveBeenCalled();
	});

	it('does not tear down pending setup when a reentrant subscriber immediately releases', () => {
		const s = setup();
		const original = vi.mocked(s.sources.subscribe).getMockImplementation()!;
		vi.mocked(s.sources.subscribe).mockImplementationOnce((listener) => {
			const release = s.service.subscribe(vi.fn());
			release();
			return original(listener);
		});
		const listener = vi.fn();
		const release = s.service.subscribe(listener);
		expect(s.stop).not.toHaveBeenCalled();
		s.view.updateState(state('updated'));
		s.emit();
		expect(listener).toHaveBeenLastCalledWith(s.service.snapshot());
		release();
		expect(s.listeners.size).toBe(0);
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it('releases late source setup after disposal without delivering or retaining an effect', () => {
		const s = setup();
		const stop = vi.fn();
		vi.mocked(s.sources.subscribe).mockImplementationOnce(() => {
			s.service.dispose();
			return stop;
		});
		const listener = vi.fn();
		const release = s.service.subscribe(listener);
		release();
		expect(listener).not.toHaveBeenCalled();
		expect(stop).toHaveBeenCalledTimes(1);
		const reads = vi.spyOn(s.sources, 'listViews');
		flushSync();
		expect(reads).not.toHaveBeenCalled();
	});

	it('lets an initial subscriber add a peer and dispose without leaving source subscriptions', () => {
		const s = setup();
		const peer = vi.fn();
		const release = s.service.subscribe(() => {
			s.service.subscribe(peer);
			s.service.dispose();
		});
		release();
		flushSync();
		expect(peer).toHaveBeenCalledTimes(1);
		expect(s.listeners.size).toBe(0);
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it('keeps source cleanup idempotent when it throws and allows a new session', () => {
		const s = setup();
		const stop = vi.fn(() => {
			throw new Error('stop');
		});
		vi.mocked(s.sources.subscribe).mockImplementationOnce(() => stop);
		const release = s.service.subscribe(vi.fn());
		expect(release).toThrow('stop');
		expect(release).not.toThrow();
		expect(stop).toHaveBeenCalledTimes(1);
		const next = s.service.subscribe(vi.fn());
		next();
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it.each(['cancelled', 'readonly', 'closed', 'replaced', 'active', 'revoked'] as const)(
		'drops a captured command after a synchronous %s change before dispatch',
		(change) => {
			const s = setup();
			const owner = connection();
			const api = createWordProcessingConnection(s.service, owner.conn);
			const abort = new AbortController();
			const focus = vi.spyOn(s.view, 'focus').mockImplementation(() => {});
			const result = api.runCommand(
				s.target(),
				(current, dispatch) => {
					dispatch?.(current.tr.insertText('!'));
					if (change === 'cancelled') {
						abort.abort();
					}
					if (change === 'readonly') {
						s.view.setProps({ editable: () => false });
					}
					if (change === 'closed') {
						s.setEntries([]);
					}
					if (change === 'replaced') {
						const replacement = new EditorView(document.createElement('div'), { state: current });
						cleanups.push(() => replacement.destroy());
						s.setEntries([
							{ viewId: 'view', documentId: 'document', name: 'Chapter', view: replacement },
						]);
					}
					if (change === 'active') {
						s.setActive(null);
					}
					if (change === 'revoked') {
						owner.revoke();
					}
					return true;
				},
				{ signal: abort.signal, requireActive: true, focus: true },
			);
			expect(result).toEqual({
				ok: false,
				reason:
					change === 'cancelled'
						? 'cancelled'
						: change === 'closed'
							? 'unavailable'
							: change === 'revoked'
								? 'revoked'
								: 'stale',
			});
			expect(s.dispatched).not.toHaveBeenCalled();
			expect(focus).not.toHaveBeenCalled();
		},
	);

	it('ignores retained dispatch during a later invocation, even against its live target', () => {
		const s = setup();
		let retained: ((tr: Transaction) => void) | undefined;
		s.service.runCommand(s.target(), (_state, dispatch) => {
			retained = dispatch;
			return true;
		});
		expect(
			s.service.runCommand(s.target(), (state, dispatch) => {
				retained?.(state.tr.insertText('old'));
				dispatch?.(state.tr.insertText('new'));
				return true;
			}),
		).toEqual({ ok: true, value: true });
		expect(s.dispatched).toHaveBeenCalledTimes(1);
		expect(s.view.state.doc.textContent).toBe('newhello');
	});

	it('drops captured edits if a command releases and replaces its registration under another consumer', () => {
		const s = setup();
		const owner = connection('owner');
		const caller = createWordProcessingConnection(s.service, connection('caller').conn);
		const api = createWordProcessingConnection(s.service, owner.conn);
		let release = () => {};
		release = api.registerCommand({
			id: 'replace',
			name: 'Replace',
			command: (state, dispatch) => {
				dispatch?.(state.tr.insertText('old'));
				release();
				api.registerCommand({ id: 'replace', name: 'New', command: insert });
				return true;
			},
		});
		expect(caller.executeCommand(s.target(), 'replace')).toEqual({ ok: true, value: false });
		expect(s.dispatched).not.toHaveBeenCalled();
		expect(caller.executeCommand(s.target(), 'replace')).toEqual({ ok: true, value: true });
	});

	it.each(['closed', 'revoked', 'cancelled', 'readonly', 'active'] as const)(
		'does not focus after dispatch synchronously makes the target %s',
		(change) => {
			const s = setup();
			const owner = connection();
			const api = createWordProcessingConnection(s.service, owner.conn);
			const abort = new AbortController();
			const focus = vi.spyOn(s.view, 'focus').mockImplementation(() => {});
			s.view.setProps({
				dispatchTransaction() {
					if (change === 'closed') {
						s.setEntries([]);
					}
					if (change === 'revoked') {
						owner.revoke();
					}
					if (change === 'cancelled') {
						abort.abort();
					}
					if (change === 'readonly') {
						s.view.setProps({ editable: () => false });
					}
					if (change === 'active') {
						s.setActive(null);
					}
				},
			});
			expect(
				api.runCommand(s.target(), insert, {
					signal: abort.signal,
					focus: true,
					requireActive: true,
				}),
			).toEqual({ ok: true, value: true });
			expect(focus).not.toHaveBeenCalled();
		},
	);
});

describe('word-processing task lifecycle', () => {
	it('keeps cooperative progress separate, rejects results after a yield, and cancels on endpoint closure', async () => {
		const s = setup();
		const owner = connection();
		const api = createWordProcessingConnection(s.service, owner.conn);
		const frames = new Map<number, FrameRequestCallback>();
		let frameId = 0;
		let now = 0;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
			frameId++;
			frames.set(frameId, callback);
			return frameId;
		});
		vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
			frames.delete(id);
		});
		const frame = () => {
			const pending = [...frames.values()];
			frames.clear();
			for (const callback of pending) {
				callback(now);
			}
		};
		const tasks = createTaskService({
			queue: new WorkQueue(),
			ownerId: 'consumer',
			signal: owner.conn.signal,
		});
		cleanups.push(tasks.dispose);
		const target = s.target();
		const handle = tasks.cooperative({
			key: 'analysis',
			label: 'Analysis',
			create: function* ({ signal }) {
				now += 8;
				yield { completed: 1, total: 2 };
				return api.applyResult(target, 'result', (text, { state }) => state.tr.insertText(text), {
					signal,
				});
			},
		});
		expect(handle.status).toBe('queued');
		frame();
		expect(handle.progress.completed).toBe(1);
		handle.pause();
		expect(handle.status).toBe('paused');
		s.view.updateState(state('intervening edit'));
		handle.resume();
		frame();
		expect(await handle.result).toEqual({
			status: 'completed',
			value: { ok: false, reason: 'stale' },
		});
		const apply = vi.fn();
		const pending = tasks.cooperative({
			key: 'pending',
			label: 'Pending',
			create: function* () {
				now += 8;
				yield { completed: 1 };
				apply();
			},
		});
		frame();
		owner.revoke();
		expect(await pending.result).toEqual({ status: 'cancelled' });
		frame();
		expect(apply).not.toHaveBeenCalled();
		expect(s.dispatched).not.toHaveBeenCalled();
	});
});

describe('word-processing connection ownership', () => {
	it('owns global command IDs and removes only the deactivated owners registrations', () => {
		const s = setup();
		const a = connection('a');
		const b = connection('b');
		const first = createWordProcessingConnection(s.service, a.conn);
		const second = createWordProcessingConnection(s.service, b.conn);
		const release = first.registerCommand({ id: 'insert', name: 'Insert', command: insert });
		second.registerCommand({ id: 'peer', name: 'Peer', command: insert });
		expect(() =>
			second.registerCommand({ id: 'insert', name: 'Duplicate', command: insert }),
		).toThrow('Duplicate');
		expect(second.commands()).toEqual([
			{ id: 'insert', name: 'Insert', ownerId: 'a' },
			{ id: 'peer', name: 'Peer', ownerId: 'b' },
		]);
		expect(second.executeCommand(s.target(), 'insert')).toEqual({ ok: true, value: true });
		a.revoke();
		release();
		expect(second.commands()).toEqual([{ id: 'peer', name: 'Peer', ownerId: 'b' }]);
		expect(second.executeCommand(s.target(), 'insert')).toEqual({
			ok: false,
			reason: 'unknown-command',
		});
		expect(first.runCommand(s.target(), insert)).toEqual({ ok: false, reason: 'revoked' });
		const replacement = second.registerCommand({ id: 'insert', name: 'New', command: insert });
		release();
		expect(second.commands()).toHaveLength(2);
		replacement();
	});

	it('cleans subscriptions on revocation even during the initial callback', () => {
		const s = setup();
		const c = connection();
		const api = createWordProcessingConnection(s.service, c.conn);
		const listener = vi.fn(() => c.revoke());
		const release = api.subscribe(listener);
		release();
		s.emit();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(s.listeners.size).toBe(0);
		expect(s.stop).toHaveBeenCalledTimes(1);
	});

	it('rejects dispatch when the invoking endpoint deactivates inside any callback', () => {
		const s = setup();
		for (const operation of ['edit', 'inspect', 'command', 'result'] as const) {
			const c = connection();
			const api = createWordProcessingConnection(s.service, c.conn);
			const build = ({ state }: { state: EditorState }) => {
				c.revoke();
				return state.tr.insertText('!');
			};
			let result;
			if (operation === 'edit') {
				result = api.edit(s.target(), build);
			}
			if (operation === 'inspect') {
				result = api.inspect(s.target(), build);
			}
			if (operation === 'result') {
				result = api.applyResult(s.target(), 1, (_result, current) => build(current));
			}
			if (operation === 'command') {
				result = api.runCommand(s.target(), (state, dispatch) => {
					dispatch?.(state.tr);
					c.revoke();
					return true;
				});
			}
			expect(result).toEqual({ ok: false, reason: 'revoked' });
		}
		expect(s.dispatched).not.toHaveBeenCalled();
	});

	it('does not apply a command whose different owner deactivates during execution', () => {
		const s = setup();
		const owner = connection('owner');
		const api = createWordProcessingConnection(s.service, owner.conn);
		api.registerCommand({
			id: 'self-removal',
			name: 'Remove',
			command: (state, dispatch) => {
				dispatch?.(state.tr.insertText('!'));
				owner.revoke();
				return true;
			},
		});
		expect(s.service.executeCommand(s.target(), 'self-removal')).toEqual({
			ok: true,
			value: false,
		});
		expect(s.dispatched).not.toHaveBeenCalled();
	});

	it('keeps independent services isolated and makes late retained disposers harmless', () => {
		const s = setup();
		const other = createWordProcessingService(s.sources);
		cleanups.push(other.dispose);
		s.service.registerCommand({ id: 'same', name: 'First', command: insert });
		other.registerCommand({ id: 'same', name: 'Second', command: insert });
		s.service.dispose();
		expect(other.commands()).toMatchObject([{ id: 'same', name: 'Second' }]);
	});
});
