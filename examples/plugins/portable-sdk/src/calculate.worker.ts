import type { TaskWorkerScope } from '@writers-ide/tasks/worker';

// This example implements the task envelope directly. Its SDK import is type-only.
const scope = self as unknown as TaskWorkerScope;
let started = false;
scope.addEventListener('message', (event: MessageEvent) => {
	if (started) {
		return;
	}
	started = true;
	if (event.data?.type !== 'tasks:run' || typeof event.data.input !== 'number') {
		scope.postMessage(
			{
				type: 'tasks:error',
				error: { name: 'TypeError', message: 'Expected a number task input' },
			},
			[],
		);
		return;
	}
	scope.postMessage({ type: 'tasks:result', value: event.data.input * 2 }, []);
});
