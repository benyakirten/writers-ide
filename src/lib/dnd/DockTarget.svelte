<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { DockTarget } from '@writers-ide/layout';
	import TransferHandler from '$lib/editor/state/bar-transfer-handler.svelte';

	let props: Omit<ComponentProps<typeof DockTarget>, 'controller'> = $props();
</script>

<DockTarget {...props} controller={TransferHandler} />
