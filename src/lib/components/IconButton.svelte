<script lang="ts">
	import { type Snippet } from 'svelte';

	let buttonEl: HTMLElement;

	let {
		icon,
		label,
		onclick,
		inversion = 0,
		disabled = false
	}: {
		icon: Snippet;
		label: string;
		onclick: () => void;
		disabled?: boolean;
		inversion?: number;
	} = $props();
</script>

<button
	style:--inversion={`${Math.floor(inversion * 100)}%`}
	aria-label={label}
	onclickcapture={onclick}
	bind:this={buttonEl}
	{disabled}
>
	{@render icon()}
</button>

<style>
	button {
		position: relative;
		cursor: pointer;

		&:disabled {
			cursor: not-allowed;
			opacity: 0.5;
		}

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
