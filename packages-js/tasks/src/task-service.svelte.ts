import type {
	AsyncTaskOptions,
	CooperativeTaskHandle,
	CooperativeTaskOptions,
	ForEachTaskOptions,
	TaskHandle,
	TaskOptions,
	TaskOutcome,
	TaskService,
	TaskServiceOptions,
	WorkerTaskOptions,
} from './contracts';
import type { WorkHandle, WorkProgress, WorkStatus } from './work-queue.svelte';
import type { WorkerResponse } from './protocol';

let activation = 0;

class Task<T> implements CooperativeTaskHandle<T> {
	#status = $state<WorkStatus>('queued');
	progress = $state<WorkProgress>({});
	error = $state.raw<unknown>(undefined);
	readonly controller = new AbortController();
	readonly result: Promise<TaskOutcome<T>>;
	readonly key: string;
	readonly label: string;
	work?: WorkHandle;
	cleanup?: () => void;
	unlink: () => void = () => {};
	#resolve!: (outcome: TaskOutcome<T>) => void;

	constructor(
		options: TaskOptions,
		readonly remove: () => void,
		readonly report: (error: unknown) => void,
	) {
		this.key = options.key;
		this.label = options.label;
		this.result = new Promise((resolve) => {
			this.#resolve = resolve;
		});
	}

	get status(): WorkStatus {
		return this.active && this.work ? this.work.status : this.#status;
	}
	set status(status: WorkStatus) {
		this.#status = status;
	}
	get signal(): AbortSignal {
		return this.controller.signal;
	}
	get active(): boolean {
		return this.#status === 'queued' || this.#status === 'running' || this.#status === 'paused';
	}

	fail(error: unknown): void {
		if (this.active) {
			this.finish({ status: 'failed', error });
		} else {
			// Generator cleanup can fail after reentrant cancellation has settled the outcome.
			this.recordError(error);
		}
	}

	recordError(error: unknown): void {
		this.error =
			this.error === undefined
				? error
				: new AggregateError([this.error, error], 'Task and cleanup failed');
		this.report(error);
	}

	finish(outcome: TaskOutcome<T>): void {
		if (!this.active) {
			return;
		}
		this.status = outcome.status;
		if (outcome.status === 'failed') {
			this.recordError(outcome.error);
		}
		this.remove();
		this.unlink();
		if (outcome.status !== 'completed') {
			this.controller.abort();
		}
		try {
			this.cleanup?.();
		} catch (error) {
			this.recordError(error);
		}
		this.cleanup = undefined;
		this.#resolve(outcome);
	}

	cancel(): void {
		this.finish({ status: 'cancelled' });
	}
	pause(): void {
		if (this.active && this.work) {
			this.work.pause();
			this.status = this.work.status;
		}
	}
	resume(): void {
		if (this.active && this.work) {
			this.work.resume();
			this.status = this.work.status;
		}
	}
}

