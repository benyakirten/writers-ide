import type { CommandContribution } from '@writers-ide/plugins';
import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import Registry, { type BarItemRegistry } from '$lib/editor/state/bar-item-registry.svelte';
import TabRegistry, { type TabStateRegistry } from '$lib/editor/state/tab-state-registry.svelte';

import { PluginHost } from './plugin-host';
import { workQueue, type WorkQueue } from '$lib/editor/state/work-queue.svelte';

/** Host-owned command handles; these are not keyboard bindings or editor internals. */
export class PluginCommands {
	readonly #items = new Map<string, { ownerId: string; contribution: CommandContribution }>();

	register(ownerId: string, contribution: CommandContribution): () => void {
		if (this.#items.has(contribution.id)) {
			throw new Error(`Command already registered: ${contribution.id}`);
		}
		const item = { ownerId, contribution };
		this.#items.set(contribution.id, item);
		return () => {
			if (this.#items.get(contribution.id) === item) {
				this.#items.delete(contribution.id);
			}
		};
	}

	execute(id: string): boolean {
		return this.#items.get(id)?.contribution.execute() ?? false;
	}
}

export const pluginCommands = new PluginCommands();

export function createApplicationPluginHost(
	options: {
		bars?: BarItemRegistry;
		views?: TabStateRegistry;
		commands?: PluginCommands;
		workQueue?: WorkQueue;
	} = {},
): PluginHost<SveltePresentation> {
	const bars = options.bars ?? Registry;
	const views = options.views ?? TabRegistry;
	const commands = options.commands ?? pluginCommands;
	return new PluginHost<SveltePresentation>({
		workQueue: options.workQueue ?? workQueue,
		registries: {
			toolbar: {
				register(_ownerId, contribution) {
					if (Object.hasOwn(bars.items, contribution.id)) {
						throw new Error(`Bar item already registered: ${contribution.id}`);
					}
					bars.register(
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
						contribution.id,
					);
					const registration = bars.items[contribution.id];
					return () => {
						if (bars.items[contribution.id] === registration) {
							bars.deregister(contribution.id, true);
						}
					};
				},
			},
			view: {
				register(_ownerId, contribution) {
					if (Object.hasOwn(views.items, contribution.id)) {
						throw new Error(`View already registered: ${contribution.id}`);
					}
					views.register({ plugin: contribution.presentation }, contribution.id);
					const registration = views.items[contribution.id];
					return () => {
						if (views.items[contribution.id] === registration) {
							views.deregister(contribution.id);
						}
					};
				},
			},
			command: commands,
		},
	});
}
