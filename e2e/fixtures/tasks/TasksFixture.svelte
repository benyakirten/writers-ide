<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		createTaskService,
		WorkQueue,
		type CooperativeTaskHandle,
		type TaskHandle,
		type WorkHandle,
	} from '@writers-ide/tasks';
	import type { Input, Output } from './task.worker';

	const queue = new WorkQueue();
	const ownerA = new AbortController();
	const ownerB = new AbortController();
	let failures = $state<{ ownerId: string; key: string; label: string; message: string }[]>([]);
	const serviceA = createTaskService({
		queue,
		ownerId: 'fixture.a',
		signal: ownerA.signal,
		onError: ({ ownerId, key, label, error }) => {
			failures.push({ ownerId, key, label, message: String(error) });
		},
	});
	const serviceB = createTaskService({ queue, ownerId: 'fixture.b', signal: ownerB.signal });
	let workerTask = $state.raw<TaskHandle<Output>>();
	let workerReady = $state(false);
	let applied = $state(0);
	let workerResult = $state('');
	let sourceBytes = $state<number>();
	let taskA = $state.raw<CooperativeTaskHandle<void>>();
	let taskB = $state.raw<CooperativeTaskHandle<void>>();
	let totalA = $state(0);
	let totalB = $state(0);
	let rawCompleted = $state(false);
	let hostWork: WorkHandle | undefined;

	function createWorker() {
		return new Worker(new URL('./task.worker.ts', import.meta.url), { type: 'module' });
	}

	async function runWorker(mode: Input['mode']) {
		workerReady = false;
		workerResult = '';
		const buffer = new Uint8Array([3, 5, 8]).buffer;
		const input: Input = mode === 'transfer' ? { mode, buffer } : { mode };
		const task = serviceA.worker<Input, Output>({
			key: 'worker',
			label: 'Bundled worker',
			input,
			transfer: mode === 'transfer' ? [buffer] : [],
			createWorker: () => {
				const worker = createWorker();
				// Keep fixture diagnostics outside the managed request/result protocol.
				worker.addEventListener('message', (event) => {
					if (event.data.type === 'fixture:ready') {
						workerReady = true;
						task.cancel();
					}
				});
				return worker;
			},
			apply: () => {
				applied++;
			},
		});
		workerTask = task;
		sourceBytes = buffer.byteLength;
		const outcome = await task.result;
		workerResult = JSON.stringify(
			outcome.status === 'completed'
				? {
						status: outcome.status,
						sum: outcome.value.sum,
						bytes: [...new Uint8Array(outcome.value.buffer)],
					}
				: {
						status: outcome.status,
						error: task.error instanceof Error ? task.error.message : null,
					},
		);
	}

	function startCooperative() {
		hostWork = queue.enqueue({
			key: 'host',
			label: 'Host-owned work',
			create: function* () {
				yield;
				rawCompleted = true;
			},
		});
		taskA = serviceA.forEach({
			key: 'shared-key',
			label: 'Owner A',
			items: [1, 2, 3],
			run: (value) => {
				totalA += value;
			},
		});
		taskB = serviceB.forEach({
			key: 'shared-key',
			label: 'Owner B',
			items: [1, 2, 3],
			run: (value) => {
				totalB += value;
			},
		});
		// Pause synchronously before the first animation frame for deterministic ownership checks.
		hostWork.pause();
		taskA.pause();
		taskB.pause();
	}

	onDestroy(() => {
		ownerA.abort();
		ownerB.abort();
	});
</script>

<h1>Managed tasks browser fixture</h1>
<button onclick={() => runWorker('transfer')}>Transfer worker</button>
<button onclick={() => runWorker('delayed')}>Cancel started worker</button>
<button onclick={() => runWorker('failure')}>Fail worker</button>
<div data-testid="worker-status">{workerTask?.status ?? 'idle'}</div>
<div data-testid="worker-ready">{workerReady}</div>
<div data-testid="worker-result">{workerResult}</div>
<div data-testid="source-bytes">{sourceBytes ?? 'unset'}</div>
<div data-testid="applied">{applied}</div>
<div data-testid="failures">{JSON.stringify(failures)}</div>

<button onclick={startCooperative} disabled={!!taskA}>Start shared work</button>
<button onclick={() => ownerA.abort()}>Abort owner A</button>
<button
	onclick={() => {
		hostWork?.resume();
		taskB?.resume();
	}}>Resume owner B</button
>
<div data-testid="a-status">{taskA?.status ?? 'idle'}</div>
<div data-testid="b-status">{taskB?.status ?? 'idle'}</div>
<div data-testid="a-total">{totalA}</div>
<div data-testid="b-total">{totalB}</div>
<div data-testid="raw-completed">{rawCompleted}</div>
<div data-testid="queue-size">{queue.jobs.length}</div>
