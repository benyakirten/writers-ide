import type { WorkPriority, WorkProgress, WorkStatus, WorkQueue } from './work-queue.svelte';

export type TaskOutcome<T> =
	| { status: 'completed'; value: T }
	| { status: 'cancelled' }
	| { status: 'failed'; error: unknown };

export interface TaskHandle<T> {
	readonly key: string;
	readonly label: string;
	readonly status: WorkStatus;
	readonly progress: WorkProgress;
	readonly error: unknown;
	readonly signal: AbortSignal;
	readonly result: Promise<TaskOutcome<T>>;
	cancel(): void;
}

export interface CooperativeTaskHandle<T> extends TaskHandle<T> {
	pause(): void;
	resume(): void;
}

export type TaskContext = { signal: AbortSignal };
export type TaskOptions = { key: string; label: string; signal?: AbortSignal };
export type CooperativeTaskOptions<T> = TaskOptions & {
	priority?: WorkPriority;
	create(context: TaskContext): Generator<WorkProgress | void, T, unknown>;
};
export type ForEachTaskOptions<T> = TaskOptions & {
	priority?: WorkPriority;
	items: Iterable<T>;
	run(item: T, index: number, context: TaskContext): void;
};
export type AsyncTaskOptions<T> = TaskOptions & {
	run(context: TaskContext): T | PromiseLike<T>;
};
type WorkerTaskData<I, O> = TaskOptions & {
	input: I;
	transfer?: Transferable[];
	apply?(value: O, context: TaskContext): void;
};
export type WorkerTaskOptions<I, O> = WorkerTaskData<I, O> & {
	module: URL;
	createWorker?: never;
};
export type WorkerFactoryTaskOptions<I, O> = WorkerTaskData<I, O> & {
	createWorker(): Worker;
	module?: never;
};
export type TaskFailure = { ownerId: string; key: string; label: string; error: unknown };
export type TaskServiceOptions = {
	queue: WorkQueue;
	ownerId: string;
	signal: AbortSignal;
	onError?(failure: TaskFailure): void;
	isLive?(): boolean;
	loadWorkerModule?(module: URL, context: TaskContext): Uint8Array | PromiseLike<Uint8Array>;
};
export interface TaskService {
	forEach<T>(options: ForEachTaskOptions<T>): CooperativeTaskHandle<void>;
	cooperative<T>(options: CooperativeTaskOptions<T>): CooperativeTaskHandle<T>;
	async<T>(options: AsyncTaskOptions<T>): TaskHandle<T>;
	worker<I, O>(options: WorkerTaskOptions<I, O>): TaskHandle<O>;
	dispose(): void;
}
export interface AdvancedTaskService extends TaskService {
	worker<I, O>(options: WorkerTaskOptions<I, O> | WorkerFactoryTaskOptions<I, O>): TaskHandle<O>;
}
