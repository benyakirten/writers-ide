<script lang="ts">
	import type { ParagraphProps } from '$lib/types/block';

	let { content, classes, updateBlockContent, index, id }: ParagraphProps = $props();

	let el: HTMLElement;
	const updateContent = (e: Event) => {
		if (e.target instanceof HTMLParagraphElement) {
			updateBlockContent(e.target.textContent ?? '');
		}
	};
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
<p
	bind:this={el}
	data-index={index}
	tabindex={0}
	class={classes.join(' ')}
	{id}
	role="textbox"
	onblur={updateContent}
	contenteditable="true"
>
	{content}
	<!-- TODO: Children -->
</p>
