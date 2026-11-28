import { definePluginApi } from '@writers-ide/plugins';
import type { WordProcessingApi } from './src/contracts';

export * from './src/contracts';
export { createWordProcessingService, createWordProcessingConnection } from './src/service.svelte';

export const WORD_PROCESSING_PLUGIN_ID = 'writers-ide.word-processing';
export const wordProcessingApi = definePluginApi<WordProcessingApi>({
	id: 'writers-ide.word-processing',
	major: 1,
});
