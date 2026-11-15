import { defineTaskWorker, type TaskWorkerScope } from '@writers-ide/tasks/worker';

// This module runs in a worker; the app's TypeScript environment otherwise types self as Window.
declare const self: TaskWorkerScope;

export type Input =
	| { mode: 'transfer'; buffer: ArrayBuffer }
	| { mode: 'failure' }
	| { mode: 'delayed' };
export type Output = { buffer: ArrayBuffer; sum: number };

export const cancellationDelay = 100;

defineTaskWorker<Input, Output>(
	self,
	async (input) => {
		if (input.mode === 'failure') {
			throw new RangeError('Bundled worker failure');
		}
		if (input.mode === 'delayed') {
			self.postMessage({ type: 'fixture:ready' }, []);
			await new Promise((resolve) => setTimeout(resolve, cancellationDelay));
			return { buffer: new ArrayBuffer(0), sum: 99 };
		}
		const values = new Uint8Array(input.buffer);
		const sum = values.reduce((total, value) => total + value, 0);
		values.reverse();
		return { buffer: input.buffer, sum };
	},
	{ transfer: (output) => [output.buffer] },
);
