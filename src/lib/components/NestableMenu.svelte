<script lang="ts" module>
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

	let { menu }: { menu: MenuItem[] } = $props();

	let openItem = $state<string | null>(null);
	function handleClick({ content, id }: MenuItem) {
		if (typeof content === 'function') {
			content();
		} else {
			openItem = id;
		}
	}
</script>

<div class="menu">
	{#each menu as item (item.id)}
		{@render menuItem(openItem === item.id, () => handleClick(item), item)}
	{/each}
</div>

{#snippet menuItem(open: boolean, onclick: () => void, { title, content }: MenuItem)}
	<div class="item">
		<button class="title" {onclick}>
			<div style:flex="1">
				{#if typeof title === 'string'}
					<span class="title-string">{title}</span>
				{:else}
					{@render title()}
				{/if}
			</div>
			{#if typeof content !== 'function'}
				<div class="icon">
					<Icon src={CaretRight} size="16px" />
				</div>
			{/if}
		</button>
		{#if open && typeof content !== 'function'}
			<div class="submenu">
				<NestableMenu menu={content} />
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
	}

	.submenu {
		position: absolute;
		top: 0;
		left: calc(100% + 2px);
	}
</style>
