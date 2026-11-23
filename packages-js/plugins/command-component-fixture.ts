import type { CommandComponentHost } from './command-component-host';
import type { CommandContext, ComponentDescriptor, Dependency } from './command-component-model';
import { definePluginCommand, type CommandInvoker, type PluginCommand } from './commands';

const schema: PluginCommand<unknown, unknown, unknown, unknown>['args'] = {
	'~standard': { version: 1, vendor: 'test', validate: (value) => ({ value }) },
};
export const contract = definePluginCommand({
	id: 'test.contract',
	major: 1,
	args: schema,
	result: schema,
});
export const declaration = { id: 'local.ID', contractId: contract.id, major: 1 };
export function dependency(providerSlot = 'provider', optional = false): Dependency {
	return {
		alias: 'analysis',
		providerSlot,
		optional,
		commands: [{ ...declaration, alias: 'run' }],
	};
}
export function descriptor(
	slotId: string,
	activate: ComponentDescriptor['activate'] = () => undefined,
	extra: Partial<ComponentDescriptor> = {},
): ComponentDescriptor {
	return {
		slotId,
		identity: {
			packageId: 'test-fixture',
			componentId: 'synthetic-component',
			projectOpeningId: null,
		},
		activate,
		commands: [],
		dependencies: [],
		capabilities: [],
		...extra,
	};
}
export function provider(
	activate: ComponentDescriptor['activate'] = (context) => {
		publish(context);
	},
	slotId = 'provider',
): ComponentDescriptor {
	return descriptor(slotId, activate, {
		commands: [declaration],
		capabilities: ['contributions.command'],
	});
}
export function publish(context: CommandContext, execute = (value: unknown): unknown => value) {
	return context.contributions.command({ id: declaration.id, name: 'Run', contract, execute });
}
export function consumer(
	host: CommandComponentHost,
	optional = false,
	id = 'consumer',
	target = 'provider',
) {
	let context!: CommandContext;
	host.register(
		descriptor(
			id,
			(value) => {
				context = value;
			},
			{ dependencies: [dependency(target, optional)] },
		),
	);
	return {
		get context() {
			return context;
		},
		get commands() {
			return context.commands;
		},
	};
}
export function execute(commands: CommandInvoker, value: unknown = { text: 'hello' }) {
	return commands.execute('analysis', 'run', contract, value);
}
export function available(commands: CommandInvoker) {
	return commands.isAvailable('analysis', 'run', contract);
}
export function deferred() {
	let resolve!: (value: unknown) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<unknown>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
export async function flush() {
	for (let index = 0; index < 16; index++) {
		await Promise.resolve();
	}
}
