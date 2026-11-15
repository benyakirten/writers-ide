import { defineTaskWorker, type TaskWorkerScope } from '../worker';

// In a bundled module worker globalThis is DedicatedWorkerGlobalScope, not Window.
defineTaskWorker<string[], number>(globalThis as unknown as TaskWorkerScope, (paragraphs) => {
	return paragraphs.reduce((total, text) => total + (text.match(/\S+/g)?.length ?? 0), 0);
});
