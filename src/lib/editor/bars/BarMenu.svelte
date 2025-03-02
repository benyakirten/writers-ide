<script lang="ts">
	import IconButton from '$lib/components/IconButton.svelte';
	import { X, Minus } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	let {
		onMinimize,
		onClose,
		index
	}: { onMinimize: () => void; onClose: () => void; index: number } = $props();
</script>

<div class="menu">
	<IconButton onClick={() => onMinimize()} label="Minimize bar #{index}">
		{#snippet icon()}
			<Icon src={Minus} size="16px" />
		{/snippet}
	</IconButton>
	<IconButton onClick={() => onClose()} label="Close bar #{index}">
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
