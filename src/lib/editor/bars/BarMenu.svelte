<script lang="ts">
	import IconButton from '$lib/components/IconButton.svelte';
	import { X, Minus, DotsSix, DotsSixVertical } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	let {
		onMinimize,
		onClose,
		isVertical,
		isDragging,
		index
	}: {
		onMinimize: () => void;
		isDragging: boolean;
		isVertical: boolean;
		onClose: () => void;
		index: number;
	} = $props();
</script>

<div class="menu">
	<div style:cursor={isDragging ? 'grab' : 'grabbing'} class="drag-icon">
		{#if isVertical}
			<Icon src={DotsSix} size="18px" />
		{:else}
			<Icon src={DotsSixVertical} size="20px" />
		{/if}
	</div>
	<IconButton onclick={onMinimize} label="Minimize bar #{index}">
		{#snippet icon()}
			<Icon src={Minus} size="16px" />
		{/snippet}
	</IconButton>
	<IconButton onclick={onClose} label="Close bar #{index}">
		{#snippet icon()}
			<Icon src={X} size="16px" />
		{/snippet}
	</IconButton>
</div>

<style>
	.menu {
		display: flex;
		justify-content: flex-end;
	}
</style>