/** A revocable activation scope over an explicitly supplied shared scheduler. */
export function createTaskService(options: TaskServiceOptions): TaskService {
	activation++;
	const namespace = `tasks:${activation}:${options.ownerId}:`;
	const tasks = new Map<string, Pick<TaskHandle<unknown>, 'cancel'>>();
	let disposed = false;

	function begin<T>(request: TaskOptions): Task<T> {
		if (disposed || options.signal.aborted) {
			throw new Error('Task service has been disposed');
		}
		const previous = tasks.get(request.key);
		const task = new Task<T>(
			request,
			() => {
				if (tasks.get(request.key) === task) {
					tasks.delete(request.key);
				}
			},
			(error) => {
				try {
					options.onError?.({
						ownerId: options.ownerId,
						key: request.key,
						label: request.label,
						error,
					});
				} catch {
					/* Error observers must not interrupt scheduling or resource cleanup. */
				}
			},
		);
		// Publish before cancellation: cleanup may synchronously submit a newer replacement.
		tasks.set(request.key, task);
		const abort = () => task.cancel();
		request.signal?.addEventListener('abort', abort, { once: true });
		task.unlink = () => request.signal?.removeEventListener('abort', abort);
		previous?.cancel();
		if (request.signal?.aborted || disposed || options.signal.aborted) {
			task.cancel();
		}
		return task;
	}

	function cooperative<T>(request: CooperativeTaskOptions<T>): CooperativeTaskHandle<T> {
		const task = begin<T>(request);
		if (!task.active) {
			return task;
		}
		const release = options.queue.start();
		const cancel = () => task.cancel();
		task.cleanup = () => {
			task.work?.signal.removeEventListener('abort', cancel);
			try {
				if (task.status !== 'completed') {
					task.work?.cancel();
				}
			} finally {
				release();
			}
		};
		task.work = options.queue.enqueue({
			key: namespace + request.key,
			label: request.label,
			priority: request.priority,
			create: () => {
				let iterator: Generator<WorkProgress | void, T, unknown>;
				try {
					if (!task.active) {
						return (function* () {})();
					}
					iterator = request.create({ signal: task.signal });
				} catch (error) {
					task.fail(error);
					throw error;
				}
				let closed = false;
				// Forward return explicitly so cancellation during factory/next closes the author's iterator.
				return {
					next() {
						if (task.active && task.status !== 'paused') {
							task.status = 'running';
						}
						try {
							const result = iterator.next();
							if (result.done) {
								closed = true;
								if (task.active) {
									task.finish({ status: 'completed', value: result.value });
								}
								return { done: true, value: undefined };
							}
							if (task.active && result.value !== undefined) {
								task.progress = { ...task.progress, ...result.value };
							}
							return { done: false, value: result.value };
						} catch (error) {
							task.fail(error);
							throw error;
						}
					},
					return() {
						if (!closed) {
							closed = true;
							try {
								iterator.return(undefined as T);
							} catch (error) {
								task.recordError(error);
								throw error;
							}
						}
						return { done: true, value: undefined };
					},
				} as Generator<WorkProgress | void, void, unknown>;
			},
		});
		if (!task.active) {
			task.work.cancel();
		} else if (task.work.signal.aborted) {
			task.cancel();
		} else {
			task.work.signal.addEventListener('abort', cancel, { once: true });
		}
		return task;
	}

	function forEach<T>(request: ForEachTaskOptions<T>): CooperativeTaskHandle<void> {
		return cooperative({
			...request,
			create: function* (context) {
				let index = 0;
				const total = Array.isArray(request.items) ? request.items.length : undefined;
				yield { completed: 0, total };
				for (const item of request.items) {
					if (context.signal.aborted) {
						return;
					}
					request.run(item, index, context);
					index++;
					if (context.signal.aborted) {
						return;
					}
					yield { completed: index, total };
				}
			},
		});
	}

	function asyncTask<T>(request: AsyncTaskOptions<T>): TaskHandle<T> {
		const task = begin<T>(request);
		if (!task.active) {
			return task;
		}
		task.status = 'running';
		try {
			const value = request.run({ signal: task.signal });
			void Promise.resolve(value).then(
				(value) => {
					if (task.active) {
						task.finish({ status: 'completed', value });
					}
				},
				(error: unknown) => {
					if (task.active) {
						task.fail(error);
					}
				},
			);
		} catch (error) {
			if (task.active) {
				task.fail(error);
			}
		}
		return task;
	}

	function worker<I, O>(request: WorkerTaskOptions<I, O>): TaskHandle<O> {
		const task = begin<O>(request);
		if (!task.active) {
			return task;
		}
		task.status = 'running';
		try {
			const instance = request.createWorker();
			let received = false;
			const message = (event: MessageEvent<WorkerResponse<O>>) => {
				if (!task.active || received) {
					return;
				}
				received = true;
				try {
					const response = event.data;
					if (typeof response !== 'object' || response === null) {
						throw new Error('Invalid task worker response');
					}
					if (response.type === 'tasks:error') {
						if (
							typeof response.error !== 'object' ||
							response.error === null ||
							typeof response.error.name !== 'string' ||
							typeof response.error.message !== 'string' ||
							(response.error.stack !== undefined && typeof response.error.stack !== 'string')
						) {
							throw new Error('Invalid task worker response');
						}
						const error = new Error(response.error.message);
						error.name = response.error.name;
						error.stack = response.error.stack;
						throw error;
					}
					if (response.type !== 'tasks:result' || !Object.hasOwn(response, 'value')) {
						throw new Error('Invalid task worker response');
					}
					request.apply?.(response.value, { signal: task.signal });
					if (task.active) {
						task.finish({ status: 'completed', value: response.value });
					}
				} catch (error) {
					if (task.active) {
						task.fail(error);
					}
				}
			};
			const error = (event: ErrorEvent) => {
				event.preventDefault();
				if (task.active) {
					task.fail(event.error ?? new Error(event.message || 'Task worker failed'));
				}
			};
			const messageerror = () => {
				if (task.active) {
					task.fail(new Error('Task worker response could not be cloned'));
				}
			};
			const cleanup = () => {
				for (const release of [
					() => instance.removeEventListener('message', message),
					() => instance.removeEventListener('error', error),
					() => instance.removeEventListener('messageerror', messageerror),
					() => instance.terminate(),
				]) {
					try {
						release();
					} catch (error) {
						task.recordError(error);
					}
				}
			};
			// The factory itself may have cancelled/replaced this task.
			if (!task.active) {
				cleanup();
				return task;
			}
			task.cleanup = cleanup;
			instance.addEventListener('message', message);
			instance.addEventListener('error', error);
			instance.addEventListener('messageerror', messageerror);
			instance.postMessage({ type: 'tasks:run', input: request.input }, request.transfer ?? []);
		} catch (error) {
			if (task.active) {
				task.fail(error);
			}
		}
		return task;
	}

	function dispose(): void {
		if (disposed) {
			return;
		}
		disposed = true;
		options.signal.removeEventListener('abort', dispose);
		for (const task of [...tasks.values()]) {
			task.cancel();
		}
	}
	options.signal.addEventListener('abort', dispose, { once: true });
	if (options.signal.aborted) {
		dispose();
	}
	return { cooperative, forEach, async: asyncTask, worker, dispose };
}
