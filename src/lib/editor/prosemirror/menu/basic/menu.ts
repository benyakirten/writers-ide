import { defineSveltePresentation, type SveltePlugin } from '@writers-ide/plugins/svelte';
import type { FormattingService } from './contracts';
import { scopeFormattingService } from './scope-formatting-service';
import BasicMenuHorizontal from './BasicMenuHorizontal.svelte';
import BasicMenuVertical from './BasicMenuVertical.svelte';

export function createFormattingPlugin(formatting: FormattingService): SveltePlugin {
	return {
		manifest: {
			id: 'writers-ide.formatting',
			version: '0.1.0',
			apiVersion: 1,
			name: 'Basic Menu',
			description: 'Basic text and block formatting toolbar.',
			capabilities: ['contributions.toolbar'],
		},
		activate(context) {
			const props = { formatting: scopeFormattingService(formatting, context) };
			context.contributions.toolbar({
				id: 'basic-menu',
				name: 'Basic Menu',
				horizontal: {
					presentation: defineSveltePresentation(BasicMenuHorizontal, props),
					size: 2,
				},
				vertical: {
					presentation: defineSveltePresentation(BasicMenuVertical, props),
					size: 1,
				},
			});
		},
	};
}
