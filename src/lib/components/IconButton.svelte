<script lang="ts">
	import { type Snippet } from 'svelte';

	let buttonEl: HTMLElement;

	let {
		icon,
		label,
		onClick,
		tooltip,
		inversion = 0
	}: {
		icon: Snippet;
		label: string;
		onClick: () => void;
		tooltip?: Snippet;
		inversion?: number;
	} = $props();
</script>

<button
	style:--inversion={`${Math.floor(inversion * 100)}%`}
	aria-label={label}
	onclick={onClick}
	bind:this={buttonEl}
>
	{@render icon()}
</button>

{#if tooltip}
	<!-- Add tooltip queue -->
{/if}

<style>
	button {
		appearance: none;
		position: relative;

		&::before {
			content: '';
			position: absolute;
			top: 0;
			left: 0;
			width: 100%;
			height: 100%;
			backdrop-filter: invert(100%);
			transform: scaleX(var(--inversion, 0));
			transform-origin: left;
			transition: transform 0.2s ease-in;
		}
	}
</style>
