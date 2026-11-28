<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { IconButton } from '@writers-ide/components';
	import TooltipManager from '$lib/services/tooltip.svelte';

	let props: Omit<ComponentProps<typeof IconButton>, 'manager'> = $props();
</script>

<IconButton {...props} manager={TooltipManager} />
