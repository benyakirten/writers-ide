import { defineSveltePresentation, type SveltePlugin } from '@writers-ide/plugins/svelte';
import { WORD_PROCESSING_PLUGIN_ID, wordProcessingApi } from '@writers-ide/word-processing';
import { FormattingService } from './formatting-service.svelte';
import { scopeFormattingService } from './scope-formatting-service';
import BasicMenuHorizontal from './BasicMenuHorizontal.svelte';
import BasicMenuVertical from './BasicMenuVertical.svelte';

export function createFormattingPlugin(): SveltePlugin {
	return {
		manifest: {
			id: 'writers-ide.formatting',
			version: '0.1.0',
			apiVersion: 1,
			name: 'Basic Menu',
			description: 'Basic text and block formatting toolbar.',
			capabilities: ['contributions.toolbar'],
			dependencies: [
				{
					provider: WORD_PROCESSING_PLUGIN_ID,
					api: wordProcessingApi.id,
					major: wordProcessingApi.major,
				},
			],
		},
		activate(context) {
			const api = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi);
			if (!api) {
				throw new Error('Required word-processing API unavailable');
			}
			const props = { formatting: scopeFormattingService(new FormattingService(api), context) };
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
