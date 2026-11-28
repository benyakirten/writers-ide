import type { TaskWorkerScope } from '@writers-ide/tasks/worker';
const scope = self as unknown as TaskWorkerScope;
scope.addEventListener('message', (event: MessageEvent) => {
	const response = { type: 'tasks:result', value: event.data.input * 2 };
	scope.postMessage(response, []);
	scope.postMessage(response, []);
});
