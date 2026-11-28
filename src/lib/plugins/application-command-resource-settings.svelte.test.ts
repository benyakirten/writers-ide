import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FrontendContext } from '@writers-ide/plugins';
import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import type { ComponentDescriptor } from '../../../packages-js/plugins/command-component-model';
import { definePluginCommand } from '../../../packages-js/plugins/commands';
import {
	createCommandReservationLedger,
	DEFAULT_RESERVATION_LIMITS,
	type ReservationLimits,
} from '../../../packages-js/plugins/command-reservations';
import {
	createCommandResourceSettingsClient,
	createCommandResourceSettingsCoordinator,
	type CommandResourceSettingsState,
} from '../../../packages-js/plugins/command-resource-settings';
import { BarItemRegistry } from '$lib/editor/state/bar-item-registry.svelte';
import { TabStateRegistry } from '$lib/editor/state/tab-state-registry.svelte';
import {
	createApplicationComponentHost,
	type ApplicationComponentHostOptions,
} from './application-component-host.svelte';

type Context = FrontendContext<SveltePresentation>;
const cleanups: (() => void)[] = [];
const configured: ReservationLimits = {
	payload: { maxBytes: 1024, maxDepth: 12, maxEntries: 128 },
	maxComponentBytes: 8192,
	maxWindowBytes: 16384,
	maxCallerPending: 4,
	maxProviderPending: 5,
	maxWindowPending: 6,
};
const schema = {
	'~standard': {
		version: 1 as const,
		vendor: 'test',
		validate: (value: unknown) => ({ value }),
	},
};
const contract = definePluginCommand({
	id: 'settings.echo',
	major: 1,
	args: schema,
	result: schema,
});
const declaration = { id: 'echo', contractId: contract.id, major: 1 };

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((yes) => {
		resolve = yes;
	});
	return { promise, resolve };
}
async function flush() {
	for (let index = 0; index < 32; index++) {
		await Promise.resolve();
	}
}
function settings(
	initial = configured,
	revision = '10',
	initialRead?: Promise<CommandResourceSettingsState>,
) {
	let state: CommandResourceSettingsState = { revision, settings: initial };
	const source = {
		read: vi.fn(() => initialRead ?? Promise.resolve(state)),
		write: vi.fn(async (expected: string, limits: ReservationLimits) => {
			if (expected !== state.revision) {
				return { kind: 'conflict' as const, snapshot: state };
			}
			state = { revision: String(BigInt(state.revision) + 1n), settings: limits };
			return { kind: 'saved' as const, snapshot: state };
		}),
	};
	const coordinator = createCommandResourceSettingsCoordinator(source, { maxSubscribers: 1 });
	const closeSubscription = vi.fn();
	const service = {
		epoch: coordinator.epoch,
		read: coordinator.read,
		subscribe: vi.fn((observer: Parameters<typeof coordinator.subscribe>[0]) => {
			const subscription = coordinator.subscribe(observer);
			return {
				close() {
					closeSubscription();
					subscription.close();
				},
			};
		}),
	};
	cleanups.push(coordinator.close);
	return {
		coordinator,
		service,
		closeSubscription,
		async save(limits: ReservationLimits) {
			const result = await coordinator.write(state.revision, limits);
			expect(result.kind).toBe('saved');
			await flush();
		},
	};
}
function assembly(options: ApplicationComponentHostOptions = {}) {
	const result = createApplicationComponentHost({
		bars: new BarItemRegistry(),
		views: new TabStateRegistry(),
		...options,
	});
	cleanups.push(result.dispose);
	return result;
}
function descriptor(
	slotId: string,
	activate: (context: Context) => void,
): ComponentDescriptor<SveltePresentation> {
	return {
		slotId,
		identity: { packageId: 'settings-test', componentId: slotId, projectOpeningId: null },
		commands: [],
		dependencies: [],
		capabilities: [],
		activate,
	};
}
function commands(
	a: ReturnType<typeof assembly>,
	implementation: (value: unknown, context: { readonly signal: AbortSignal }) => unknown = (
		value,
	) => value,
) {
	let caller!: Context;
	let provider!: Context;
	const execute = vi.fn(implementation);
	a.host.register({
		...descriptor('provider', (context) => {
			provider = context;
			context.contributions.command({ id: declaration.id, name: 'Echo', contract, execute });
		}),
		commands: [declaration],
		capabilities: ['contributions.command'],
	});
	a.host.register({
		...descriptor('caller', (context) => {
			caller = context;
		}),
		dependencies: [
			{
				alias: 'provider',
				providerSlot: 'provider',
				optional: false,
				commands: [{ ...declaration, alias: 'echo' }],
			},
		],
	});
	a.host.activate('caller');
	return {
		caller,
		provider,
		execute,
		invoke: (value: unknown = null, signal?: AbortSignal) =>
			caller.commands.execute('provider', 'echo', contract, value, { signal }),
	};
}

afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) {
		cleanup();
	}
	vi.restoreAllMocks();
});

describe('opt-in application command resource settings', () => {
	it('keeps standalone defaults and explicit ledger injection unchanged', async () => {
		const standalone = commands(assembly());
		await expect(standalone.invoke('default')).resolves.toBe('default');
		const ledger = createCommandReservationLedger({ ...configured, maxWindowPending: 1 });
		const existing = ledger.admit('existing-caller', 'existing-provider');
		try {
			const injected = commands(assembly({ ledger }));
			await expect(injected.invoke()).rejects.toMatchObject({ code: 'limit-exceeded' });
			expect(ledger.snapshot().pending).toBe(1);
			existing.release();
			await expect(injected.invoke('injected')).resolves.toBe('injected');
		} finally {
			existing.release();
		}
	});

	it('rejects dual ledger ownership before constructing an assembly', () => {
		const ledger = createCommandReservationLedger();
		const client = createCommandResourceSettingsClient(ledger);

		// The runtime guard also protects callers that do not use TypeScript.
		const invalid = { resourceSettingsClient: client, ledger };
		// @ts-expect-error A client already owns its ledger's settings.
		expect(() => createApplicationComponentHost(invalid)).toThrow('not both');

		expect(client.status).toBe('disconnected');
		client.dispose();
	});

	it('pauses admission until the initial snapshot and applies all eight fields to the injected ledger', async () => {
		const initial = deferred<CommandResourceSettingsState>();
		const source = settings(configured, '10', initial.promise);
		const ledger = createCommandReservationLedger();
		const update = vi.spyOn(ledger, 'updateLimits');
		const admit = vi.spyOn(ledger, 'admit');
		const existing = ledger.admit('existing-caller', 'existing-provider');
		const client = createCommandResourceSettingsClient(ledger);
		const c = commands(assembly({ resourceSettingsClient: client }));
		try {
			await expect(c.invoke()).rejects.toMatchObject({ code: 'execution-failed' });
			client.attach(source.service);
			await expect(c.invoke()).rejects.toMatchObject({ code: 'execution-failed' });
			expect(c.execute).not.toHaveBeenCalled();
			expect(update).not.toHaveBeenCalled();
			expect(ledger.snapshot().pending).toBe(1);
			initial.resolve({ revision: '10', settings: configured });
			await flush();
			expect(client.status).toBe('ready');
			expect(update).toHaveBeenCalledExactlyOnceWith(configured);
			expect(ledger.snapshot().pending).toBe(1);
			expect(existing.limits).toEqual(DEFAULT_RESERVATION_LIMITS);
			await expect(c.invoke('configured')).resolves.toBe('configured');
			expect(admit.mock.results.at(-1)?.value.limits).toEqual(configured);
			expect(ledger.snapshot().pending).toBe(1);
		} finally {
			existing.release();
		}
	});

	it('lowers limits without changing live-call limits or releasing cancelled unfinished work', async () => {
		const source = settings();
		const ledger = createCommandReservationLedger();
		const client = createCommandResourceSettingsClient(ledger);
		client.attach(source.service);
		await flush();
		const first = deferred<unknown>();
		const second = deferred<unknown>();
		const c = commands(assembly({ resourceSettingsClient: client }), (value) =>
			value === 'first' ? first.promise : second.promise,
		);
		const controller = new AbortController();
		const cancelled = c.invoke('first', controller.signal);
		const running = c.invoke('second');
		await flush();
		expect(c.execute).toHaveBeenCalledTimes(2);
		const before = ledger.snapshot();
		expect(before.pending).toBe(2);
		expect(before.bytes).toBeGreaterThan(1);
		await source.save({
			payload: { maxBytes: 1, maxDepth: 1, maxEntries: 1 },
			maxComponentBytes: 1,
			maxWindowBytes: 1,
			maxCallerPending: 1,
			maxProviderPending: 1,
			maxWindowPending: 1,
		});
		expect(ledger.snapshot()).toEqual(before);
		await expect(c.invoke()).rejects.toMatchObject({ code: 'limit-exceeded' });
		controller.abort();
		await expect(cancelled).rejects.toMatchObject({ code: 'cancelled' });
		expect(ledger.snapshot()).toEqual(before);
		expect(c.execute.mock.calls[0][1].signal.aborted).toBe(true);
		expect(c.execute.mock.calls[1][1].signal.aborted).toBe(false);
		second.resolve('result larger than the new payload budget');
		await expect(running).resolves.toBe('result larger than the new payload budget');
		await flush();
		expect(ledger.snapshot().pending).toBe(1);
		expect(ledger.snapshot().bytes).toBeGreaterThan(1);
		await expect(c.invoke()).rejects.toMatchObject({ code: 'limit-exceeded' });
		first.resolve('late cancelled result');
		await flush();
		expect(ledger.snapshot()).toEqual({ pending: 0, bytes: 0, components: [] });
		await expect(c.invoke('too large')).rejects.toMatchObject({ code: 'limit-exceeded' });
		expect(c.execute).toHaveBeenCalledTimes(2);
		await source.save(configured);
		await expect(c.invoke('second')).resolves.toBe('result larger than the new payload budget');
	});

	it('disconnects only new admission while already admitted work completes', async () => {
		const source = settings();
		const client = createCommandResourceSettingsClient();
		client.attach(source.service);
		await flush();
		const work = deferred<unknown>();
		const c = commands(assembly({ resourceSettingsClient: client }), () => work.promise);
		const running = c.invoke('retained');
		await flush();
		const before = client.ledger.snapshot();
		client.disconnect();
		expect(source.closeSubscription).toHaveBeenCalledTimes(1);
		expect(client.status).toBe('disconnected');
		expect(client.ledger.snapshot()).toEqual(before);
		await expect(c.invoke()).rejects.toMatchObject({ code: 'execution-failed' });
		expect(c.execute).toHaveBeenCalledTimes(1);
		expect(c.execute.mock.calls[0][1].signal.aborted).toBe(false);
		work.resolve('completed while disconnected');
		await expect(running).resolves.toBe('completed while disconnected');
		await flush();
		expect(client.ledger.snapshot()).toEqual({ pending: 0, bytes: 0, components: [] });
	});

	it('requires explicit reattachment after closure and accepts a restored lower revision in a new epoch without resetting counters', async () => {
		const original = settings(configured, '100');
		const restored = settings({ ...configured, maxWindowPending: 1 }, '2');
		const client = createCommandResourceSettingsClient();
		client.attach(original.service);
		await flush();
		const work = deferred<unknown>();
		const a = assembly({ resourceSettingsClient: client });
		const c = commands(a, () => work.promise);
		const running = c.invoke('retained');
		await flush();
		const before = client.ledger.snapshot();
		const identity = a.host.get('caller')?.instanceId;
		original.coordinator.close();
		expect(client.status).toBe('stale');
		await expect(c.invoke()).rejects.toMatchObject({ code: 'execution-failed' });
		client.attach(restored.service);
		expect(client.status).toBe('connecting');
		await expect(c.invoke()).rejects.toMatchObject({ code: 'execution-failed' });
		await flush();
		expect(restored.service.epoch).not.toBe(original.service.epoch);
		expect(client.status).toBe('ready');
		expect(client.ledger.snapshot()).toEqual(before);
		expect(a.host.get('caller')?.instanceId).toBe(identity);
		expect(c.caller.signal.aborted).toBe(false);
		expect(c.provider.signal.aborted).toBe(false);
		await expect(c.invoke()).rejects.toMatchObject({ code: 'limit-exceeded' });
		work.resolve('old work');
		await expect(running).resolves.toBe('old work');
		await flush();
		await expect(c.invoke()).resolves.toBe('old work');
	});

	it.each(['assembly', 'host'] as const)(
		'removes the subscription on %s disposal, but not on rejected reentrant disposal',
		async (owner) => {
			const source = settings();
			const ledger = createCommandReservationLedger();
			const update = vi.spyOn(ledger, 'updateLimits');
			const client = createCommandResourceSettingsClient(ledger);
			client.attach(source.service);
			await flush();
			const a = assembly({ resourceSettingsClient: client });
			const dispose = owner === 'assembly' ? a.dispose : () => a.host.dispose();
			const cleanupStates: { status: string; subscriptionCloses: number; rejected: boolean }[] = [];
			const duringCleanup = vi.fn(() => {
				const state = {
					status: client.status,
					subscriptionCloses: source.closeSubscription.mock.calls.length,
					rejected: false,
				};
				try {
					dispose();
				} catch {
					state.rejected = true;
				}
				cleanupStates.push(state);
			});
			a.host.register(
				descriptor('reentrant', (context) => {
					expect(() => dispose()).toThrow();
					context.own(duringCleanup);
				}),
			);
			a.host.activate('reentrant');
			expect(client.status).toBe('ready');
			expect(source.closeSubscription).not.toHaveBeenCalled();
			const c = commands(a);
			await expect(c.invoke('still attached')).resolves.toBe('still attached');
			dispose();
			expect(duringCleanup).toHaveBeenCalledTimes(1);
			expect(cleanupStates).toEqual([{ status: 'ready', subscriptionCloses: 0, rejected: true }]);
			expect(client.status).toBe('disposed');
			expect(source.closeSubscription).toHaveBeenCalledTimes(1);
			await source.save({ ...configured, maxWindowPending: 2 });
			expect(update).toHaveBeenCalledTimes(1);
			// The coordinator's sole subscription slot was released, not merely ignored.
			const replacement = createCommandResourceSettingsClient();
			replacement.attach(source.service);
			await flush();
			expect(replacement.status).toBe('ready');
			replacement.dispose();
			dispose();
		},
	);
});
