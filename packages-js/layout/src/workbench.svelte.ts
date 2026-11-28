import { BarItemRegistry, type BarItemSection } from './bar-item-registry.svelte';
import { BarItems } from './bar-items.svelte';
import { BarTransferHandler } from './bar-transfer-handler.svelte';
import { HorizontalBarState } from './horizontal-bar-state.svelte';
import { VerticalBarState } from './vertical-bar-state.svelte';
import { FloaterBarState } from './floater-state.svelte';
import type { LayoutServices } from './services';

export type WorkbenchOptions<S extends BarItemSection> = {
	generateId: () => string;
	unknownItemTitle: () => string;
	newBarTitle: () => string;
	registry?: BarItemRegistry<S>;
	createItems?: LayoutServices<S>['createItems'];
};

/** Each call owns independent collections, transfer state, and (by default) registry metadata. */
export function createWorkbench<S extends BarItemSection = BarItemSection>(
	options: WorkbenchOptions<S>,
) {
	const registry = options.registry ?? new BarItemRegistry<S>(options.generateId);
	const services: LayoutServices<S> = {
		generateId: options.generateId,
		newBarTitle: options.newBarTitle,
		createItems:
			options.createItems ??
			((vertical, ids) => new BarItems(registry, options.unknownItemTitle, vertical, ids)),
	};
	const horizontal = new HorizontalBarState(services);
	const vertical = new VerticalBarState(services);
	const floating = new FloaterBarState(services);
	const transferServices = {
		registry,
		horizontal,
		vertical,
		floating,
		newBarTitle: options.newBarTitle,
	};
	const transfer = new BarTransferHandler(transferServices);
	return { registry, horizontal, vertical, floating, transfer, services, transferServices };
}
