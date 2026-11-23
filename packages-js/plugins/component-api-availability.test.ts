import { describe, expect, it, vi } from 'vitest';
import { createHost } from './command-component-fixture';
import type { CommandContext } from './command-component-model';
import type { ComponentApiConnection } from './frontend';
import {
	available,
	contract,
	declaration,
	deferred,
	dependency,
	descriptor,
	execute,
	flush,
	publish,
} from './command-component-fixture';
import { api, apiConsumer, apiProvider } from './component-api-fixture';

describe('component API runtime availability', () => {
	it('preserves a mixed optional dependency API and pending surviving command after another command is released', async () => {
		const host = createHost();
		const removed = deferred();
		const surviving = deferred();
		const service = deferred();
		const cleanup = vi.fn();
		let release!: () => void;
		let connection!: ComponentApiConnection;
		const second = { ...declaration, id: 'surviving-command' };
		host.register(
			apiProvider(undefined, 'provider', {
				commands: [declaration, second],
				capabilities: ['contributions.command'],
				activate: (context) => {
					release = publish(context, () => removed.promise);
					context.contributions.command({
						id: second.id,
						name: 'Surviving',
						contract,
						execute: () => surviving.promise,
					});
					context.apis.provide(api, (value) => {
						connection = value;
						value.own(cleanup);
						return { read: () => service.promise };
					});
				},
			}),
		);
		let context!: CommandContext;
		host.register(
			descriptor(
				'consumer',
				(value) => {
					context = value;
				},
				{
					dependencies: [
						{
							...dependency('provider', true),
							apis: [api],
							commands: [...dependency().commands, { ...second, alias: 'surviving' }],
						},
					],
				},
			),
		);
		host.activate('provider');
		host.activate('consumer');
		const facade = context.apis.get('analysis', api)!;
		const events: unknown[] = [];
		context.apis.subscribe('analysis', api, (value) => events.push(value));
		const serviceCall = facade.read();
		expect(serviceCall).toBe(service.promise);
		const removedCall = execute(context.commands);
		const removedOutcome = expect(removedCall).rejects.toMatchObject({ code: 'revoked' });
		const survivingCall = context.commands.execute('analysis', 'surviving', contract, 42);
		await flush();
		release();
		await removedOutcome;
		expect(host.get('provider')!.status).toBe('active');
		expect(host.get('consumer')!.status).toBe('active');
		expect(available(context.commands)).toBe(false);
		expect(context.commands.isAvailable('analysis', 'surviving', contract)).toBe(true);
		expect(context.apis.get('analysis', api)).toBe(facade);
		expect(events).toEqual([facade]);
		const later: unknown[] = [];
		context.apis.subscribe('analysis', api, (value) => later.push(value));
		expect(later).toEqual([facade]);
		expect(connection.signal.aborted).toBe(false);
		expect(cleanup).not.toHaveBeenCalled();
		surviving.resolve('command completed');
		service.resolve('service completed');
		removed.resolve('ignored');
		expect(await survivingCall).toBe('command completed');
		expect(await serviceCall).toBe('service completed');
		expect(facade.read()).toBe(service.promise);
		host.dispose();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});

	it('observes asynchronous listener rejection without treating a pending promise as failure or unsubscribing', async () => {
		const host = createHost();
		host.register(apiProvider());
		const consumer = apiConsumer(host, true);
		host.activate('provider');
		host.activate('consumer');
		const pending = deferred();
		const listener = vi
			.fn((_value: unknown): void | Promise<unknown> => undefined)
			.mockImplementationOnce(() => pending.promise);
		const dispose = consumer.context.apis.subscribe('service', api, listener);
		expect(host.get('consumer')!.errors).toEqual([]);
		pending.reject(new Error('private async listener source'));
		await flush();
		expect(host.get('consumer')!.errors).toEqual(['api-listener-failed']);
		expect(host.get('provider')!.errors).toEqual([]);
		host.deactivate('provider');
		host.activate('provider');
		expect(listener.mock.calls.map(([value]) => value)).toEqual([
			listener.mock.calls[0][0],
			null,
			consumer.api,
		]);
		expect(JSON.stringify(host.list())).not.toContain('private async listener source');
		dispose();
		dispose();
		host.deactivate('provider');
		expect(listener).toHaveBeenCalledTimes(3);
		host.dispose();
	});

	it('ignores late listener rejection from a stopped consumer instead of attributing it to the replacement', async () => {
		const host = createHost();
		host.register(apiProvider());
		const consumer = apiConsumer(host, true);
		host.activate('provider');
		host.activate('consumer');
		const pending = deferred();
		const oldContext = consumer.context;
		const listener = vi.fn(() => pending.promise);
		oldContext.apis.subscribe('service', api, listener);
		host.deactivate('consumer');
		host.activate('consumer');
		expect(consumer.context.identity.activationId).not.toBe(oldContext.identity.activationId);
		pending.reject(new Error('private stale listener source'));
		await flush();
		expect(host.get('consumer')!.errors).toEqual([]);
		expect(host.get('provider')!.errors).toEqual([]);
		host.deactivate('provider');
		host.activate('provider');
		expect(listener).toHaveBeenCalledTimes(1);
		host.dispose();
	});
});
