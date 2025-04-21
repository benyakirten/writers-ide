<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import { MenuItem } from '$lib/editor/prosemirror/menu/basic/menu';
	import Registry from '$lib/editor/state/bar-item-registry.svelte';
	import Shortcuts from '$lib/services/shortcuts.svelte';
	import TabRegistry from '@/editor/state/tab-state-registry.svelte';
	import { builtInShortcuts } from './shortcuts';
	import ProseMirrorView from '@/editor/prosemirror/view/ProseMirrorView.svelte';

	Shortcuts.add(builtInShortcuts);
	Registry.register(MenuItem.item, MenuItem.id);
	TabRegistry.register(
		{
			component: ProseMirrorView
		},
		'prosemirror'
	);
</script>

<Editor />
