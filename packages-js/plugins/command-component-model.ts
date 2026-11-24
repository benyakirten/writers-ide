import type {
	ActivationIdentity,
	ComponentApiConnection,
	FrontendContext,
	ComponentIdentity,
} from './frontend';
import type { PluginApiIdentity } from './index';
import { apiDeclarations, apiKey, captureIdentity } from './component-api-declarations';
import type { Dispose } from './index';
import type { CommandProviderBinding } from './command-dispatcher';

export type CommandContext<Presentation = unknown> = FrontendContext<Presentation>;
export type Declaration = {
	readonly id: string;
	readonly contractId: string;
	readonly major: number;
};
export type Dependency = {
	readonly alias: string;
	readonly apis?: readonly PluginApiIdentity[];
	readonly commands: readonly (Declaration & { readonly alias: string })[];
} & (
	| { readonly binding?: 'instance'; readonly providerSlot: string; readonly optional?: boolean }
	| {
			readonly binding: 'selected-project';
			readonly provider: ComponentIdentity;
			readonly optional: true;
	  }
);
// Slots are already selected by the host. These are not package discovery inputs.
export type ComponentDescriptor<Presentation = unknown> = {
	readonly slotId: string;
	readonly identity: Omit<ActivationIdentity, 'activationId'>;
	readonly provides?: readonly PluginApiIdentity[];
	readonly commands: readonly Declaration[];
	readonly dependencies: readonly Dependency[];
	readonly capabilities: readonly (
		| 'contributions.command'
		| 'contributions.toolbar'
		| 'contributions.view'
	)[];
	readonly activate: (context: CommandContext<Presentation>) => void | Dispose;
};
export type Publication = { binding: CommandProviderBinding; controller: AbortController };
export type Activation = {
	id: string;
	identity: ActivationIdentity;
	apis: Map<string, (connection: ComponentApiConnection) => object>;
	controller: AbortController;
	cleanups: Set<Dispose>;
	publications: Map<string, Publication>;
	seen: Set<string>;
	presentationIds: Set<string>;
	listeners: Set<Dispose>;
	phase: 'setup' | 'active' | 'stopped';
	invalid: boolean;
};
export type Entry<Presentation = unknown> = {
	descriptor: ComponentDescriptor<Presentation>;
	status: 'disabled' | 'active' | 'failed';
	errors: string[];
	activation?: Activation;
};

