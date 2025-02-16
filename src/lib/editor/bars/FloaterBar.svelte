<script lang="ts">
	import type { Snippet } from 'svelte';

	import { type FloatingBar } from '../state/floater-state.svelte.js';

	let { bar, children }: { bar: FloatingBar; children: Snippet } = $props();
	$inspect(bar);
</script>

<div
	class="floater"
	style:z-index={bar.z}
	style:width={`${bar.position.width}px`}
	style:height={`${bar.position.height}px`}
	style:top={`${bar.position.top}%`}
	style:left={`${bar.position.left}%`}
>
	{@render children()}
</div>

<style>
	.floater {
		position: absolute;
		background-color: whitesmoke;
		border: 1px solid black;
	}
</style>
