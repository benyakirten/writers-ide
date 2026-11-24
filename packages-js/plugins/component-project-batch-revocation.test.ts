import { describe, expect, it } from 'vitest';
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

const cases = (['close-project', 'stop-consumer', 'dispose-host'] as const).flatMap((operation) =>
	(['lease-abort', 'invocation-abort', 'diagnostic'] as const).map((observer) => ({
		operation,
		observer,
	})),
);

describe('project command batch revocation', () => {
	it.each(cases)(
		'fixes all outcomes before $observer callbacks during $operation',
		async ({ operation, observer }) => {
			const ledger = createCommandReservationLedger({
				...DEFAULT_RESERVATION_LIMITS,
				maxCallerPending: 2,
			});
			const requests = [new AbortController(), new AbortController()];
			const gate = deferred();
			const invocationSignals: AbortSignal[] = [];
			let diagnostics = 0;
			const host = createHost({
				ledger,
				diagnostics: (data) => {
					if (data.code === 'revoked' && data.phase === 'implementation') {
						diagnostics++;
						if (observer === 'diagnostic') {
							requests[1].abort();
						}
					}
				},
			});
			const project = host.openProject('one', 'One');
			host.register(
				projectProvider(project, 'provider', (context) => {
					context.apis.provide(api, () => ({ read: () => 1 }));
					context.contributions.command({
						id: declaration.id,
						name: 'Run',
						contract,
						execute: (_args, invocation) => {
							invocationSignals.push(invocation.signal);
							return gate.promise;
						},
					});
				}),
			);
			host.activate('provider');
			const app = application(host);
			const leases = [app.projects.connect(project), app.projects.connect(project)];
			const handles = leases.map((lease) => lease.get('project-service', api)!);
			const outcomes = leases.map((lease, index) =>
				lease.commands
					.execute('project-service', 'run', contract, null, { signal: requests[index].signal })
					.catch((error: unknown) => error),
			);
			await flush();
			expect(invocationSignals).toHaveLength(2);
			const checks: boolean[] = [];
			const checkHandlesAndCancel = () => {
				checks.push(
					leases.every((lease) => {
						try {
							lease.commands.isAvailable('project-service', 'run', contract);
							return false;
						} catch {
							return true;
						}
					}),
				);
				checks.push(
					handles.every((handle) => {
						try {
							handle.read();
							return false;
						} catch {
							return true;
						}
					}),
				);
				requests[1].abort();
			};
			if (observer === 'lease-abort') {
				leases[0].signal.addEventListener('abort', checkHandlesAndCancel);
			}
			if (observer === 'invocation-abort') {
				invocationSignals[0].addEventListener('abort', checkHandlesAndCancel);
			}
			if (operation === 'close-project') {
				host.closeProject(project);
			} else if (operation === 'stop-consumer') {
				host.deactivate('application');
			} else {
				host.dispose();
			}
			expect(await Promise.all(outcomes)).toEqual([
				expect.objectContaining({ code: 'revoked' }),
				expect.objectContaining({ code: 'revoked' }),
			]);
			expect(diagnostics).toBe(2);
			if (observer !== 'diagnostic') {
				expect(checks).toEqual([true, true]);
			}
			expect(invocationSignals.every((signal) => signal.aborted)).toBe(true);
			expect(ledger.snapshot().pending).toBe(2);
			expect(
				ledger.snapshot().components.find((value) => value.id === app.identity.activationId)
					?.callerPending,
			).toBe(2);
			expect(() => ledger.admit(app.identity.activationId, 'another-provider')).toThrow();
			gate.resolve('late');
			await flush();
			expect(ledger.snapshot().pending).toBe(0);
			host.dispose();
		},
	);

	it.each(['invocation-abort', 'diagnostic'] as const)(
		'guards lifecycle mutations from %s during explicit idle-host lease disposal',
		async (observer) => {
			const ledger = createCommandReservationLedger({
				...DEFAULT_RESERVATION_LIMITS,
				maxCallerPending: 1,
			});
			const gate = deferred();
			const signals: AbortSignal[] = [];
			const mutationErrors: unknown[] = [];
			let deliveries = 0;
			const attemptMutations = () => {
				deliveries++;
				for (const mutate of [
					() => host.openProject('from-observer', 'Forbidden'),
					() => host.deactivate('application'),
				]) {
					try {
						mutate();
					} catch (error) {
						mutationErrors.push(error);
					}
				}
			};
			const host = createHost({
				ledger,
				diagnostics: (data) => {
					if (
						observer === 'diagnostic' &&
						data.code === 'revoked' &&
						data.phase === 'implementation'
					) {
						attemptMutations();
					}
				},
			});
			const ref = host.openProject('id', 'Name');
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
			const lease = app.projects.connect(ref);
			const sibling = app.projects.connect(ref);
			const outcome = lease.commands
				.execute('project-service', 'run', contract, null)
				.catch((error: unknown) => error);
			await flush();
			expect(signals).toHaveLength(1);
			if (observer === 'invocation-abort') {
				signals[0].addEventListener('abort', attemptMutations);
			}
			lease.dispose();
			expect(await outcome).toMatchObject({ code: 'revoked' });
			expect(deliveries).toBe(1);
			expect(mutationErrors).toEqual([
				expect.objectContaining({ message: expect.stringContaining('busy') }),
				expect.objectContaining({ message: expect.stringContaining('busy') }),
			]);
			expect(host.get('application')!.status).toBe('active');
			expect(host.get('provider')!.status).toBe('active');
			expect(sibling.signal.aborted).toBe(false);
			expect(ledger.snapshot().pending).toBe(1);
			await expect(
				sibling.commands.execute('project-service', 'run', contract, null),
			).rejects.toMatchObject({ code: 'limit-exceeded' });
			host.openProject('from-observer', 'Allowed after delivery');
			gate.resolve(null);
			await flush();
			expect(ledger.snapshot().pending).toBe(0);
			host.dispose();
		},
	);

	it('preserves cancellation already processed before closure while revoking the remaining call', async () => {
		const ledger = createCommandReservationLedger();
		const host = createHost({ ledger });
		const ref = host.openProject('id', 'Name');
		const gate = deferred();
		host.register(
			projectProvider(ref, 'provider', (context) => {
				context.apis.provide(api, () => ({ read: () => 1 }));
				publish(context, () => gate.promise);
			}),
		);
		host.activate('provider');
		const app = application(host);
		const request = new AbortController();
		const leases = [app.projects.connect(ref), app.projects.connect(ref)];
		const first = leases[0].commands
			.execute('project-service', 'run', contract, null, { signal: request.signal })
			.catch((error: unknown) => error);
		const second = leases[1].commands
			.execute('project-service', 'run', contract, null)
			.catch((error: unknown) => error);
		await flush();
		request.abort();
		host.closeProject(ref);
		expect(await first).toMatchObject({ code: 'cancelled' });
		expect(await second).toMatchObject({ code: 'revoked' });
		expect(ledger.snapshot().pending).toBe(2);
		gate.resolve(null);
		await flush();
		expect(ledger.snapshot().pending).toBe(0);
		host.dispose();
	});

	it('uses the same batch phases for multiple calls in one disposed lease, without revoking its sibling', async () => {
		const host = createHost();
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
		const lease = app.projects.connect(ref);
		const sibling = app.projects.connect(ref);
		const request = new AbortController();
		const calls = [undefined, request.signal].map((signal) =>
			lease.commands
				.execute('project-service', 'run', contract, null, { signal })
				.catch((error: unknown) => error),
		);
		await flush();
		signals[0].addEventListener('abort', () => request.abort());
		lease.dispose();
		expect(await Promise.all(calls)).toEqual([
			expect.objectContaining({ code: 'revoked' }),
			expect.objectContaining({ code: 'revoked' }),
		]);
		expect(sibling.signal.aborted).toBe(false);
		expect(sibling.commands.isAvailable('project-service', 'run', contract)).toBe(true);
		expect(sibling.get('project-service', api)!.read()).toBe(1);
		gate.resolve(null);
		await flush();
		host.dispose();
	});
});
