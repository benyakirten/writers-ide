<script lang="ts">
	import type { TextProps } from '$lib/types/block.js';

	// @ts-expect-error: TODO
	let { content, classes, type }: TextProps = $props();

	function updateContents(e: unknown) {
		console.log(e);
	}
</script>

<svelte:element
	this={type}
	class={classes.join(' ')}
	oninput={updateContents}
	contenteditable="true"
>
	{content}
</svelte:element>
