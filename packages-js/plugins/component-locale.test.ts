import { describe, expect, it, vi } from 'vitest';
import { createActivationLocale } from './component-locale';
import { createHost, descriptor } from './command-component-fixture';
import type { CommandContext } from './command-component-model';
import type { LocaleSnapshot, PluginLocale } from './frontend';

function localeSource(initial: LocaleSnapshot = { languageTag: 'en-US', direction: 'ltr' }) {
	let current = initial;
	const listeners = new Set<(value: LocaleSnapshot) => void>();
	const release = vi.fn();
	const source: PluginLocale = {
		snapshot: () => current,
		subscribe(listener) {
			listeners.add(listener);
			listener(current);
			return () => {
				listeners.delete(listener);
				release();
			};
		},
	};
	return {
		source,
		listeners,
		release,
		set(value: LocaleSnapshot) {
			current = value;
			for (const listener of [...listeners]) {
				if (listeners.has(listener)) {
					listener(value);
				}
			}
		},
	};
}

function scope(source: PluginLocale) {
	const controller = new AbortController();
	let live = true;
	const cleanups = new Set<() => void>();
	const onError = vi.fn();
	const service = createActivationLocale({
		source,
		signal: controller.signal,
		isLive: () => live,
		onError,
		callback: (callback) => callback(),
		own(dispose) {
			let active = true;
			const release = () => {
				if (active) {
					active = false;
					cleanups.delete(release);
					dispose();
				}
			};
			if (!live) {
				release();
			} else {
				cleanups.add(release);
			}
			return release;
		},
	});
	return {
		service,
		controller,
		onError,
		markStopped() {
			live = false;
		},
		stop() {
			live = false;
			controller.abort();
			for (const release of [...cleanups]) {
				release();
			}
		},
	};
}

function activate(host: ReturnType<typeof createHost>, id = 'component') {
	let context!: CommandContext;
	host.register(
		descriptor(id, (value) => {
			context = value;
		}),
	);
	host.activate(id);
	return context;
}

