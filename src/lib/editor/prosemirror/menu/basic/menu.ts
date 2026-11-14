import type { SveltePlugin } from '@writers-ide/plugins/svelte';
import BasicMenuHorizontal from './BasicMenuHorizontal.svelte';
import BasicMenuVertical from './BasicMenuVertical.svelte';

export const formattingPlugin: SveltePlugin = {
	manifest: {
		id: 'writers-ide.formatting',
		version: '0.1.0',
		apiVersion: 1,
		name: 'Basic Menu',
		description: 'Basic text and block formatting toolbar.',
		capabilities: ['formatting.observe', 'formatting.execute', 'contributions.toolbar'],
	},
	activate(context) {
		context.contributions.toolbar({
			id: 'basic-menu',
			name: 'Basic Menu',
			horizontal: {
				presentation: { component: BasicMenuHorizontal, context },
				size: 2,
			},
			vertical: {
				presentation: { component: BasicMenuVertical, context },
				size: 1,
			},
		});
	},
};
