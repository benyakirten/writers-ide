import type { TaskContext } from '@writers-ide/tasks';

/** Internal host setup only. The adapter must read retained, verified snapshot bytes. */
export type WorkerModuleSource = {
	base: URL;
	files: readonly string[];
	read(path: string, signal: AbortSignal): Uint8Array | PromiseLike<Uint8Array>;
};

interface CallbackGuard {
	<T>(callback: () => T): T;
}

function fileURL(base: URL, path: string): string {
	if (
		typeof path !== 'string' ||
		/[\p{Cc}\\<>:"|?*]/u.test(path) ||
		path.split('/').some((segment) => {
			const stem = segment.split('.')[0];
			return (
				!segment ||
				segment === '.' ||
				segment === '..' ||
				/[ .]$/.test(segment) ||
				/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(stem)
			);
		})
	) {
		throw new Error('Invalid worker module source file path');
	}
	// Match the resource route's encoding: only RFC 3986 unreserved bytes stay literal.
	const encoded = path
		.split('/')
		.map((segment) =>
			encodeURIComponent(segment).replace(
				/[!'()*]/g,
				(character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
			),
		)
		.join('/');
	const url = new URL(encoded, base);
	if (url.href !== base.href + encoded) {
		throw new Error('Invalid worker module source file path');
	}
	return url.href;
}

function guardedBytes(value: unknown, guard: CallbackGuard): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const seen = new Set<object>();
		const inspect = (value: unknown) => {
			try {
				guard(() => {
					if ((typeof value !== 'object' || value === null) && typeof value !== 'function') {
						throw new Error('Task worker module loader must return Uint8Array bytes');
					}
					if (seen.has(value)) {
						throw new TypeError('Task worker module thenable resolution cycle');
					}
					seen.add(value);
					const then = (value as { then?: unknown }).then;
					if (typeof then !== 'function') {
						if (!(value instanceof Uint8Array)) {
							throw new Error('Task worker module loader must return Uint8Array bytes');
						}
						// Never give native Promise resolution an adapter-owned object to inspect again.
						resolve(new Uint8Array(value));
						return;
					}
					let settled = false;
					const settle = (callback: () => void) => {
						// Native Promise handlers must never throw and leave an unobserved rejected child.
						try {
							guard(() => {
								if (!settled) {
									settled = true;
									callback();
								}
							});
						} catch (error) {
							reject(error);
						}
					};
					try {
						then.call(
							value,
							(next: unknown) =>
								settle(() => {
									// Trampoline nested resolution without handing raw native resolvers to adapters.
									queueMicrotask(() => inspect(next));
								}),
							(error: unknown) => settle(() => reject(error)),
						);
					} catch (error) {
						settle(() => reject(error));
					}
				});
			} catch (error) {
				reject(error);
			}
		};
		inspect(value);
	});
}

/** Captures host-owned metadata, never an author descriptor or a current-project lookup. */
export function captureWorkerModules(source: WorkerModuleSource | null) {
	if (source === null) {
		return null;
	}
	const base = new URL(source.base.href);
	if (
		!base.host ||
		['file:', 'data:', 'blob:', 'filesystem:', 'javascript:'].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		base.href.includes('?') ||
		base.href.includes('#') ||
		!base.pathname.endsWith('/') ||
		/%(?:2f|5c)/i.test(base.pathname)
	) {
		throw new Error('Invalid worker module source base URL');
	}
	const files = Object.freeze([...source.files]);
	const urls = new Map(files.map((path) => [fileURL(base, path), path]));
	const read = source.read;
	if (typeof read !== 'function') {
		throw new Error('Invalid worker module source read callback');
	}
	return (module: URL, context: TaskContext, guard: CallbackGuard) => {
		const path = urls.get(module.href);
		if (path === undefined) {
			throw new Error('Task worker module is not owned by this activation');
		}
		const value = read.call(source, path, context.signal);
		return guardedBytes(value, guard);
	};
}
