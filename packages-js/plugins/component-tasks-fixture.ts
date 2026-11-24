import { vi } from 'vitest';
import { createHost, descriptor } from './command-component-fixture';
import type { CommandContext } from './command-component-model';
import type { WorkerModuleSource } from './command-component-host';

export const workerModule = new URL('https://packages.test/snapshots/one/worker.js');

export function moduleWorkers(fake = fakeWorker(), create?: () => void) {
	const createObjectURL = vi.fn(() => 'blob:managed-worker');
	const revokeObjectURL = vi.fn();
	vi.stubGlobal(
		'URL',
		new Proxy(URL, {
			get(target, key, receiver) {
				if (key === 'createObjectURL') {
					return createObjectURL;
				}
				if (key === 'revokeObjectURL') {
					return revokeObjectURL;
				}
				return Reflect.get(target, key, receiver);
			},
		}),
	);
	vi.stubGlobal(
		'Worker',
		vi.fn(function () {
			create?.();
			return fake.worker;
		}),
	);
	const source: WorkerModuleSource = {
		base: new URL('./', workerModule),
		files: ['worker.js'],
		read: () => new Uint8Array([1]),
	};
	return { fake, source, workerModules: () => source };
}

export function frames() {
	const pending = new Map<number, FrameRequestCallback>();
	let id = 0;
	vi.spyOn(performance, 'now').mockReturnValue(0);
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
		id++;
		pending.set(id, callback);
		return id;
	});
	vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
	return () => {
		const callbacks = [...pending.values()];
		pending.clear();
		for (const callback of callbacks) {
			callback(0);
		}
	};
}

export function activate(host: ReturnType<typeof createHost>, slot = 'one') {
	let context!: CommandContext;
	host.register(
		descriptor(slot, (value) => {
			context = value;
		}),
	);
	host.activate(slot);
	return context;
}

export function fakeWorker() {
	const target = new EventTarget();
	const terminate = vi.fn();
	const postMessage = vi.fn();
	const worker = Object.assign(target, { terminate, postMessage }) as unknown as Worker;
	return {
		worker,
		terminate,
		postMessage,
		result(value: unknown) {
			target.dispatchEvent(new MessageEvent('message', { data: { type: 'tasks:result', value } }));
		},
	};
}
