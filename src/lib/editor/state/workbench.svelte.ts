import { createWorkbench } from '@writers-ide/layout';
import { IdGenerator } from '$lib/services/ids';
import * as m from '$lib/paraglide/messages';
import Registry from './bar-item-registry.svelte';
import { BarItems } from './bar-items.svelte';

/** Application compatibility instance. The reusable package never imports this module. */
export const workbench = createWorkbench({
	registry: Registry,
	generateId: () => IdGenerator.generate(),
	unknownItemTitle: () => m.unknown_menu_title(),
	newBarTitle: () => 'New Bar',
	createItems: (vertical, ids) => new BarItems(vertical, ids),
});
