import { describe, expect, it, vi } from 'vitest';
import {
	createHost,
	contract,
	declaration,
	deferred,
	flush,
	publish,
} from './command-component-fixture';
import { api } from './component-api-fixture';
import { application, projectProvider } from './component-project-fixture';
import { createCommandReservationLedger, DEFAULT_RESERVATION_LIMITS } from './command-reservations';
import type { ProjectApiConnection } from './frontend';
import type { CommandDiagnostic } from './command-dispatcher';

const execute = (lease: ProjectApiConnection, value: unknown = null) =>
	lease.commands.execute('project-service', 'run', contract, value);
const available = (lease: ProjectApiConnection) =>
	lease.commands.isAvailable('project-service', 'run', contract);

describe('project lease command lifetimes', () => {
	it('cancels only one lease and retains running reservations under the actual owner until settlement', async () => {
		const ledger = createCommandReservationLedger({
			...DEFAULT_RESERVATION_LIMITS,
			maxCallerPending: 1,
		});
		const diagnostics: CommandDiagnostic[] = [];
		const host = createHost({ ledger, diagnostics: (data) => diagnostics.push(data) });
		const ref = host.openProject('id', 'Name');
		const gate = deferred();
		const signals: AbortSignal[] = [];
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, () => ({ read: () => 1 }));
				context.contributions.command({
					id: declaration.id,
					name: 'Run',
					contract,
					execute: (_args, invocation) => {
						signals.push(invocation.signal);
						return gate.promise;
					},
				});
			}),
		);
		host.activate('provider');
		const app = application(host);
		const one = app.projects.connect(ref);
		const two = app.projects.connect(ref);
		const pending = execute(one);
		const rejected = expect(pending).rejects.toMatchObject({ code: 'revoked' });
		await flush();
		expect(signals).toHaveLength(1);
		one.dispose();
		await rejected;
		expect(signals[0].aborted).toBe(true);
		expect(two.signal.aborted).toBe(false);
		expect(available(two)).toBe(true);
		expect(host.get('provider')!.status).toBe('active');
		expect(ledger.snapshot().pending).toBe(1);
		expect(
			ledger.snapshot().components.find((value) => value.id === app.identity.activationId)
				?.callerPending,
		).toBe(1);
		await expect(execute(two)).rejects.toMatchObject({ code: 'limit-exceeded' });
		expect(diagnostics.every((data) => data.callerInstanceId === app.identity.activationId)).toBe(
			true,
		);
		gate.resolve('late');
		await flush();
		expect(ledger.snapshot().pending).toBe(0);
		await expect(execute(two)).resolves.toBe('late');
		host.dispose();
	});

	it('routes commands to the lease fixed opening and exact identity, never selected or first registered', async () => {
		const host = createHost();
		const one = host.openProject('one', 'Same');
		const two = host.openProject('two', 'Same');
		host.register(
			projectProvider(one, 'first', (context) => {
				context.apis.provide(api, () => ({ read: () => 1 }));
				publish(context, () => 'one');
			}),
		);
		host.activate('first');
		host.register(
			projectProvider(two, 'second', (context) => {
				context.apis.provide(api, () => ({ read: () => 2 }));
				publish(context, () => 'two');
			}),
		);
		host.activate('second');
		const app = application(host);
		const lease = app.projects.connect(two);
		host.selectProject(one);
		await expect(execute(lease)).resolves.toBe('two');
		host.selectProject(null);
		await expect(execute(lease)).resolves.toBe('two');
		host.closeProject(two);
		await expect(execute(lease)).rejects.toMatchObject({ code: 'revoked' });
		expect(app.signal.aborted).toBe(false);
		host.dispose();
	});

	it('keeps command subscriptions independent and leases alive after publication loss and provider replacement', async () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		let remove!: () => void;
		const gate = deferred();
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, () => ({ read: () => 'still here' }));
				remove = publish(context, () => gate.promise);
			}),
		);
		host.activate('provider');
		const app = application(host);
		const one = app.projects.connect(ref);
		const two = app.projects.connect(ref);
		const a = vi.fn();
		const b = vi.fn();
		one.commands.subscribeAvailability('project-service', 'run', contract, a);
		const stop = two.commands.subscribeAvailability('project-service', 'run', contract, b);
		const pending = execute(two);
		const rejected = expect(pending).rejects.toMatchObject({ code: 'revoked' });
		await flush();
		one.dispose();
		stop();
		const aCount = a.mock.calls.length;
		const bCount = b.mock.calls.length;
		remove();
		await rejected;
		expect(a).toHaveBeenCalledTimes(aCount);
		expect(b).toHaveBeenCalledTimes(bCount);
		expect(two.signal.aborted).toBe(false);
		expect(available(two)).toBe(false);
		expect(two.get('project-service', api)!.read()).toBe('still here');
		gate.reject(new Error('observed late failure'));
		await flush();
		host.deactivate('provider');
		host.activate('provider');
		expect(available(two)).toBe(true);
		host.dispose();
	});

	it('revokes both leases and running invocations before consumer cleanup while leaving provider active', async () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const gate = deferred();
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, () => ({ read: () => 1 }));
				publish(context, () => gate.promise);
			}),
		);
		host.activate('provider');
		let leases: ProjectApiConnection[] = [];
		const cleaned: boolean[] = [];
		const app = application(host, (context) =>
			context.own(() => {
				cleaned.push(leases.every((lease) => lease.signal.aborted));
			}),
		);
		leases = [app.projects.connect(ref), app.projects.connect(ref)];
		const calls = leases.map((lease) => execute(lease));
		const rejected = calls.map((call) => expect(call).rejects.toMatchObject({ code: 'revoked' }));
		await flush();
		host.deactivate('application');
		await Promise.all(rejected);
		expect(cleaned).toEqual([true]);
		expect(host.get('provider')!.status).toBe('active');
		gate.resolve(null);
		await flush();
		host.dispose();
	});
});
