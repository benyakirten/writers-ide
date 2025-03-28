<script lang="ts" module>
	// NOTE: This menu is incomplete and needs to have accessibiltiy implemented.
	import type { Snippet } from 'svelte';
	export type MenuItem = {
		id: string;
		title: Snippet | string;
		content: MenuItem[] | (() => void);
	};
</script>

<script lang="ts">
	import { CaretRight } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import NestableMenu from './NestableMenu.svelte';
	import { Debouncer } from '$lib/utils/debounce';
	import { SvelteSet } from 'svelte/reactivity';

	let { menu, onclose }: { menu: MenuItem[]; onclose: () => void } = $props();

	let hoveredItems = $state(new SvelteSet<string>());
	let clickedItems = $state(new SvelteSet<string>());

	const hoverDebouncer = new Debouncer<string>((id) => {
		hoveredItems.add(id);
	});

	function handleClick({ content, id }: MenuItem) {
		if (typeof content === 'function') {
			content();
			onclose();
		} else {
			if (clickedItems.has(id)) {
				clickedItems.delete(id);
			} else {
				clickedItems.add(id);
			}
		}
	}

	function handleMouseEnter(id: string) {
		hoverDebouncer.update(id);
	}

	function handleMouseExit(id: string) {
		hoverDebouncer.cancel();
		hoveredItems.delete(id);
	}
</script>

<svelte:window onkeydowncapture={(e) => e.key === 'Escape' && onclose()} />
<div class="menu">
	{#each menu as item (item.id)}
		{@render menuItem(item)}
	{/each}
</div>

{#snippet menuItem(item: MenuItem)}
	<div
		class="item"
		onmouseenter={() => handleMouseEnter(item.id)}
		onmouseleave={() => handleMouseExit(item.id)}
		role="none"
	>
		<button class="title" onclick={() => handleClick(item)}>
			<div style:flex="1">
				{#if typeof item.title === 'string'}
					<span class="title-string">{item.title}</span>
				{:else}
					{@render item.title()}
				{/if}
			</div>
			{#if typeof item.content !== 'function'}
				<div class="icon">
					<Icon src={CaretRight} size="16px" />
				</div>
			{/if}
		</button>
		{#if (clickedItems.has(item.id) || hoveredItems.has(item.id)) && typeof item.content !== 'function'}
			<div class="submenu">
				<NestableMenu menu={item.content} {onclose} />
			</div>
		{/if}
	</div>
{/snippet}

<style>
	.menu {
		display: flex;
		flex-direction: column;
		background-color: #fff;
		border-radius: 4px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
	}

	.item {
		display: flex;
		align-items: center;
	}

	.title {
		position: relative;

		display: flex;
		align-items: center;

		padding: 8px;
		cursor: pointer;
		width: 100%;
	}

	.title-string {
		font-weight: bold;
		color: #333;
	}

	.title:hover {
		background-color: #f0f0f0;
	}

	.icon {
		width: 20px;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		margin-right: -8px;
	}

	.submenu {
		position: absolute;
		top: 0;
		left: calc(100% + 2px);
	}
</style>
