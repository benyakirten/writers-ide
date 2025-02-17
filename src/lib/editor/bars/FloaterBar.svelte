<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import FloaterState, { type FloatingBar } from '../state/floater-state.svelte.js';

	let { bar, children }: { bar: FloatingBar; children: Snippet } = $props();

	let floater: HTMLElement;
	let mutationObserver: MutationObserver;

	onMount(() => {
		mutationObserver = new MutationObserver(() => {
			FloaterState.updateMeasurements(bar.id, floater.offsetWidth, floater.offsetHeight);
		});
		mutationObserver.observe(floater, { attributes: true });

		return () => {
			mutationObserver.disconnect();
		};
	});
</script>

<div
	bind:this={floater}
	class="floater"
	style:z-index={bar.z}
	style:width={`${bar.position.width}px`}
	style:height={`${bar.position.height}px`}
	style:top={`${bar.position.top}%`}
	style:left={`${bar.position.left}%`}
	style:min-width={`${FloaterState.MIN_WIDTH_PX}px`}
	style:min-height={`${FloaterState.MIN_HEIGHT_PX}px`}
	style:max-width={`${FloaterState.MAX_WIDTH_PX}px`}
	style:max-height={`${FloaterState.MAX_HEIGHT_PERCENT}%`}
>
	{@render children()}
</div>

<style>
	.floater {
		position: absolute;
		background-color: whitesmoke;
		border: 1px solid black;
		overflow: auto;
		resize: both;
	}
</style>
