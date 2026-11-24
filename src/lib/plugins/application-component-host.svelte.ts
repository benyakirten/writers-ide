import type { ProjectReference } from '@writers-ide/plugins';
import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import {
	CommandComponentHost,
	type PresentationRecord,
} from '../../../packages-js/plugins/command-component-host';
import Registry, { type BarItemRegistry } from '$lib/editor/state/bar-item-registry.svelte';
import TabRegistry, { type TabStateRegistry } from '$lib/editor/state/tab-state-registry.svelte';
import { workQueue } from '$lib/editor/state/work-queue.svelte';
import { createApplicationLocale } from './application-locale.svelte';

type Record = PresentationRecord<SveltePresentation>;
export type ApplicationComponentHostOptions = Omit<
	ConstructorParameters<typeof CommandComponentHost<SveltePresentation>>[0],
	'locale'
> & {
	bars?: BarItemRegistry;
	views?: TabStateRegistry;
};
export type ApplicationComponentHostError = {
	readonly placementId: string;
	readonly runtimeId: string;
	readonly kind: Record['kind'];
	readonly error: unknown;
};

/** Application registry namespace; never use activation/runtime IDs for workspace records. */
export function applicationComponentPlacementId(placementId: string): string {
	return `component:${placementId}`;
}

// Disabled placements must not retain presentation props or activation contexts.
type Placement = {
	kind: Record['kind'];
	projectId: string | null;
	runtimeId: string;
	owner: symbol;
	registration?: object;
};

class WorkspacePresentations {
	readonly #placements = new Map<string, Placement>();
	#selected: ProjectReference | null = null;
	errors = $state.raw<readonly ApplicationComponentHostError[]>(Object.freeze([]));

	constructor(
		readonly bars: BarItemRegistry,
		readonly views: TabStateRegistry,
	) {}

	#registry(kind: Record['kind']) {
		return kind === 'toolbar' ? this.bars : this.views;
	}

	#remove(id: string, placement: Placement): void {
		const registry = this.#registry(placement.kind);
		if (placement.registration && registry.items[id] === placement.registration) {
			// Retain costs and project ownership after disabling or closing a project.
			registry.deregister(id, true);
		}
		placement.registration = undefined;
	}

	#visibility(id: string, placement: Placement): void {
		const registry = this.#registry(placement.kind);
		const current = registry.items[id];
		if (current && current !== placement.registration) {
			registry.releaseVisibility(id, placement.owner);
			return;
		}
		const visible = placement.projectId === null || placement.projectId === this.#selected?.id;
		registry.setVisibility(id, placement.owner, visible);
	}

	select(project: ProjectReference | null): void {
		this.#selected = project;
		for (const [id, placement] of this.#placements) {
			this.#visibility(id, placement);
		}
	}

	close(project: ProjectReference): void {
		if (this.#selected === project) {
			this.select(null);
		}
	}

	sync(records: readonly Record[]): void {
		const next = new Map<string, Record>();
		for (const record of records) {
			const id = applicationComponentPlacementId(record.placementId);
			if (!next.has(id)) {
				next.set(id, record);
			}
		}
		const errors: ApplicationComponentHostError[] = [];
		const blocked = new Set<string>();
		for (const [id, placement] of this.#placements) {
			if (next.get(id)?.id !== placement.runtimeId) {
				try {
					this.#remove(id, placement);
				} catch (error) {
					blocked.add(id);
					errors.push(
						Object.freeze({
							placementId: id,
							runtimeId: placement.runtimeId,
							kind: placement.kind,
							error,
						}),
					);
				}
			}
		}
		const seen = new Set<string>();
		for (const record of records) {
			const id = applicationComponentPlacementId(record.placementId);
			if (blocked.has(id)) {
				continue;
			}
			try {
				if (seen.has(id)) {
					throw new Error(`Duplicate component placement: ${id}`);
				}
				seen.add(id);
				const registry = this.#registry(record.kind);
				let placement = this.#placements.get(id);
				const current = registry.items[id];
				if (current && current !== placement?.registration) {
					throw new Error(`Component ${record.kind} placement already registered: ${id}`);
				}
				if (!placement) {
					placement = {
						kind: record.kind,
						projectId: record.project?.id ?? null,
						runtimeId: record.id,
						owner: Symbol(id),
					};
					this.#placements.set(id, placement);
				}
				placement.runtimeId = record.id;
				if (!current) {
					if (record.kind === 'toolbar') {
						const contribution = record.contribution;
						this.bars.register(
							{
								title: contribution.name,
								horizontal: {
									plugin: contribution.horizontal.presentation,
									size: contribution.horizontal.size,
								},
								vertical: {
									plugin: contribution.vertical.presentation,
									size: contribution.vertical.size,
								},
							},
							id,
						);
					} else {
						this.views.register({ plugin: record.contribution.presentation }, id);
					}
					placement.registration = registry.items[id];
				}
				this.#visibility(id, placement);
			} catch (error) {
				// The harness isolates subscriber exceptions. Publish failures as host-visible data instead.
				errors.push(
					Object.freeze({ placementId: id, runtimeId: record.id, kind: record.kind, error }),
				);
			}
		}
		for (const [id, placement] of this.#placements) {
			try {
				this.#visibility(id, placement);
			} catch (error) {
				errors.push(
					Object.freeze({
						placementId: id,
						runtimeId: placement.runtimeId,
						kind: placement.kind,
						error,
					}),
				);
			}
		}
		this.errors = Object.freeze(errors);
	}

	dispose(): void {
		const errors: unknown[] = [];
		for (const [id, placement] of this.#placements) {
			try {
				this.#remove(id, placement);
			} catch (error) {
				errors.push(error);
			} finally {
				this.#registry(placement.kind).releaseVisibility(id, placement.owner);
			}
		}
		this.#placements.clear();
		this.errors = Object.freeze([]);
		if (errors.length) {
			throw new AggregateError(errors, 'Component workspace cleanup failed');
		}
	}
}

/** Internal trusted-component assembly. Does not replace the bundled host or grant native access. */
export function createApplicationComponentHost(options: ApplicationComponentHostOptions = {}) {
	const { bars = Registry, views = TabRegistry, ...hostOptions } = options;
	const locale = createApplicationLocale();
	const adapter = new WorkspacePresentations(bars, views);
	let unsubscribe = () => {};
	class ApplicationHost extends CommandComponentHost<SveltePresentation> {
		override selectProject(reference: ProjectReference | null): void {
			super.selectProject(reference);
			adapter.select(reference);
		}
		override closeProject(reference: ProjectReference): void {
			super.closeProject(reference);
			adapter.close(reference);
		}
		override dispose(): void {
			// Keep the adapter subscribed through host teardown; rejected reentrant disposal changes nothing.
			super.dispose();
			unsubscribe();
			try {
				adapter.dispose();
			} finally {
				locale.dispose();
			}
		}
	}
	const host = new ApplicationHost({
		...hostOptions,
		locale,
		workQueue: options.workQueue ?? workQueue,
	});
	unsubscribe = host.subscribePresentations((records) => adapter.sync(records));
	return {
		host,
		bars,
		views,
		get errors(): readonly ApplicationComponentHostError[] {
			return adapter.errors;
		},
		dispose: () => host.dispose(),
	};
}
