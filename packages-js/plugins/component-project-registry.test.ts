import { describe, expect, it, vi } from 'vitest';
import { ComponentProjectRegistry } from './component-project-registry';
import type { ProjectReference } from './frontend';

describe('ComponentProjectRegistry', () => {
	it('mints frozen host metadata and resolves only live issued openings', () => {
		const registry = new ComponentProjectRegistry();
		expect(registry.selected()).toBeNull();
		expect(registry.reference('unknown')).toBeUndefined();
		const reference = registry.open(' stable ID ', 'Display name');
		expect(reference).toEqual({
			id: ' stable ID ',
			openingId: expect.any(String),
			name: 'Display name',
		});
		expect(reference.openingId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
		expect(Object.isFrozen(reference)).toBe(true);
		expect(registry.reference(reference.openingId)).toBe(reference);
		expect(() => registry.assert(reference)).not.toThrow();
		expect(registry.selected()).toBeNull();
	});

	it('validates metadata without inventing limits or normalizing strings', () => {
		const registry = new ComponentProjectRegistry();
		for (const id of ['', ' \t\n', null, 12]) {
			expect(() => registry.open(id as string, 'name')).toThrow('nonblank string');
		}
		for (const name of [null, undefined, 12, {}]) {
			expect(() => registry.open('id', name as string)).toThrow('name must be a string');
		}
		expect(registry.open('id', '').name).toBe('');
		const long = 'x'.repeat(100_000);
		expect(registry.open(long, long).name).toBe(long);
		expect(registry.list()).toHaveLength(2);
	});

	it('refuses an already-open stable ID without replacing its opening', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'first');
		expect(() => registry.open('id', 'second')).toThrow('already open');
		expect(registry.list()).toEqual([reference]);
		expect(registry.reference(reference.openingId)).toBe(reference);
	});

	it('rejects copied, forged, foreign and proxy references without reading sender fields', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'name');
		const foreign = new ComponentProjectRegistry().open('id', 'name');
		const read = vi.fn(() => {
			throw new Error('sender fields must not be read');
		});
		const forged = Object.defineProperties(
			{},
			{
				id: { get: read },
				openingId: { get: read },
				name: { get: read },
			},
		) as ProjectReference;
		const proxy = new Proxy(reference, { get: read, getPrototypeOf: read });
		const revoked = Proxy.revocable(reference, {});
		revoked.revoke();
		for (const invalid of [
			{ ...reference },
			foreign,
			forged,
			proxy,
			revoked.proxy,
			null,
			undefined,
			'id',
		]) {
			const value = invalid as ProjectReference;
			expect(() => registry.assert(value)).toThrow('not a live opening');
			if (value !== null) {
				expect(() => registry.select(value)).toThrow('not a live opening');
			}
			const teardown = vi.fn();
			expect(() => registry.close(value, teardown)).toThrow('not a live opening');
			expect(teardown).not.toHaveBeenCalled();
		}
		expect(read).not.toHaveBeenCalled();
		expect(registry.list()).toEqual([reference]);
	});

	it('keeps a closed reference forever stale when its stable ID reopens', () => {
		const registry = new ComponentProjectRegistry();
		const old = registry.open('id', 'old');
		registry.close(old, () => undefined);
		const current = registry.open('id', 'new');
		expect(current).not.toBe(old);
		expect(current.openingId).not.toBe(old.openingId);
		expect(current.id).toBe(old.id);
		expect(registry.reference(old.openingId)).toBeUndefined();
		expect(registry.reference(current.openingId)).toBe(current);
		expect(() => registry.assert(old)).toThrow('not a live opening');
		expect(() => registry.select(old)).toThrow('not a live opening');
		expect(() => registry.close(old, () => undefined)).toThrow('not a live opening');
		expect(registry.selected()).toBeNull();
	});

	it('delivers explicit selection changes including null, but not opens or repeats', () => {
		const registry = new ComponentProjectRegistry();
		const listener = vi.fn();
		registry.subscribeSelected(listener);
		const first = registry.open('first', 'first');
		const second = registry.open('second', 'second');
		registry.select(null);
		expect(listener.mock.calls).toEqual([[null]]);
		registry.select(first);
		registry.select(first);
		registry.select(second);
		registry.select(null);
		registry.select(null);
		expect(listener.mock.calls).toEqual([[null], [first], [second], [null]]);
		registry.select(first);
		const late = vi.fn();
		registry.subscribeSelected(late);
		expect(late.mock.calls).toEqual([[first]]);
	});

	it('supports independent subscriptions to the same callback and idempotent early release', () => {
		const registry = new ComponentProjectRegistry();
		const listener = vi.fn();
		const stop = registry.subscribeSelected(listener);
		const stopPeer = registry.subscribeSelected(listener);
		stop();
		stop();
		const reference = registry.open('id', 'name');
		registry.select(reference);
		expect(listener.mock.calls).toEqual([[null], [null], [reference]]);
		stopPeer();
		registry.select(null);
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it('serializes nested subscriptions and lets early release suppress queued deliveries', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'name');
		const order: string[] = [];
		const nested = vi.fn((value) => {
			expect(value).toBe(registry.selected());
			order.push('nested');
		});
		let stopPeer: () => void = () => undefined;
		registry.subscribeSelected((value) => {
			if (value !== null) {
				order.push('enter');
				registry.subscribeSelected(nested);
				const stop = registry.subscribeSelected(() => order.push('released'));
				stop();
				stopPeer();
				order.push('exit');
			}
		});
		const peer = vi.fn();
		stopPeer = registry.subscribeSelected(peer);
		registry.select(reference);
		expect(order).toEqual(['enter', 'exit', 'nested']);
		expect(nested).toHaveBeenCalledExactlyOnceWith(reference);
		expect(peer).toHaveBeenCalledExactlyOnceWith(null);
	});

	it('isolates synchronous throws and async rejections without logging or blocking siblings', async () => {
		const registry = new ComponentProjectRegistry();
		const logs = ['log', 'warn', 'error'] as const;
		const spies = logs.map((method) => vi.spyOn(console, method));
		try {
			const throwing = vi.fn(() => {
				throw new Error('private synchronous data');
			});
			const rejecting = vi.fn(async () => {
				throw new Error('private asynchronous data');
			});
			registry.subscribeSelected(throwing);
			registry.subscribeSelected(rejecting);
			const peer = vi.fn();
			registry.subscribeSelected(peer);
			const reference = registry.open('id', 'name');
			registry.select(reference);
			registry.close(reference, () => undefined);
			await Promise.resolve();
			await Promise.resolve();
			expect(throwing).toHaveBeenCalledTimes(3);
			expect(rejecting).toHaveBeenCalledTimes(3);
			expect(peer.mock.calls).toEqual([[null], [reference], [null]]);
			for (const spy of spies) {
				expect(spy).not.toHaveBeenCalled();
			}
		} finally {
			for (const spy of spies) {
				spy.mockRestore();
			}
		}
	});

	it('rejects all mutations consistently during immediate and changed selection delivery', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'name');
		const failures: unknown[] = [];
		registry.subscribeSelected(() => {
			for (const mutate of [
				() => registry.open('other', 'other'),
				() => registry.select(null),
				() => registry.close(reference, () => undefined),
			]) {
				try {
					mutate();
				} catch (error) {
					failures.push((error as Error).message);
				}
			}
			expect(registry.reference(reference.openingId)).toBe(reference);
			registry.assert(reference);
		});
		registry.select(reference);
		expect(failures).toEqual(Array(6).fill('Project registry is busy.'));
		expect(registry.selected()).toBe(reference);
		expect(registry.list()).toEqual([reference]);
		registry.open('other', 'other');
	});

	it('marks closure dead before teardown and delivers selection only after teardown returns', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'name');
		registry.select(reference);
		const order: string[] = [];
		const listener = vi.fn(() => order.push('selection'));
		registry.subscribeSelected(listener);
		order.length = 0;
		const nested = vi.fn(() => order.push('nested'));
		registry.close(reference, () => {
			order.push('teardown enter');
			expect(registry.selected()).toBeNull();
			expect(registry.reference(reference.openingId)).toBeUndefined();
			expect(registry.list()).toEqual([]);
			expect(() => registry.assert(reference)).toThrow('not a live opening');
			for (const mutate of [
				() => registry.open('id', 'reopen'),
				() => registry.open('other', 'other'),
				() => registry.select(null),
				() => registry.close(reference, () => undefined),
			]) {
				expect(mutate).toThrow('Project registry is busy.');
			}
			registry.subscribeSelected(nested);
			expect(nested).not.toHaveBeenCalled();
			expect(listener).toHaveBeenCalledOnce();
			order.push('teardown exit');
		});
		expect(order).toEqual(['teardown enter', 'teardown exit', 'selection', 'nested']);
		expect(listener).toHaveBeenLastCalledWith(null);
		expect(nested).toHaveBeenCalledExactlyOnceWith(null);
		expect(registry.open('id', 'reopen').openingId).not.toBe(reference.openingId);
	});

	it('still notifies and releases busy state when teardown throws, preserving the original error', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'name');
		registry.select(reference);
		const listener = vi.fn();
		registry.subscribeSelected(listener);
		registry.subscribeSelected(() => {
			throw new Error('observer error');
		});
		const failure = { private: 'original teardown error' };
		let caught: unknown;
		try {
			registry.close(reference, () => {
				throw failure;
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBe(failure);
		expect(listener.mock.calls).toEqual([[reference], [null]]);
		expect(registry.selected()).toBeNull();
		expect(() => registry.assert(reference)).toThrow('not a live opening');
		expect(registry.open('id', 'reopen')).not.toBe(reference);
	});

	it('does not emit a selection change when closing a nonselected opening, even on failure', () => {
		const registry = new ComponentProjectRegistry();
		const selected = registry.open('selected', 'selected');
		registry.select(selected);
		const listener = vi.fn();
		registry.subscribeSelected(listener);
		for (const fail of [false, true]) {
			const reference = registry.open('other', 'other');
			const close = () =>
				registry.close(reference, () => {
					if (fail) {
						throw new Error('teardown failed');
					}
				});
			if (fail) {
				expect(close).toThrow('teardown failed');
			} else {
				close();
			}
			expect(registry.reference(reference.openingId)).toBeUndefined();
		}
		expect(registry.selected()).toBe(selected);
		expect(listener).toHaveBeenCalledExactlyOnceWith(selected);
	});

	it('returns frozen independent list snapshots containing only live issuer references', () => {
		const registry = new ComponentProjectRegistry();
		const empty = registry.list();
		const first = registry.open('first', 'first');
		const snapshot = registry.list();
		const second = registry.open('second', 'second');
		registry.close(first, () => undefined);
		expect(Object.isFrozen(empty)).toBe(true);
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(empty).toEqual([]);
		expect(snapshot).toEqual([first]);
		expect(registry.list()).toEqual([second]);
		expect(registry.list()[0]).toBe(second);
		expect(registry.list()).not.toBe(registry.list());
	});

	it('rejects invalid callbacks without changing registry state', () => {
		const registry = new ComponentProjectRegistry();
		const reference = registry.open('id', 'name');
		registry.select(reference);
		expect(() => registry.subscribeSelected(null as never)).toThrow('listener must be a function');
		expect(() => registry.close(reference, null as never)).toThrow('callback must be a function');
		registry.assert(reference);
		expect(registry.selected()).toBe(reference);
	});
});
