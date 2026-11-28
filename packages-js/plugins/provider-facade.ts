export function createProviderFacade(
	implementation: unknown,
	live: () => boolean,
	revokedMessage: string,
): object {
	if (implementation === null || typeof implementation !== 'object') {
		throw new Error('API factory must return a synchronous method-only facade');
	}
	if (implementation instanceof Promise) {
		// Reject async factories without leaving their native promise rejection unhandled.
		void Promise.prototype.then.call(implementation, undefined, () => {});
		throw new Error('API factory must return a synchronous method-only facade');
	}
	const facade: Record<string, unknown> = Object.create(null);
	for (const name of Reflect.ownKeys(implementation)) {
		const descriptor = Object.getOwnPropertyDescriptor(implementation, name);
		if (
			typeof name !== 'string' ||
			name === 'then' ||
			!descriptor ||
			!('value' in descriptor) ||
			typeof descriptor.value !== 'function'
		) {
			throw new Error(
				'API facade must contain only own string-named methods (no accessors, symbols or thenables)',
			);
		}
		const method = descriptor.value;
		facade[name] = (...args: unknown[]) => {
			if (!live()) {
				throw new Error(revokedMessage);
			}
			return Reflect.apply(method, implementation, args);
		};
	}
	// Reject inherited thenables and prototype methods rather than silently exposing a partial API.
	const prototype = Object.getPrototypeOf(implementation);
	if (prototype !== null && prototype !== Object.prototype) {
		throw new Error('API facade must be a plain method-only object');
	}
	return Object.freeze(facade);
}
