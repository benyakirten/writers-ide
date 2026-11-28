import { defineTaskWorker, type TaskWorkerScope } from '@writers-ide/tasks/worker';
type Input = number | ArrayBuffer | { value: number; delay: number };
defineTaskWorker<Input, number | ArrayBuffer>(
	self as unknown as TaskWorkerScope,
	async (input) => {
		if (input instanceof ArrayBuffer) {
			new Uint8Array(input)[0] *= 2;
			return input;
		}
		if (typeof input === 'object') {
			await new Promise((resolve) => setTimeout(resolve, input.delay));
			return input.value * 2;
		}
		await Promise.resolve();
		return input * 2;
	},
	{ transfer: (value) => (value instanceof ArrayBuffer ? [value] : []) },
);
