import { defineSveltePresentation, type SveltePlugin } from '@writers-ide/plugins/svelte';
import { WORD_PROCESSING_PLUGIN_ID, wordProcessingApi } from '@writers-ide/word-processing';
import { toggleMark } from 'prosemirror-commands';
import QuickFormat from './QuickFormat.svelte';

export const QUICK_FORMAT_PLUGIN_ID = 'writers-ide.quick-format';
export const QUICK_FORMAT_BOLD_COMMAND_ID = `${QUICK_FORMAT_PLUGIN_ID}.bold`;

/** Opt-in proof consumer; the application decides registration and placement. */
export function createQuickFormatPlugin(): SveltePlugin {
	return {
		manifest: {
			id: QUICK_FORMAT_PLUGIN_ID,
			version: '0.1.0',
			apiVersion: 1,
			name: 'Quick format',
			description: 'A compact alternative bold control using the word-processing provider.',
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
				throw new Error('Quick format requires the word-processing provider');
			}
			context.own(
				api.registerCommand({
					id: QUICK_FORMAT_BOLD_COMMAND_ID,
					name: 'Quick format: bold',
					command(state, dispatch, view) {
						const strong = state.schema.marks.bold ?? state.schema.marks.strong;
						return strong ? toggleMark(strong)(state, dispatch, view) : false;
					},
				}),
			);
			const presentation = defineSveltePresentation(QuickFormat, {
				api,
				commandId: QUICK_FORMAT_BOLD_COMMAND_ID,
			});
			context.contributions.toolbar({
				id: 'quick-format',
				name: 'Quick format',
				horizontal: { presentation, size: 1 },
				vertical: { presentation, size: 1 },
			});
		},
	};
}
