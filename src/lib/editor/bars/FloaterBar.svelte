<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { Cross2, Minus } from '@steeze-ui/radix-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import FloaterState, { type FloatingBar } from '../state/floater-state.svelte.js';

	let { bar, children, index }: { bar: FloatingBar; children: Snippet; index: number } = $props();

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

	let dragging = false;
</script>

<div
	bind:this={floater}
	class="floater"
	style:z-index={bar.z}
	style:width={`${bar.position.width}px`}
	style:height={`${bar.position.height}px`}
	style:top={`${bar.position.top}px`}
	style:left={`${bar.position.left}px`}
	style:min-width={`${FloaterState.MIN_WIDTH_PX}px`}
	style:min-height={`${FloaterState.MIN_HEIGHT_PX}px`}
	style:max-width={`${FloaterState.MAX_WIDTH_PX}px`}
	style:max-height={`${FloaterState.MAX_HEIGHT_PERCENT}%`}
	onfocus={() => FloaterState.focus(index)}
>
	<div style:cursor={dragging ? 'grab' : 'grabbing'} class="menu">
		<button aria-label={`Minimize bar #${index + 1}`}>
			<Icon src={Minus} size="16px" />
		</button>
		<button aria-label={`Close bar #${index + 1}`} onclick={() => FloaterState.remove(index)}>
			<Icon src={Cross2} size="16px" />
		</button>
	</div>
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

	.menu {
		padding: 2px;
		display: flex;
		justify-content: flex-end;
	}
</style>
