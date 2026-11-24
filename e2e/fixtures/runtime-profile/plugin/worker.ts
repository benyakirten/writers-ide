import { defineTaskWorker, type TaskWorkerScope } from '@writers-ide/tasks/worker';
defineTaskWorker<number, number>(self as unknown as TaskWorkerScope, async (input) => {
	await Promise.resolve();
	return input * 2;
});
