<script lang="ts">
	import { onDestroy } from 'svelte';
	import { createApplicationPluginHost } from '$lib/plugins/application-plugin-host';
	import Editor from '$lib/editor/Editor.svelte';
	import { formattingPlugin } from '$lib/editor/prosemirror/menu/basic/menu';
	import Shortcuts from '$lib/services/shortcuts.svelte';
	import TabRegistry from '$lib/editor/state/tab-state-registry.svelte';
	import ProseMirrorView from '$lib/editor/prosemirror/view/ProseMirrorView.svelte';
	import tabState from '$lib/editor/state/tab-state.svelte';
	import { builtInShortcuts } from './shortcuts';

	Shortcuts.add(builtInShortcuts);
	const pluginHost = createApplicationPluginHost();
	pluginHost.register(formattingPlugin);
	const formatting = pluginHost.activate(formattingPlugin.manifest.id);
	if (formatting.status === 'failed') {
		console.error('Formatting plugin activation failed', formatting.errors);
	}
	onDestroy(() => pluginHost.deactivate(formattingPlugin.manifest.id));
	TabRegistry.register(
		{
			component: ProseMirrorView,
		},
		'prosemirror',
	);
	tabState.create('prosemirror');
</script>

<Editor />
