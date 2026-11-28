import { describe, expect, it, vi } from 'vitest';
import { createProviderFacade } from './provider-facade';

const synchronousError = 'API factory must return a synchronous method-only facade';
const methodsError =
	'API facade must contain only own string-named methods (no accessors, symbols or thenables)';
const prototypeError = 'API facade must be a plain method-only object';
const revokedMessage = 'Plugin API revoked: provider/test.value';

interface MethodApi {
	method(...args: unknown[]): unknown;
}

describe('createProviderFacade', () => {
	it.each(['plain', 'null-prototype'])(
		'wraps %s methods with the original receiver and arguments',
		(kind) => {
			const result = {};
			const method = vi.fn(function (this: unknown, ...args: unknown[]) {
				expect(this).toBe(implementation);
				expect(args).toEqual([result, 42, undefined]);
				return result;
			});
			const implementation = Object.create(kind === 'plain' ? Object.prototype : null);
			Object.defineProperty(implementation, 'method', { value: method });
			const live = vi.fn(() => true);
			const facade = createProviderFacade(implementation, live, revokedMessage) as MethodApi;

			expect(method).not.toHaveBeenCalled();
			expect(live).not.toHaveBeenCalled();
			expect(Object.getPrototypeOf(facade)).toBeNull();
			expect(Object.isFrozen(facade)).toBe(true);
			expect(Reflect.ownKeys(facade)).toEqual(['method']);
			expect(facade.method).not.toBe(method);
			expect(Reflect.set(facade, 'method', () => {})).toBe(false);
			const detached = facade.method;
			expect(detached.call({}, result, 42, undefined)).toBe(result);
			expect(method).toHaveBeenCalledTimes(1);
			expect(live).toHaveBeenCalledTimes(1);
		},
	);

	it('captures methods during validation rather than reading them on invocation', () => {
		const implementation = { method: () => 'original' };
		const facade = createProviderFacade(implementation, () => true, revokedMessage) as MethodApi;
		implementation.method = () => 'replacement';
		expect(facade.method()).toBe('original');
	});

	it.each([{}, Object.create(null)])('accepts an empty method-only object', (implementation) => {
		const facade = createProviderFacade(implementation, () => true, revokedMessage);
		expect(Reflect.ownKeys(facade)).toEqual([]);
		expect(Object.getPrototypeOf(facade)).toBeNull();
		expect(Object.isFrozen(facade)).toBe(true);
	});

	it.each([null, undefined, false, 1, 'value', Symbol('value'), () => {}])(
		'rejects non-object factory result %s',
		(implementation) => {
			expect(() => createProviderFacade(implementation, () => true, revokedMessage)).toThrow(
				synchronousError,
			);
		},
	);

	it.each([
		{ value: 1 },
		{ value: null },
		{ nested: { method() {} } },
		{ [Symbol('method')]: () => {} },
		{ then() {} },
		{ then: undefined },
	])('rejects unsupported own properties without calling methods', (implementation) => {
		expect(() => createProviderFacade(implementation, () => true, revokedMessage)).toThrow(
			methodsError,
		);
	});

	it('rejects accessors without invoking getters, setters, or otherwise valid methods', () => {
		const get = vi.fn();
		const set = vi.fn();
		const method = vi.fn();
		for (const descriptor of [{ get }, { set }, { get, set }]) {
			const implementation = Object.defineProperty({ method }, 'accessor', descriptor);
			expect(() => createProviderFacade(implementation, () => true, revokedMessage)).toThrow(
				methodsError,
			);
		}
		expect(get).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(method).not.toHaveBeenCalled();
	});

	it('rejects inherited methods, inherited thenables, and class instances without invoking them', () => {
		const method = vi.fn();
		class Implementation {
			method = method;
		}
		const get = vi.fn();
		const thenablePrototype = Object.defineProperty({}, 'then', { get });
		for (const implementation of [
			Object.create({ method }),
			Object.create({ then: method }),
			Object.create(thenablePrototype),
			new Implementation(),
			new Date(),
		]) {
			expect(() => createProviderFacade(implementation, () => true, revokedMessage)).toThrow(
				prototypeError,
			);
		}
		expect(get).not.toHaveBeenCalled();
		expect(method).not.toHaveBeenCalled();
	});

	it('validates own properties before checking the prototype', () => {
		const implementation = Object.assign(Object.create({ method() {} }), { value: 1 });
		expect(() => createProviderFacade(implementation, () => true, revokedMessage)).toThrow(
			methodsError,
		);
	});

	it('checks liveness on each retained top-level method invocation', () => {
		let live = true;
		const method = vi.fn(() => 'value');
		const facade = createProviderFacade({ method }, () => live, revokedMessage) as MethodApi;
		const retained = facade.method;
		expect(retained()).toBe('value');
		live = false;
		expect(() => retained()).toThrow(revokedMessage);
		expect(() => facade.method()).toThrow(revokedMessage);
		expect(method).toHaveBeenCalledTimes(1);
	});

	it('does not recursively revoke returned objects, functions, or promises', async () => {
		let live = true;
		const nested = { method: () => 'nested' };
		const callback = () => 'callback';
		let resolve!: (value: string) => void;
		const promise = new Promise<string>((complete) => {
			resolve = complete;
		});
		const implementation = {
			object: () => nested,
			callback: () => callback,
			promise: () => promise,
		};
		const facade = createProviderFacade(
			implementation,
			() => live,
			revokedMessage,
		) as typeof implementation;
		const returnedObject = facade.object();
		const returnedCallback = facade.callback();
		const returnedPromise = facade.promise();
		expect(returnedObject).toBe(nested);
		expect(returnedCallback).toBe(callback);
		expect(returnedPromise).toBe(promise);
		live = false;
		expect(returnedObject.method()).toBe('nested');
		expect(returnedCallback()).toBe('callback');
		resolve('settled after revocation');
		await expect(returnedPromise).resolves.toBe('settled after revocation');
		expect(() => facade.promise()).toThrow(revokedMessage);
	});

	it('preserves synchronous method errors and method-returned promise rejections', async () => {
		const error = new Error('provider failure');
		const implementation = {
			fail() {
				throw error;
			},
			async reject() {
				throw error;
			},
		};
		const facade = createProviderFacade(
			implementation,
			() => true,
			revokedMessage,
		) as typeof implementation;
		expect(() => facade.fail()).toThrow(error);
		await expect(facade.reject()).rejects.toBe(error);
	});

	it('rejects native promises and observes rejections without calling an overridden then', async () => {
		const then = vi.fn(() => {
			throw new Error('must not call overridden then');
		});
		for (const implementation of [
			Promise.resolve({}),
			Promise.reject(new Error('async factory')),
		]) {
			Object.defineProperty(implementation, 'then', { value: then });
			expect(() => createProviderFacade(implementation, () => true, revokedMessage)).toThrow(
				synchronousError,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(then).not.toHaveBeenCalled();
	});
});
