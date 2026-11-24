import type { SvelteFrontendContext } from '@writers-ide/plugins/svelte';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import { selectAll } from 'prosemirror-commands';
import { double, probeApi, publishedApi } from './contracts';
import Presentation from './Presentation.svelte';
import '@writers-ide/layout/dock-colors.css';

export function activate(context: SvelteFrontendContext) {
	const probe = context.apis.get('host', probeApi);
	if (!probe) {
		throw new Error('The portable sample requires the runtime-profile host probe');
	}
	const lifecycle = probe.lifecycle();
	context.own(() => lifecycle(`portable:cleanup:${context.signal.aborted}`));
	context.apis.subscribe('host', probeApi, (api) => {
		api?.event(`portable:locale:${context.locale.snapshot().languageTag}`);
	});
	context.apis.provide(publishedApi, (connection) => ({
		inspect(view) {
			probe.event(`portable:provider:${connection.consumer.componentId}`);
			return selectAll(view.state, view.dispatch);
		},
	}));
	context.contributions.view({
		id: 'view',
		name: 'Portable SDK example',
		presentation: defineSveltePresentation(Presentation, { probe, label: 'Portable SDK' }),
	});
	probe.event('portable:activate');
	void context.commands.execute('host', 'double', double, 21).then(
		(value) => lifecycle(`portable:command:${value}`),
		(error) => lifecycle(`portable:error:${String(error)}`),
	);
}