export function text(value: unknown, field: string, machine = false): asserts value is string {
	if (
		typeof value !== 'string' ||
		value.trim().length === 0 ||
		new TextEncoder().encode(value).length > 256 ||
		(machine && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
	) {
		throw new Error(
			`${field} must be nonempty, at most 256 UTF-8 bytes${machine ? ' and a machine identifier' : ''}`,
		);
	}
}
function list(value: readonly unknown[], limit: number, field: string): void {
	if (!Array.isArray(value) || value.length > limit) {
		throw new Error(`${field} must be an array of at most ${limit} entries`);
	}
}
function unique(values: readonly string[], field: string): void {
	if (new Set(values).size !== values.length) {
		throw new Error(`Duplicate ${field}`);
	}
}
function declaration(value: Declaration): Declaration {
	text(value.id, 'Command ID');
	text(value.contractId, 'Contract ID');
	if (!Number.isSafeInteger(value.major) || value.major <= 0) {
		throw new Error('Contract major must be a positive safe integer');
	}
	return Object.freeze({ id: value.id, contractId: value.contractId, major: value.major });
}
export function capture<Presentation>(
	input: ComponentDescriptor<Presentation>,
): ComponentDescriptor<Presentation> {
	text(input.slotId, 'Host slot');
	const identity = captureIdentity(input.identity);
	const provides = apiDeclarations(input.provides);
	list(input.commands, 32, 'Commands');
	list(input.dependencies, 64, 'Dependencies');
	list(input.capabilities, 3, 'Capabilities');
	unique(input.capabilities, 'capability');
	if (
		input.capabilities.some(
			(value) =>
				!['contributions.command', 'contributions.toolbar', 'contributions.view'].includes(value),
		)
	) {
		throw new Error('Unsupported capability');
	}
	if (typeof input.activate !== 'function') {
		throw new Error('Synchronous activation callback required');
	}
	const commands = Object.freeze(input.commands.map(declaration));
	unique(
		commands.map((value) => value.id),
		'command ID',
	);
	const dependencies = Object.freeze(
		input.dependencies.map((dependency) => {
			text(dependency.alias, 'Dependency alias', true);
			let target;
			if (dependency.binding === 'selected-project') {
				if (
					identity.projectOpeningId !== null ||
					dependency.optional !== true ||
					'providerSlot' in dependency
				) {
					throw new Error(
						'Selected-project dependencies require an optional application consumer and no provider slot',
					);
				}
				const provider = captureIdentity({ ...dependency.provider, projectOpeningId: null });
				target = {
					binding: 'selected-project' as const,
					provider: Object.freeze({
						packageId: provider.packageId,
						componentId: provider.componentId,
					}),
					optional: true as const,
				};
			} else {
				if (dependency.binding !== undefined && dependency.binding !== 'instance') {
					throw new Error('Invalid dependency binding');
				}
				text(dependency.providerSlot, 'Provider slot');
				if (dependency.providerSlot === input.slotId) {
					throw new Error('Self-dependency is forbidden');
				}
				target = {
					binding: 'instance' as const,
					providerSlot: dependency.providerSlot,
					optional: dependency.optional ?? false,
				};
			}
			if (dependency.optional !== undefined && typeof dependency.optional !== 'boolean') {
				throw new Error('Optional must be a boolean');
			}
			list(dependency.commands, 32, 'Dependency commands');
			const requirements = Object.freeze(
				dependency.commands.map((value) => {
					text(value.alias, 'Command alias');
					return Object.freeze({ ...declaration(value), alias: value.alias });
				}),
			);
			unique(
				requirements.map((value) => value.alias),
				'command alias',
			);
			return Object.freeze({
				alias: dependency.alias,
				...target,
				commands: requirements,
				apis: apiDeclarations(dependency.apis),
			});
		}),
	);
	unique(
		dependencies.map((value) => value.alias),
		'dependency alias',
	);
	unique(
		dependencies.map((value) =>
			value.binding === 'selected-project'
				? JSON.stringify([value.binding, value.provider.packageId, value.provider.componentId])
				: JSON.stringify(['instance', value.providerSlot]),
		),
		'dependency target',
	);
	return Object.freeze({
		slotId: input.slotId,
		identity,
		provides,
		commands,
		dependencies,
		capabilities: Object.freeze([...input.capabilities]),
		activate: input.activate,
	});
}

// Observe unsupported asynchronous lifecycle results, including late failures.
export function synchronous(value: unknown): void {
	if (
		value !== null &&
		(typeof value === 'object' || typeof value === 'function') &&
		typeof (value as PromiseLike<unknown>).then === 'function'
	) {
		void Promise.resolve(value).catch(() => undefined);
		throw new Error('Lifecycle callbacks must be synchronous; thenables are not supported');
	}
}
export function own(activation: Activation, dispose: Dispose, report: () => void): Dispose {
	let live = true;
	const release = () => {
		if (!live) {
			return;
		}
		live = false;
		activation.cleanups.delete(release);
		try {
			synchronous(dispose());
		} catch {
			report();
		}
	};
	if (activation.phase === 'stopped') {
		release();
	} else {
		activation.cleanups.add(release);
	}
	return release;
}

export function compatible(provider: Entry, dependency: Dependency): boolean {
	return (
		(dependency.apis ?? []).every((required) =>
			(provider.descriptor.provides ?? []).some(
				(provided) => apiKey(provided) === apiKey(required),
			),
		) &&
		dependency.commands.every((required) =>
			provider.descriptor.commands.some(
				(provided) =>
					provided.id === required.id &&
					provided.contractId === required.contractId &&
					provided.major === required.major,
			),
		)
	);
}
export function published(provider: Entry, dependency: Dependency): boolean {
	return (
		provider.activation?.phase === 'active' &&
		(dependency.apis ?? []).every((api) => provider.activation?.apis.has(apiKey(api))) &&
		dependency.commands.every((command) => provider.activation?.publications.has(command.id))
	);
}

/** Iterative DFS checks the entire required closure before any callback runs. */
export function activationPlan(entries: ReadonlyMap<string, Entry>, target: string): string[] {
	const result: string[] = [];
	const done = new Set<string>();
	const path: string[] = [];
	const visiting = new Set<string>();
	const stack = [{ id: target, exit: false }];
	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.exit) {
			visiting.delete(frame.id);
			path.pop();
			done.add(frame.id);
			result.push(frame.id);
			continue;
		}
		if (done.has(frame.id)) {
			continue;
		}
		if (visiting.has(frame.id)) {
			throw new Error(`Required dependency cycle: ${[...path, frame.id].join(' -> ')}`);
		}
		const entry = entries.get(frame.id);
		if (!entry) {
			throw new Error('Required provider slot is missing');
		}
		visiting.add(frame.id);
		path.push(frame.id);
		stack.push({ id: frame.id, exit: true });
		const dependencies = entry.descriptor.dependencies.filter(
			(value) => value.binding !== 'selected-project' && !value.optional,
		);
		for (const dependency of [...dependencies].reverse()) {
			if (dependency.binding === 'selected-project') {
				continue;
			}
			const provider = entries.get(dependency.providerSlot);
			if (!provider || !compatible(provider, dependency)) {
				throw new Error('Required provider is missing or incompatible');
			}
			if (provider.status === 'active' && !published(provider, dependency)) {
				throw new Error('Required provider command publication is unavailable');
			}
			stack.push({ id: dependency.providerSlot, exit: false });
		}
	}
	return result;
}

export function removalPlan(
	entries: ReadonlyMap<string, Entry>,
	target: string,
): readonly string[] {
	const result: string[] = [];
	const visited = new Set<string>();
	const stack = [{ id: target, exit: false }];
	while (stack.length > 0) {
		const frame = stack.pop()!;
		if (frame.exit) {
			result.push(frame.id);
			continue;
		}
		if (visited.has(frame.id)) {
			continue;
		}
		visited.add(frame.id);
		if (entries.get(frame.id)?.status !== 'active') {
			continue;
		}
		stack.push({ id: frame.id, exit: true });
		const consumers = [...entries]
			.filter(
				([, entry]) =>
					entry.status === 'active' &&
					entry.descriptor.dependencies.some(
						(dependency) =>
							dependency.binding !== 'selected-project' &&
							!dependency.optional &&
							dependency.providerSlot === frame.id,
					),
			)
			.map(([id]) => id)
			.sort();
		for (const id of consumers.reverse()) {
			stack.push({ id, exit: false });
		}
	}
	return Object.freeze(result);
}
