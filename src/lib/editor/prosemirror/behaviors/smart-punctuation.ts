import type { SveltePlugin } from '@writers-ide/plugins/svelte';
import { WORD_PROCESSING_PLUGIN_ID, wordProcessingApi } from '@writers-ide/word-processing';
import { ellipsis, emDash, inputRules, undoInputRule } from 'prosemirror-inputrules';

export const SMART_PUNCTUATION_PLUGIN_ID = 'writers-ide.smart-punctuation';
export const SMART_PUNCTUATION_BEHAVIOR_ID = `${SMART_PUNCTUATION_PLUGIN_ID}.typing`;
export const UNDO_INPUT_RULE_COMMAND_ID = `${SMART_PUNCTUATION_PLUGIN_ID}.undo`;

/** Opt-in upstream wrapper; requires no schema additions or UI contributions. */
export function createSmartPunctuationPlugin(): SveltePlugin {
	return {
		manifest: {
			id: SMART_PUNCTUATION_PLUGIN_ID,
			name: 'Smart punctuation',
			description: 'Upstream ellipsis and em dash input rules.',
			version: '0.1.0',
			apiVersion: 1,
			capabilities: [],
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
				throw new Error('Smart punctuation requires word processing');
			}
			api.registerBehavior({
				id: SMART_PUNCTUATION_BEHAVIOR_ID,
				name: 'Smart punctuation input rules',
				create: () => inputRules({ rules: [ellipsis, emDash] }),
			});
			api.registerCommand({
				id: UNDO_INPUT_RULE_COMMAND_ID,
				name: 'Undo input rule',
				command: undoInputRule,
			});
		},
	};
}
