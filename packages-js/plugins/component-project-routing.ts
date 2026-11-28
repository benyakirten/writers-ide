import type { ComponentDescriptor, Dependency, Entry } from './command-component-model';

export type ConnectionScope = {
	readonly id: number;
	readonly openingId?: string;
	readonly signal: AbortSignal;
	readonly isLive: () => boolean;
};

export function sameInstance(a: ComponentDescriptor, b: ComponentDescriptor): boolean {
	return (
		a.identity.packageId === b.identity.packageId &&
		a.identity.componentId === b.identity.componentId &&
		a.identity.projectOpeningId === b.identity.projectOpeningId
	);
}

export function assertDirectScope(
	consumer: ComponentDescriptor,
	provider: ComponentDescriptor,
): void {
	const opening = provider.identity.projectOpeningId;
	if (opening !== null && opening !== consumer.identity.projectOpeningId) {
		throw new Error('Direct dependency must target an application or the same project opening');
	}
}

export function routed(dependency: Dependency, openingId?: string): boolean {
	return (dependency.binding === 'selected-project') === (openingId !== undefined);
}

export function resolveProvider(
	entries: ReadonlyMap<string, Entry>,
	consumer: Entry,
	dependency: Dependency,
	openingId?: string,
): Entry | undefined {
	if (!routed(dependency, openingId)) {
		throw new Error('Invalid dependency binding route');
	}
	if (dependency.binding !== 'selected-project') {
		const provider = entries.get(dependency.providerSlot);
		if (provider) {
			assertDirectScope(consumer.descriptor, provider.descriptor);
		}
		return provider;
	}
	const matches = [...entries.values()].filter(
		({ descriptor: { identity } }) =>
			identity.packageId === dependency.provider.packageId &&
			identity.componentId === dependency.provider.componentId &&
			identity.projectOpeningId === openingId,
	);
	if (matches.length > 1) {
		throw new Error('Ambiguous component identity and project opening');
	}
	return matches[0];
}

export function validateRegistration(
	entries: ReadonlyMap<string, Entry>,
	descriptor: ComponentDescriptor,
): void {
	const all = [...entries.values()].map((entry) => entry.descriptor);
	if (all.some((other) => sameInstance(other, descriptor))) {
		throw new Error('Component identity and project opening already registered');
	}
	all.push(descriptor);
	for (const consumer of all) {
		const targets = new Set<string>();
		for (const dependency of consumer.dependencies) {
			if (
				dependency.binding === 'selected-project' &&
				all.some(
					(value) =>
						value.identity.packageId === dependency.provider.packageId &&
						value.identity.componentId === dependency.provider.componentId &&
						value.identity.projectOpeningId === null,
				)
			) {
				throw new Error('Selected-project dependency target must be project scoped');
			}
			const provider =
				dependency.binding === 'selected-project'
					? dependency.provider
					: all.find((value) => value.slotId === dependency.providerSlot)?.identity;
			if (dependency.binding !== 'selected-project' && provider) {
				assertDirectScope(
					consumer,
					all.find((value) => value.slotId === dependency.providerSlot)!,
				);
			}
			if (provider) {
				const key = JSON.stringify([
					dependency.binding ?? 'instance',
					provider.packageId,
					provider.componentId,
				]);
				if (targets.has(key)) {
					throw new Error('Duplicate dependency target identity and binding');
				}
				targets.add(key);
			}
		}
	}
}
