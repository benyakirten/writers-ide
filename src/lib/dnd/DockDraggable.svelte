<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { DockDraggable } from '@writers-ide/layout';

	let props: ComponentProps<typeof DockDraggable> = $props();
</script>

<DockDraggable {...props} />
