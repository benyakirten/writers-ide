import { serializeError, type WorkerRequest, type WorkerResponse } from './src/protocol';

/** Structural subset shared by DedicatedWorkerGlobalScope and test transports. No DOM/runtime imports. */
export interface TaskWorkerScope {
	addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
	postMessage(message: unknown, transfer: Transferable[]): void;
}

/** Install one request handler in a bundled dedicated worker. Returns an idempotent uninstaller. */
export function defineTaskWorker<I, O>(
	scope: TaskWorkerScope,
	run: (input: I) => O | PromiseLike<O>,
	options: { transfer?: (value: O) => Transferable[] } = {},
): () => void {
	let active = true;
	let started = false;
	const send = (response: WorkerResponse<O>, transfer: Transferable[] = []) => {
		if (active) {
			scope.postMessage(response, transfer);
		}
	};
	const listener = (event: MessageEvent<WorkerRequest<I>>) => {
		if (!active || started) {
			return;
		}
		started = true;
		// Catch synchronous run/clone errors as well as asynchronous rejections.
		void Promise.resolve()
			.then(() => {
				if (!active) {
					throw new Error('Task worker has been disposed');
				}
				if (
					typeof event.data !== 'object' ||
					event.data === null ||
					event.data.type !== 'tasks:run' ||
					!Object.hasOwn(event.data, 'input')
				) {
					throw new Error('Invalid task worker request');
				}
				return run(event.data.input);
			})
			.then((value) => {
				if (active) {
					send({ type: 'tasks:result', value }, options.transfer?.(value));
				}
			})
			.catch((error: unknown) => {
				try {
					send({ type: 'tasks:error', error: serializeError(error) });
				} catch {
					/* A broken transport cannot deliver even the plain error envelope. */
				}
			});
	};
	scope.addEventListener('message', listener);
	return () => {
		if (!active) {
			return;
		}
		active = false;
		scope.removeEventListener('message', listener);
	};
}
