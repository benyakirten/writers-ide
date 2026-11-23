import { definePluginApi } from './index';
import type { ComponentApiConnection } from './frontend';
import type { CommandContext, ComponentDescriptor, Dependency } from './command-component-model';
import { CommandComponentHost } from './command-component-host';
import { descriptor } from './command-component-fixture';

export interface TestApi {
	read(): unknown;
}
export const api = definePluginApi<TestApi>({ id: 'Exact / API 名', major: 1 });
export const api2 = definePluginApi<TestApi>({ id: api.id, major: 2 });
export function requirement(providerSlot = 'provider', optional = false): Dependency {
	return { alias: 'service', providerSlot, optional, apis: [api], commands: [] };
}
export function apiProvider(
	factory: (connection: ComponentApiConnection) => TestApi = () => ({ read: () => 'value' }),
	slotId = 'provider',
	extra: Partial<ComponentDescriptor> = {},
): ComponentDescriptor {
	return descriptor(slotId, (context) => context.apis.provide(api, factory), {
		identity: {
			packageId: '@providers/service',
			componentId: 'provider',
			projectOpeningId: 'opening / opaque',
		},
		provides: [api],
		...extra,
	});
}
export function apiConsumer(
	host: CommandComponentHost,
	optional = false,
	slot = 'consumer',
	target = 'provider',
	setup: (context: CommandContext) => void = () => undefined,
) {
	let context!: CommandContext;
	host.register(
		descriptor(
			slot,
			(value) => {
				context = value;
				setup(value);
			},
			{
				identity: {
					packageId: '@consumers/service',
					componentId: 'consumer',
					projectOpeningId: null,
				},
				dependencies: [requirement(target, optional)],
			},
		),
	);
	return {
		get context() {
			return context;
		},
		get api() {
			return context.apis.get('service', api);
		},
	};
}
