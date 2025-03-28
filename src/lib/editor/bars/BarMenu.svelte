<script lang="ts">
	import { Icon } from '@steeze-ui/svelte-icon';
	import { X, Minus, DotsSix, DotsSixVertical, DotsThree } from '@steeze-ui/phosphor-icons';

	import IconButton from '$lib/components/IconButton.svelte';
	import NestableMenu, { type MenuItem } from '$lib/components/NestableMenu.svelte';

	let {
		onMinimize,
		onClose,
		isVertical,
		draggable,
		index
	}: {
		onMinimize: () => void;
		draggable: boolean;
		isVertical: boolean;
		onClose: () => void;
		index: number;
	} = $props();

	let menuOpen = $state(false);
	const dropdownMenu: MenuItem[] = [
		{
			id: 'move',
			title: 'Move',
			content: [
				{
					id: 'move-up',
					title: 'Move Up',
					content: () => {
						// Handle move up action
					}
				},
				{
					id: 'move-down',
					title: 'Move Down',
					content: () => {
						// Handle move up action
					}
				}
			]
		}
	];
</script>

<div class="menu">
	<div class="initial-buttons">
		<div class="dropdown">
			<IconButton onclick={() => (menuOpen = !menuOpen)} label="Show menu">
				{#snippet icon()}
					<Icon src={DotsThree} size="16px" />
				{/snippet}
			</IconButton>
			{#if menuOpen}
				<div class="dropdown-menu">
					<NestableMenu menu={dropdownMenu} />
				</div>
			{/if}
		</div>
		{#if draggable}
			<div style:cursor="grab" class="drag-icon">
				{#if isVertical}
					<Icon src={DotsSix} size="18px" />
				{:else}
					<Icon src={DotsSixVertical} size="20px" />
				{/if}
			</div>
		{/if}
	</div>
	<div class="latter-buttons">
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
</div>

<style>
	.menu {
		z-index: 10;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.initial-buttons {
		display: flex;
		align-items: center;
	}

	.latter-buttons {
		display: flex;
		justify-content: flex-end;
		align-items: center;
	}

	.drag-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		padding-inline: 4px;
	}

	.dropdown {
		position: relative;
	}

	.dropdown-menu {
		position: absolute;
		top: 100%;
		left: 0;
	}
</style>
