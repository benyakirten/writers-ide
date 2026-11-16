<script lang="ts">
	import type { SvelteNodeViewProps } from '@writers-ide/word-processing/svelte';
	let {
		node,
		decorations,
		selected,
		contentDOM,
		getPos,
		editable,
		onDestroy,
		onControl,
		fail = false,
		readLabel,
	}: SvelteNodeViewProps & {
		editable: boolean;
		onDestroy: () => void;
		onControl: (position: number | undefined) => void;
		fail?: boolean;
		readLabel?: () => string;
	} = $props();
	$effect(() => onDestroy);
	function label() {
		if (fail || node.attrs.title === 'throw') {
			throw new Error('Node adapter fixture render failed');
		}
		return readLabel?.() ?? node.attrs.title ?? node.type.name;
	}
</script>

<div
	data-node-ui
	data-selected={selected}
	data-decorations={decorations.length}
	contenteditable="false"
>
	<span>{label()}</span>
	<button onclick={() => onControl(getPos())}>Control</button>
	<input aria-label="Node control" />
</div>
{#if editable}
	<div data-content-host use:contentDOM></div>
{/if}
