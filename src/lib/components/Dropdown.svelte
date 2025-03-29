<script lang="ts" module>
	export type MenuItem = {
		id: string;
		title: string;
		content: MenuItem[] | (() => void);
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import Dropdown from './Dropdown.svelte';

	let { label, items, level = 0 }: { label: string; items: MenuItem[]; level?: number } = $props();

	let isOpen = $state(false);
	let focusedIndex = $state(-1);

	function toggle() {
		isOpen = !isOpen;
		if (isOpen) {
			focusedIndex = -1;
		}
	}

	function close() {
		isOpen = false;
		focusedIndex = -1;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen) {
			return;
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			focusedIndex = (focusedIndex + 1) % items.length;
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			focusedIndex = (focusedIndex - 1 + items.length) % items.length;
		} else if (event.key === 'Enter' && items[focusedIndex]?.action) {
			event.preventDefault();
			items[focusedIndex].action();
			close();
		} else if (event.key === 'Escape') {
			close();
		}
	}

	function handleClickOutside(event) {
		if (!menu.contains(event.target) && !button.contains(event.target)) {
			close();
		}
	}

	onMount(() => {
		document.addEventListener('click', handleClickOutside);
		return () => document.removeEventListener('click', handleClickOutside);
	});
</script>

<div class="relative inline-block" bind:this={menu}>
	<button
		bind:this={button}
		class="px-4 py-2 bg-blue-600 text-white rounded-md focus:outline-none"
		aria-haspopup="true"
		aria-expanded={isOpen}
		on:click={toggle}
		on:keydown={handleKeydown}
	>
		{label}
	</button>

	{#if isOpen}
		<ul
			class="absolute left-0 mt-2 w-48 bg-white shadow-lg rounded-md overflow-hidden border border-gray-200"
			role="menu"
		>
			{#each items as item, index}
				<li
					role="menuitem"
					tabindex="0"
					class="px-4 py-2 cursor-pointer hover:bg-gray-100 focus:bg-gray-100"
					class:selected={index === focusedIndex}
					on:click={() => {
						if (item.action) item.action();
						close();
					}}
					on:mouseenter={() => (focusedIndex = index)}
				>
					{item.label}
					{#if item.children}
						<Dropdown label="→" items={item.children} level={level + 1} />
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.relative {
		position: relative;
	}
	.absolute {
		position: absolute;
	}
	.selected {
		background-color: lightgray;
	}
</style>
