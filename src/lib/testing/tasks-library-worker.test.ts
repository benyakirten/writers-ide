import { describe, expect, it, vi } from 'vitest';
import { defineTaskWorker, type TaskWorkerScope } from '../../../packages-js/tasks/worker';

function transport() {
	const events = new EventTarget();
	const postMessage = vi.fn();
	const scope: TaskWorkerScope = {
		addEventListener: (type, listener) => events.addEventListener(type, listener as EventListener),
		removeEventListener: (type, listener) =>
			events.removeEventListener(type, listener as EventListener),
		postMessage,
	};
	return {
		scope,
		postMessage,
		send: (data: unknown) => events.dispatchEvent(new MessageEvent('message', { data })),
	};
}
const flush = async () => {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
	}
};

describe('worker-only task helper', () => {
	it('runs once, supports async results and output transfer lists', async () => {
		const { scope, postMessage, send } = transport();
		const output = new ArrayBuffer(8);
		const run = vi.fn(async (_input: number) => output);
		const dispose = defineTaskWorker(scope, run, { transfer: (value) => [value] });
		send({ type: 'tasks:run', input: 1 });
		send({ type: 'tasks:run', input: 2 });
		await flush();
		expect(run).toHaveBeenCalledExactlyOnceWith(1);
		expect(postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'tasks:result', value: output }, [
			output,
		]);
		dispose();
		dispose();
	});

	it.each(['throw', 'reject', 'clone', 'transfer', 'invalid'])(
		'serializes %s errors without leaving rejected promises',
		async (kind) => {
			const { scope, postMessage, send } = transport();
			if (kind === 'clone') {
				postMessage.mockImplementationOnce(() => {
					throw new DOMException('clone', 'DataCloneError');
				});
			}
			defineTaskWorker(
				scope,
				() => {
					if (kind === 'throw') {
						throw new Error('throw');
					}
					if (kind === 'reject') {
						return Promise.reject('reject');
					}
					return 1;
				},
				{
					transfer: () => {
						if (kind === 'transfer') {
							throw new Error('transfer');
						}
						return [];
					},
				},
			);
			send(kind === 'invalid' ? null : { type: 'tasks:run', input: 1 });
			await flush();
			expect(postMessage).toHaveBeenLastCalledWith(
				{
					type: 'tasks:error',
					error: expect.objectContaining({ message: expect.any(String), name: expect.any(String) }),
				},
				[],
			);
		},
	);

	it('does not start deferred work after immediate disposal', async () => {
		const { scope, postMessage, send } = transport();
		const run = vi.fn();
		const dispose = defineTaskWorker(scope, run);
		send({ type: 'tasks:run', input: 1 });
		dispose();
		await flush();
		expect(run).not.toHaveBeenCalled();
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('rejects a request missing its input envelope field', async () => {
		const { scope, postMessage, send } = transport();
		const run = vi.fn();
		defineTaskWorker(scope, run);
		send({ type: 'tasks:run' });
		await flush();
		expect(run).not.toHaveBeenCalled();
		expect(postMessage).toHaveBeenCalledWith(
			{
				type: 'tasks:error',
				error: expect.objectContaining({ message: 'Invalid task worker request' }),
			},
			[],
		);
	});

	it('suppresses late results after disposal and unregisters the handler', async () => {
		const { scope, postMessage, send } = transport();
		let resolve!: (value: number) => void;
		const run = vi.fn(
			() =>
				new Promise<number>((yes) => {
					resolve = yes;
				}),
		);
		const dispose = defineTaskWorker(scope, run);
		send({ type: 'tasks:run', input: null });
		await Promise.resolve();
		dispose();
		resolve(1);
		await flush();
		send({ type: 'tasks:run', input: null });
		await flush();
		expect(postMessage).not.toHaveBeenCalled();
		expect(run).toHaveBeenCalledTimes(1);
	});
});
