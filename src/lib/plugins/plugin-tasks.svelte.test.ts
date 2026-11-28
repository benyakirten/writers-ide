import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BundledPlugin, PluginContext } from '@writers-ide/plugins';
import { WorkQueue, type TaskHandle } from '@writers-ide/tasks';
import { workQueue } from '$lib/editor/state/work-queue.svelte';
import { createApplicationPluginHost } from './application-plugin-host';
import { PluginHost } from './plugin-host';

function plugin(id: string, activate: BundledPlugin<string>['activate']): BundledPlugin<string> {
	return {
		manifest: { id, version: '0.1.0', apiVersion: 1, name: id, description: id, capabilities: [] },
		activate,
	};
}

function setup(queue = new WorkQueue()) {
	const register = () => () => {};
	const host = new PluginHost<string>({
		workQueue: queue,
		registries: { toolbar: { register }, view: { register }, command: { register } },
	});
	const contexts = new Map<string, PluginContext<string>>();
	for (const id of ['one', 'two']) {
		host.register(
			plugin(id, (context) => {
				contexts.set(id, context);
			}),
		);
		host.activate(id);
	}
	return { host, queue, one: contexts.get('one')!, two: contexts.get('two')! };
}

describe('plugin-owned tasks', () => {
	let frames: Map<number, FrameRequestCallback>;
	let id: number;
	beforeEach(() => {
		// Queue budget behavior has separate coverage; ownership tests should not depend on machine load.
		vi.spyOn(performance, 'now').mockReturnValue(0);
		frames = new Map();
		id = 0;
		vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
			id++;
			frames.set(id, callback);
			return id;
		});
		vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	function frame() {
		const pending = [...frames.values()];
		frames.clear();
		for (const callback of pending) {
			callback(0);
		}
	}

	it('shares scheduling while isolating local keys and unload cancellation', async () => {
		const { host, queue, one, two } = setup();
		const runOne = vi.fn();
		const runTwo = vi.fn();
		const first = one.tasks.forEach({ key: 'scan', label: 'Scan', items: [1], run: runOne });
		const second = two.tasks.forEach({ key: 'scan', label: 'Scan', items: [2], run: runTwo });
		const pagination = vi.fn();
		queue.enqueue({
			key: 'pagination:view',
			label: 'Pagination',
			create: function* () {
				pagination();
				yield;
			},
		});
		expect(queue.jobs).toHaveLength(3);
		host.deactivate('one');
		expect(await first.result).toEqual({ status: 'cancelled' });
		frame();
		expect(await second.result).toEqual({ status: 'completed', value: undefined });
		expect(runOne).not.toHaveBeenCalled();
		expect(runTwo).toHaveBeenCalledOnce();
		expect(pagination).toHaveBeenCalledOnce();
		expect(queue.jobs).toHaveLength(0);
		host.deactivate('two');
	});

	it('revokes retained services on disable and creates a fresh scope on reactivation', async () => {
		const { host, one } = setup();
		const task = one.tasks.async({ key: 'wait', label: 'Wait', run: () => new Promise(() => {}) });
		host.deactivate('one');
		expect(task.signal.aborted).toBe(true);
		expect(await task.result).toEqual({ status: 'cancelled' });
		host.activate('one');
		expect(() => one.tasks.async({ key: 'old', label: 'Old', run: () => 1 })).toThrow(/disposed/);
		host.deactivate('one');
		host.deactivate('two');
	});

	it('rolls back tasks when activation throws', async () => {
		const { host, queue } = setup();
		let task!: TaskHandle<void>;
		const run = vi.fn();
		host.register(
			plugin('broken', (context) => {
				task = context.tasks.forEach({ key: 'scan', label: 'Scan', items: [1], run });
				throw new Error('Activation failed');
			}),
		);
		expect(host.activate('broken').status).toBe('failed');
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(queue.jobs).toHaveLength(0);
		expect(run).not.toHaveBeenCalled();
		host.deactivate('one');
		host.deactivate('two');
	});

	it('attributes task failures without disabling the plugin or blocking cleanup', async () => {
		const { host, one } = setup();
		const snapshots = vi.fn();
		const unsubscribe = host.subscribe(snapshots);
		const task = one.tasks.async({
			key: 'lookup',
			label: 'Lookup',
			run: () => {
				throw new Error('Offline');
			},
		});
		expect(await task.result).toMatchObject({ status: 'failed' });
		expect(host.get('one')).toMatchObject({
			status: 'active',
			errors: [{ phase: 'task', message: 'Lookup [lookup]: Offline' }],
		});
		expect(host.get('two')!.errors).toEqual([]);
		expect(snapshots).toHaveBeenCalled();
		expect(host.deactivate('one').status).toBe('disabled');
		host.deactivate('two');
		unsubscribe();
	});

	it('consumes late async outcomes after unload without reporting failure to a new activation', async () => {
		const { host, one } = setup();
		let reject!: (error: unknown) => void;
		const task = one.tasks.async({
			key: 'lookup',
			label: 'Lookup',
			run: () =>
				new Promise((_resolve, no) => {
					reject = no;
				}),
		});
		host.deactivate('one');
		host.activate('one');
		reject(new Error('Late failure'));
		await Promise.resolve();
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(host.get('one')!.errors).toEqual([]);
		host.deactivate('one');
		host.deactivate('two');
	});

	it('terminates an owned worker on unload and ignores retained response handlers', async () => {
		const { host, one } = setup();
		const worker = new EventTarget();
		const terminate = vi.fn();
		const apply = vi.fn();
		const task = one.tasks.worker<null, number>({
			key: 'worker',
			label: 'Worker',
			input: null,
			apply,
			createWorker: () =>
				Object.assign(worker, { postMessage: vi.fn(), terminate }) as unknown as Worker,
		});
		host.deactivate('one');
		worker.dispatchEvent(
			new MessageEvent('message', { data: { type: 'tasks:result', value: 42 } }),
		);
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(terminate).toHaveBeenCalledOnce();
		expect(apply).not.toHaveBeenCalled();
		host.deactivate('two');
	});

	it('uses pagination’s application queue by default in the application host', async () => {
		const host = createApplicationPluginHost();
		let task!: TaskHandle<void>;
		host.register({
			...plugin('app', () => {}),
			activate(context) {
				task = context.tasks.forEach({ key: 'scan', label: 'App scan', items: [1], run: () => {} });
			},
		});
		host.activate('app');
		expect(workQueue.jobs.some((job) => job.label === 'App scan')).toBe(true);
		host.deactivate('app');
		expect(await task.result).toEqual({ status: 'cancelled' });
		expect(workQueue.jobs).toHaveLength(0);
	});
});
