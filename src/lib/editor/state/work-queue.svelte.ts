export type WorkProgress = {
	completed?: number;
	total?: number;
	message?: string;
};

export type WorkStatus = 'queued' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type WorkPriority = 'interactive' | 'background';

export type WorkOptions = {
	key: string;
	documentId?: string;
	viewId?: string;
	label: string;
	priority?: WorkPriority;
	create: (context: { signal: AbortSignal }) => Generator<WorkProgress | void, void, unknown>;
};

export interface WorkHandle {
	readonly key: string;
	readonly documentId?: string;
	readonly viewId?: string;
	readonly label: string;
	readonly priority: WorkPriority;
	readonly status: WorkStatus;
	readonly progress: WorkProgress;
	readonly error?: unknown;
	pause(): void;
	resume(): void;
	cancel(): void;
}

class Job implements WorkHandle {
	status = $state<WorkStatus>('queued');
	progress = $state<WorkProgress>({});
	error = $state<unknown>(undefined);
	readonly key: string;
	readonly documentId?: string;
	readonly viewId?: string;
	readonly label: string;
	readonly priority: WorkPriority;

	constructor(
		options: WorkOptions,
		readonly pause: () => void,
		readonly resume: () => void,
		readonly cancel: () => void,
	) {
		this.key = options.key;
		this.documentId = options.documentId;
		this.viewId = options.viewId;
		this.label = options.label;
		this.priority = options.priority ?? 'background';
	}
}

type Entry = {
	job: Job;
	create: WorkOptions['create'];
	controller: AbortController;
	iterator?: Generator<WorkProgress | void, void, unknown>;
	executing: boolean;
	closed: boolean;
};

/** Cooperative synchronous work: each generator step must itself be short and non-blocking. */
export class WorkQueue {
	#jobs = $state.raw<WorkHandle[]>([]);
	#entries: Entry[] = [];
	#owners = 0;
	#frame: number | undefined;
	#inFrame = false;
	#interactiveTurns = 0;

	get jobs(): readonly WorkHandle[] {
		return this.#jobs;
	}

	enqueue(options: WorkOptions): WorkHandle {
		const entry: Entry = {
			job: new Job(
				options,
				() => {
					if (this.#runnable(entry)) {
						entry.job.status = 'paused';
						this.#schedule();
					}
				},
				() => {
					if (entry.job.status === 'paused') {
						entry.job.status = entry.iterator ? 'running' : 'queued';
						this.#schedule();
					}
				},
				() => this.#cancel(entry),
			),
			create: options.create,
			controller: new AbortController(),
			executing: false,
			closed: false,
		};
		const replaced = this.#entries.filter(({ job }) => job.key === options.key);
		// Publish first so a replacement enqueued by cleanup can supersede this job too.
		this.#entries.push(entry);
		this.#jobs = [...this.#jobs, entry.job];
		for (const old of replaced) this.#cancel(old);
		this.#schedule();
		return entry.job;
	}

	cancelView(viewId: string): void {
		const entries = this.#entries.slice();
		for (const entry of entries) {
			if (entry.job.viewId === viewId) this.#cancel(entry);
		}
	}

	/** Each caller owns a lease. Releasing the last lease suspends, but does not cancel, work. */
	start(): () => void {
		this.#owners++;
		this.#schedule();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#owners--;
			this.#schedule();
		};
	}

	#runnable(entry: Entry): boolean {
		return entry.job.status === 'queued' || entry.job.status === 'running';
	}

	#schedule(): void {
		const runnable = this.#owners > 0 && this.#entries.some((entry) => this.#runnable(entry));
		if (!runnable && this.#frame !== undefined) {
			cancelAnimationFrame(this.#frame);
			this.#frame = undefined;
		}
		if (runnable && !this.#inFrame && this.#frame === undefined) {
			this.#frame = requestAnimationFrame(() => this.#runFrame());
		}
	}

	#runFrame(): void {
		this.#frame = undefined;
		this.#inFrame = true;
		const deadline = performance.now() + 8;
		try {
			// The step cap also bounds work with coarse or mocked clocks.
			for (let steps = 0; this.#owners > 0 && steps < 1000; steps++) {
				const entry = this.#pick();
				if (!entry) break;
				this.#step(entry);
				if (performance.now() >= deadline) break;
			}
		} finally {
			this.#inFrame = false;
			this.#schedule();
		}
	}

	#pick(): Entry | undefined {
		const runnable = this.#entries.filter((entry) => this.#runnable(entry));
		const interactive = runnable.find(({ job }) => job.priority === 'interactive');
		const background = runnable.find(({ job }) => job.priority === 'background');
		const entry =
			interactive && (!background || this.#interactiveTurns < 3) ? interactive : background;
		if (!entry) return;
		this.#interactiveTurns = entry.job.priority === 'interactive' ? this.#interactiveTurns + 1 : 0;
		this.#entries.splice(this.#entries.indexOf(entry), 1);
		this.#entries.push(entry);
		return entry;
	}

	#cancelled(entry: Entry): boolean {
		return entry.job.status === 'cancelled';
	}

	#step(entry: Entry): void {
		entry.job.status = 'running';
		entry.executing = true;
		try {
			entry.iterator ??= entry.create({ signal: entry.controller.signal });
			if (!this.#runnable(entry)) return;
			const result = entry.iterator.next();
			// next() may have cancelled, paused, or replaced its own job.
			if (this.#cancelled(entry)) return;
			if (result.done) {
				entry.closed = true;
				entry.job.status = 'completed';
				this.#remove(entry);
			} else if (result.value !== undefined) {
				entry.job.progress = { ...entry.job.progress, ...result.value };
			}
		} catch (error) {
			entry.job.error = error;
			if (!this.#cancelled(entry)) entry.job.status = 'failed';
			this.#remove(entry);
		} finally {
			entry.executing = false;
			if (this.#cancelled(entry) || entry.job.status === 'failed') this.#close(entry);
		}
	}

	#cancel(entry: Entry): void {
		if (!this.#runnable(entry) && entry.job.status !== 'paused') return;
		entry.job.status = 'cancelled';
		this.#remove(entry);
		entry.controller.abort();
		if (!entry.executing) this.#close(entry);
		this.#schedule();
	}

	#close(entry: Entry): void {
		if (entry.closed) return;
		entry.closed = true;
		try {
			entry.iterator?.return();
		} catch (error) {
			entry.job.error =
				entry.job.error === undefined
					? error
					: new AggregateError([entry.job.error, error], 'Work and cleanup both failed');
		}
	}

	#remove(entry: Entry): void {
		this.#entries = this.#entries.filter((candidate) => candidate !== entry);
		this.#jobs = this.#jobs.filter((job) => job !== entry.job);
	}
}

export const workQueue = new WorkQueue();
