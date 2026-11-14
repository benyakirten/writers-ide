<script lang="ts">
	import type { ComponentProps } from 'svelte';
	import { Tooltip } from '@writers-ide/components';
	import TooltipManager from '$lib/services/tooltip.svelte';

	let props: Omit<ComponentProps<typeof Tooltip>, 'manager'> = $props();
</script>

<Tooltip {...props} manager={TooltipManager} />
