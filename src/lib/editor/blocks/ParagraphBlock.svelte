<script lang="ts">
	import type { ParagraphProps } from '$lib/types/block.js';
	import { onMount } from 'svelte';

	let { content, classes, type, updateBlockContent, addBlock, id }: ParagraphProps = $props();

	let el: HTMLElement;
	const updateContent = (e: Event) => {
		if (e.target instanceof HTMLParagraphElement) {
			updateBlockContent(e.target.textContent ?? '');
		}
	};

	const handleKeydown = (e: KeyboardEvent) => {
		switch (e.key) {
			case 'Enter':
				e.preventDefault();
				const selection = window.getSelection();
				let newContent = '';

				if (selection) {
					const position = selection.getRangeAt(0).startOffset;
					// Text node should be this element
					// Try to split it into two parts - before and after the cursor
					// If there's any text, we delete the after, otherwise we
					// move the contents to the new line.
					const text = selection.anchorNode?.textContent ?? '';
					const before = text.slice(0, position);
					const after = text.slice(position);

					if (selection.toString().length === 0) {
						newContent = after;
					}

					updateBlockContent(before);
					// TODO: Figure out how to clean this up
					el.textContent = before;
				}

				addBlock(newContent);
				break;
			case 'ArrowDown':
				e.preventDefault();
				const nextBlock = el.nextElementSibling;
				// @ts-ignore
				nextBlock?.focus?.();
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (!(e.target instanceof HTMLElement)) {
					break;
				}
				const prevBlock = el.previousElementSibling;
				// @ts-ignore
				prevBlock?.focus?.();
				break;
		}
	};

	onMount(() => {
		el = document.getElementById(id)!;
	});
</script>

<svelte:element
	this={type}
	tabindex={0}
	class={classes.join(' ')}
	{id}
	role="textbox"
	onkeydown={handleKeydown}
	onblur={updateContent}
	contenteditable="true"
>
	{content}
	<!-- TODO: Children -->
</svelte:element>
