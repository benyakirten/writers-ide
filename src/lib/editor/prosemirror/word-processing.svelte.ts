import type { SveltePlugin } from '@writers-ide/plugins/svelte';
import {
	createWordProcessingConnection,
	createWordProcessingService,
	WORD_PROCESSING_PLUGIN_ID,
	wordProcessingApi,
	type WordProcessingSources,
} from '@writers-ide/word-processing';
import Editors from './prose-mirror-editor.svelte';
import TabState from '../state/tab-state.svelte';
import eventBus, { ProseMirrorEventBusEventType } from '../state/event-bus.svelte';

/** Application composition only; plugin consumers use the public provider contract. */
export const defaultWordProcessingSources: WordProcessingSources = {
	listViews: () => Object.values(Editors.editors),
	activeViewId: () => {
		const documentId = TabState.active;
		return documentId ? Editors.get(documentId)?.viewId : null;
	},
	subscribe: (listener) =>
		eventBus.subscribe(({ event }) => {
			if (
				event.type === ProseMirrorEventBusEventType.Init ||
				event.type === ProseMirrorEventBusEventType.Update ||
				event.type === ProseMirrorEventBusEventType.SetActiveTab
			) {
				listener();
			}
		}),
};

/** Owns API resources, not the existing editor views, schema, history or pagination. */
export function createWordProcessingPlugin(
	sources: WordProcessingSources = defaultWordProcessingSources,
): SveltePlugin {
	return {
		manifest: {
			id: WORD_PROCESSING_PLUGIN_ID,
			version: '0.1.0',
			apiVersion: 1,
			name: 'Word processing',
			description: 'Shared editor observations, synchronous editing and command APIs.',
			capabilities: [],
			provides: [wordProcessingApi],
		},
		activate(context) {
			const service = createWordProcessingService(sources);
			context.own(() => service.dispose());
			context.apis.provide(wordProcessingApi, (connection) =>
				createWordProcessingConnection(service, connection),
			);
		},
	};
}
