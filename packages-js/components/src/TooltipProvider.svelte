<script lang="ts">
	import { onDestroy, untrack, type Snippet } from 'svelte';
	import { TooltipState } from './tooltip-state.svelte';
	import { provideTooltipManager } from './tooltip-context';
	import Pointer from './Pointer.svelte';

	let {
		manager,
		children,
		renderPointer = true,
		zIndex = 10000,
	}: {
		manager?: TooltipState;
		children: Snippet;
		renderPointer?: boolean;
		zIndex?: number;
	} = $props();

	// Context identity is fixed for this provider's lifetime, not replaced reactively.
	const id = $props.id();
	const suppliedManager = untrack(() => manager);
	const service = provideTooltipManager(suppliedManager ?? new TooltipState(id));
	onDestroy(() => {
		if (!suppliedManager) {
			service.clear();
		}
	});
</script>

{@render children()}
{#if renderPointer}
	<Pointer manager={service} {zIndex} />
{/if}
