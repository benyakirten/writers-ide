import type { SveltePlugin } from '@writers-ide/plugins/svelte';
import { WORD_PROCESSING_PLUGIN_ID, wordProcessingApi } from '@writers-ide/word-processing';
import { PluginKey } from 'prosemirror-state';
import type { DecorationSet } from 'prosemirror-view';
import { rangeDecorations, type ModelRange } from './selection-highlight';

export const WORD_ANALYSIS_PLUGIN_ID = 'writers-ide.word-analysis';
export const ANALYZE_SELECTION_COMMAND_ID = `${WORD_ANALYSIS_PLUGIN_ID}.selection`;
export const wordAnalysisKey = new PluginKey<DecorationSet>('word-analysis');
export const MAX_ANALYSIS_CODE_UNITS = 32 * 1024;
export const MAX_ANALYSIS_CHUNKS = 1024;
export type TextChunk = { from: number; text: string };
export type AnalysisInput = { chunks: TextChunk[] };
export type WordAnalysisOptions = {
	/** Optional delivery boundary for a preview/confirmation UI; retains data, never live editor objects. */
	deliver?: (apply: () => void) => void;
	onStatus?: (status: string) => void;
};

/** Explicit selected-text analysis, never a per-keystroke manuscript scan. */
export function createWordAnalysisPlugin(options: WordAnalysisOptions = {}): SveltePlugin {
	return {
		manifest: {
			id: WORD_ANALYSIS_PLUGIN_ID,
			name: 'Repeated words',
			description: 'Bounded selected-text analysis in a bundled worker.',
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
				throw new Error('Word analysis requires word processing');
			}
			const signals = new Map<string, AbortSignal>();
			api.registerBehavior({
				id: `${WORD_ANALYSIS_PLUGIN_ID}.ranges`,
				name: 'Repeated word decorations',
				create({ viewId, signal }) {
					signals.set(viewId, signal);
					signal.addEventListener(
						'abort',
						() => {
							signals.delete(viewId);
						},
						{ once: true },
					);
					return rangeDecorations(wordAnalysisKey, 'repeated-word');
				},
			});
			api.registerCommand({
				id: ANALYZE_SELECTION_COMMAND_ID,
				name: 'Analyze selected words',
				command(state, dispatch) {
					if (state.selection.empty) {
						return false;
					}
					if (!dispatch) {
						return true;
					}
					const snapshot = api.snapshot();
					const target = snapshot.views.find((candidate) => {
						const inspected = api.inspect(candidate, (current) => current.state === state);
						return inspected.ok && inspected.value;
					});
					const signal = target && signals.get(target.viewId);
					if (!target || !signal || wordAnalysisKey.getState(state) === undefined) {
						return false;
					}
					const chunks: TextChunk[] = [];
					const from = state.selection.from;
					const end = Math.min(state.selection.to, from + MAX_ANALYSIS_CODE_UNITS);
					state.doc.nodesBetween(from, end, (node, pos) => {
						if (chunks.length >= MAX_ANALYSIS_CHUNKS) {
							return false;
						}
						if (node.isText) {
							const start = Math.max(from, pos);
							const to = Math.min(end, pos + node.nodeSize);
							chunks.push({ from: start, text: node.text!.slice(start - pos, to - pos) });
						}
						return true;
					});
					options.onStatus?.('running');
					const task = context.tasks.worker<AnalysisInput, ModelRange[]>({
						key: `repeated-words:${target.viewId}`,
						label: 'Analyze selected words',
						signal,
						input: { chunks },
						createWorker: () =>
							new Worker(new URL('./word-analysis.worker.ts', import.meta.url), { type: 'module' }),
						apply(ranges) {
							const apply = () => {
								// Revoked facades throw, so check inherited lifetime before calling them.
								if (context.signal.aborted || signal.aborted) {
									options.onStatus?.('cancelled');
									return;
								}
								const result = api.applyResult(
									target,
									ranges,
									(value, { state: current }) => current.tr.setMeta(wordAnalysisKey, value),
									{ signal },
								);
								options.onStatus?.(result.ok ? `applied:${result.value}` : result.reason);
							};
							if (options.deliver) {
								options.deliver(apply);
							} else {
								apply();
							}
						},
					});
					void task.result.then((outcome) => {
						if (outcome.status !== 'completed') {
							options.onStatus?.(outcome.status);
						}
					});
					return true;
				},
			});
		},
	};
}
