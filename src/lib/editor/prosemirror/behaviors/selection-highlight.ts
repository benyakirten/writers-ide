import type { SveltePlugin } from '@writers-ide/plugins/svelte';
import { WORD_PROCESSING_PLUGIN_ID, wordProcessingApi } from '@writers-ide/word-processing';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

export type ModelRange = { from: number; to: number };
export const SELECTION_HIGHLIGHT_PLUGIN_ID = 'writers-ide.selection-highlight';
export const HIGHLIGHT_SELECTION_COMMAND_ID = `${SELECTION_HIGHLIGHT_PLUGIN_ID}.highlight`;
export const selectionHighlightKey = new PluginKey<DecorationSet>('selection-highlight');

/** State is view-local; transactions map only existing decorations, never scan text. */
export function rangeDecorations(
	key: PluginKey<DecorationSet>,
	className: string,
): Plugin<DecorationSet> {
	return new Plugin<DecorationSet>({
		key,
		state: {
			init: () => DecorationSet.empty,
			apply(transaction, previous) {
				const ranges = transaction.getMeta(key) as readonly ModelRange[] | undefined;
				if (ranges !== undefined) {
					return DecorationSet.create(
						transaction.doc,
						ranges.map(({ from, to }) => Decoration.inline(from, to, { class: className })),
					);
				}
				return previous.map(transaction.mapping, transaction.doc);
			},
		},
		props: { decorations: (state) => key.getState(state) ?? null },
	});
}

export function createSelectionHighlightPlugin(): SveltePlugin {
	return {
		manifest: {
			id: SELECTION_HIGHLIGHT_PLUGIN_ID,
			name: 'Selection highlight',
			description: 'Map a selected range as view-local decoration state.',
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
				throw new Error('Selection highlight requires word processing');
			}
			api.registerBehavior({
				id: `${SELECTION_HIGHLIGHT_PLUGIN_ID}.ranges`,
				name: 'Selected range decorations',
				create: () => rangeDecorations(selectionHighlightKey, 'selection-highlight'),
			});
			api.registerCommand({
				id: HIGHLIGHT_SELECTION_COMMAND_ID,
				name: 'Highlight selected range',
				command(state, dispatch) {
					const { from, to, empty } = state.selection;
					if (empty || !selectionHighlightKey.getState(state)) {
						return false;
					}
					dispatch?.(state.tr.setMeta(selectionHighlightKey, [{ from, to }]));
					return true;
				},
			});
		},
	};
}
