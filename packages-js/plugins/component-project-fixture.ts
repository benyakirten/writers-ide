import { createHost, descriptor, declaration, publish } from './command-component-fixture';
import { api } from './component-api-fixture';
import type { CommandContext, ComponentDescriptor, Dependency } from './command-component-model';
import type { ComponentApiConnection, ProjectReference } from './frontend';

export const target = Object.freeze({ packageId: 'project-services', componentId: 'service' });
export function selected(extra: Partial<Dependency> = {}): Dependency {
	return {
		alias: 'project-service',
		binding: 'selected-project',
		provider: target,
		optional: true,
		apis: [api],
		commands: [{ ...declaration, alias: 'run' }],
		...extra,
	} as Dependency;
}
export function projectProvider(
	project: ProjectReference,
	slot = 'provider',
	setup: (context: CommandContext) => void = (context) => {
		context.apis.provide(api, () => ({ read: () => project.id }));
		publish(context);
	},
	extra: Partial<ComponentDescriptor> = {},
) {
	return descriptor(slot, setup, {
		identity: { ...target, projectOpeningId: project.openingId },
		provides: [api],
		commands: [declaration],
		capabilities: ['contributions.command'],
		...extra,
	});
}
export function application(
	host: ReturnType<typeof createHost>,
	setup: (context: CommandContext) => void = () => undefined,
	extra: Partial<ComponentDescriptor> = {},
) {
	let context!: CommandContext;
	host.register(
		descriptor(
			'application',
			(value) => {
				context = value;
				setup(value);
			},
			{
				dependencies: [selected()],
				...extra,
			},
		),
	);
	host.activate('application');
	return context as CommandContext & {
		project: null;
		projects: NonNullable<CommandContext['projects']>;
	};
}
export function captureFactory(endpoints: ComponentApiConnection[], value: unknown = 'value') {
	return (connection: ComponentApiConnection) => {
		endpoints.push(connection);
		return { read: () => value };
	};
}
