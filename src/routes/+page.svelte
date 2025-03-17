<script lang="ts">
	import Editor from '$lib/editor/Editor.svelte';
	import { MenuItem } from '$lib/editor/prosemirror/menu/basic/menu.js';
	import Registry from '$lib/editor/state/bar-item-registry.svelte';
	Registry.register(MenuItem.item, MenuItem.id);
</script>

<Editor />
