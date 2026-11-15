import { WorkQueue } from '@writers-ide/tasks';

export {
	WorkQueue,
	type WorkHandle,
	type WorkOptions,
	type WorkPriority,
	type WorkProgress,
	type WorkStatus,
} from '@writers-ide/tasks';

/** Application-owned shared scheduler; the reusable library has no singleton. */
export const workQueue = new WorkQueue();