describe('activation-owned UI locale', () => {
	it('copies and freezes snapshots without exposing or normalizing source data', () => {
		const initial = { languageTag: 'ar-EG', direction: 'rtl' as const };
		const source = localeSource(initial);
		const current = scope(source.source);
		const value = current.service.snapshot();
		expect(value).toEqual(initial);
		expect(value).not.toBe(initial);
		expect(Object.isFrozen(value)).toBe(true);
		expect(Object.isFrozen(current.service)).toBe(true);
		initial.languageTag = 'he-IL';
		expect(value.languageTag).toBe('ar-EG');
		expect(current.service.snapshot().languageTag).toBe('he-IL');
		current.stop();
	});

	it('delivers immediately and on language or direction changes, with idempotent early release', () => {
		const source = localeSource();
		const current = scope(source.source);
		const listener = vi.fn();
		const release = current.service.subscribe(listener);
		expect(listener).toHaveBeenLastCalledWith({ languageTag: 'en-US', direction: 'ltr' });
		source.set({ languageTag: 'ar', direction: 'rtl' });
		source.set({ languageTag: 'ar', direction: 'ltr' });
		expect(listener).toHaveBeenCalledTimes(3);
		expect(Object.isFrozen(listener.mock.calls[1][0])).toBe(true);
		release();
		release();
		expect(source.listeners.size).toBe(0);
		expect(source.release).toHaveBeenCalledOnce();
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(listener).toHaveBeenCalledTimes(3);
		current.stop();
		expect(source.release).toHaveBeenCalledOnce();
	});

	it('keeps peer subscriptions independent and reports failures without unsubscribing', () => {
		const source = localeSource();
		const current = scope(source.source);
		const failing = vi.fn(() => {
			throw new Error('private message');
		});
		const peer = vi.fn();
		current.service.subscribe(failing);
		const release = current.service.subscribe(peer);
		source.set({ languageTag: 'de', direction: 'ltr' });
		expect(failing).toHaveBeenCalledTimes(2);
		expect(peer).toHaveBeenCalledTimes(2);
		expect(current.onError).toHaveBeenCalledTimes(2);
		expect(current.onError.mock.calls).toEqual([[], []]);
		release();
		expect(source.listeners.size).toBe(1);
		current.stop();
		expect(source.listeners.size).toBe(0);
	});

	it('observes asynchronous listener rejections and ignores stale completion', async () => {
		const source = localeSource();
		const current = scope(source.source);
		current.service.subscribe(async () => {
			throw new Error('private async message');
		});
		await Promise.resolve();
		await Promise.resolve();
		expect(current.onError).toHaveBeenCalledOnce();
		source.set({ languageTag: 'fr', direction: 'ltr' });
		current.stop();
		await Promise.resolve();
		await Promise.resolve();
		expect(current.onError).toHaveBeenCalledOnce();
	});

	it('suppresses delivery and rejects old reads before its signal is aborted', () => {
		const source = localeSource();
		const current = scope(source.source);
		const listener = vi.fn();
		current.service.subscribe(listener);
		current.markStopped();
		expect(current.controller.signal.aborted).toBe(false);
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(listener).toHaveBeenCalledOnce();
		expect(() => current.service.snapshot()).toThrow('revoked');
		expect(() => current.service.subscribe(listener)).toThrow('revoked');
		current.stop();
		expect(source.listeners.size).toBe(0);
	});

	it('cleans up a source whose immediate callback aborts setup', () => {
		const source = localeSource();
		const current = scope(source.source);
		const release = current.service.subscribe(() => current.stop());
		expect(source.listeners.size).toBe(0);
		expect(source.release).toHaveBeenCalledOnce();
		release();
		expect(source.release).toHaveBeenCalledOnce();
	});

	it('removes its abort listener when source setup throws', () => {
		const failure = new Error('source setup failed');
		const source = localeSource().source;
		source.subscribe = () => {
			throw failure;
		};
		const current = scope(source);
		const remove = vi.spyOn(current.controller.signal, 'removeEventListener');
		expect(() => current.service.subscribe(() => undefined)).toThrow(failure);
		expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
		current.stop();
	});

	it('reports source cleanup failures on abort without an uncaught listener error', () => {
		const source = localeSource().source;
		source.subscribe = (listener) => {
			listener(source.snapshot());
			return () => {
				throw new Error('private cleanup failure');
			};
		};
		const current = scope(source);
		current.service.subscribe(() => undefined);
		expect(() => current.stop()).not.toThrow();
		expect(current.onError).toHaveBeenCalledOnce();
	});

	it('does not replay an older snapshot after a nested source change', () => {
		const source = localeSource();
		const current = scope(source.source);
		current.service.subscribe((value) => {
			if (value.languageTag === 'fr') {
				source.set({ languageTag: 'ar', direction: 'rtl' });
			}
		});
		const seen: string[] = [];
		current.service.subscribe((value) => seen.push(value.languageTag));
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(seen).toEqual(['en-US', 'ar']);
		current.stop();
	});

	it('does not deliver after source reads release the subscription', () => {
		const source = localeSource();
		const current = scope(source.source);
		const listener = vi.fn();
		const release = current.service.subscribe(listener);
		const read = source.source.snapshot;
		source.source.snapshot = () => {
			release();
			return read();
		};
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(listener).toHaveBeenCalledOnce();
		expect(source.listeners.size).toBe(0);
		expect(source.release).toHaveBeenCalledOnce();
		current.stop();
	});

	it('serializes nested changes until the active listener returns', () => {
		const source = localeSource();
		const current = scope(source.source);
		const order: string[] = [];
		let renderedLanguage = '';
		current.service.subscribe((value) => {
			order.push(`enter ${value.languageTag}`);
			if (value.languageTag === 'fr') {
				source.set({ languageTag: 'ar', direction: 'rtl' });
			}
			renderedLanguage = value.languageTag;
			order.push(`exit ${value.languageTag}`);
		});
		order.length = 0;
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(order).toEqual(['enter fr', 'exit fr', 'enter ar', 'exit ar']);
		expect(renderedLanguage).toBe('ar');
		current.stop();
	});

	it('discards a stale read when the source changes during snapshot acquisition', () => {
		const source = localeSource();
		const current = scope(source.source);
		const seen: string[] = [];
		current.service.subscribe((value) => seen.push(value.languageTag));
		const read = source.source.snapshot;
		let changed = false;
		source.source.snapshot = () => {
			const value = read();
			if (!changed && value.languageTag === 'fr') {
				changed = true;
				source.set({ languageTag: 'ar', direction: 'rtl' });
			}
			return value;
		};
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(seen).toEqual(['en-US', 'ar']);
		current.stop();
	});

	it('rejects malformed host snapshots rather than inventing a locale', () => {
		for (const value of [
			{ languageTag: '', direction: 'ltr' },
			{ languageTag: 'en', direction: 'bad' },
		]) {
			const current = scope({
				snapshot: () => value as LocaleSnapshot,
				subscribe: () => () => undefined,
			});
			expect(() => current.service.snapshot()).toThrow('Locale sources');
			current.stop();
		}
	});

	it('owns locale subscriptions through rollback and creates independent reactivation services', () => {
		const source = localeSource();
		const host = createHost({ locale: source.source });
		let old!: CommandContext;
		const failedListener = vi.fn();
		host.register(
			descriptor('failed', (context) => {
				old = context;
				context.locale.subscribe(failedListener);
				throw new Error('setup failed');
			}),
		);
		expect(() => host.activate('failed')).toThrow('setup failed');
		expect(source.listeners.size).toBe(0);
		expect(() => old.locale.snapshot()).toThrow('revoked');
		const context = activate(host);
		const listener = vi.fn();
		context.locale.subscribe(listener);
		host.deactivate('component');
		host.activate('component');
		expect(() => context.locale.subscribe(listener)).toThrow('revoked');
		source.set({ languageTag: 'he', direction: 'rtl' });
		expect(listener).toHaveBeenCalledOnce();
		expect(failedListener).toHaveBeenCalledOnce();
		host.dispose();
	});

	it('guards lifecycle mutation during locale delivery without losing future updates', () => {
		const source = localeSource();
		const host = createHost({ locale: source.source });
		const context = activate(host);
		context.locale.subscribe(() => host.deactivate('component'));
		expect(host.get('component')?.status).toBe('active');
		expect(host.get('component')?.errors).toEqual(['locale-listener-failed']);
		source.set({ languageTag: 'fr', direction: 'ltr' });
		expect(host.get('component')?.errors).toEqual([
			'locale-listener-failed',
			'locale-listener-failed',
		]);
		host.dispose();
		expect(source.listeners.size).toBe(0);
	});
});
