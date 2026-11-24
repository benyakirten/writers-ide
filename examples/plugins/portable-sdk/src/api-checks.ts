import type { FrontendContext, PluginCommand } from '@writers-ide/plugins';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import { IconButton } from '@writers-ide/components';
import { DockDraggable } from '@writers-ide/layout';
import type { ComponentProps, Snippet } from 'svelte';
import Card from './Card.svelte';
import { fourRoles, probeApi, publishedApi } from './contracts';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type Roles = Assert<Equal<typeof fourRoles, PluginCommand<string, number, boolean, Date>>>;
export type Icon = Assert<Equal<ComponentProps<typeof IconButton>['icon'], Snippet>>;
export type Children = Assert<
	Equal<ComponentProps<typeof DockDraggable>['children'], Snippet<[Snippet]>>
>;

// This function is checked, not called. The fixture only declares its double command.
export function checkApi(
	context: FrontendContext<unknown>,
	icon: Snippet,
	render: Snippet<[{ id: string; count: number }]>,
) {
	const identity: string = context.identity.activationId;
	const language: string = context.locale.snapshot().languageTag;
	const signal: AbortSignal = context.signal;
	context.own(
		context.locale.subscribe((locale) => {
			const direction: 'ltr' | 'rtl' = locale.direction;
			context.apis.get('host', probeApi)?.event(direction);
		}),
	);
	context.apis.get('host', probeApi)?.event(identity + language);
	context.apis.subscribe('host', probeApi, (probe) => probe?.event('checked'));
	context.apis.provide(publishedApi, (connection) => ({
		inspect: () => !signal.aborted && !connection.signal.aborted,
	}));
	context.contributions.command({
		id: 'roles',
		name: 'Roles',
		contract: fourRoles,
		execute(args) {
			const parsed: Assert<Equal<typeof args, number>> = true;
			return parsed && args > 0;
		},
	});
	const result = context.commands.execute('provider', 'roles', fourRoles, '1');
	const resultType: Assert<Equal<typeof result, Promise<Date>>> = true;
	defineSveltePresentation(IconButton, {
		label: 'Checked',
		icon,
		onclick() {},
		tooltipDirection: 'horizontal',
	});
	defineSveltePresentation(Card<{ id: string; count: number }>, {
		value: { id: 'one', count: 1 },
		render,
	});
	return { result, resultType };
}
