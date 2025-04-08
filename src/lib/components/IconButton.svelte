<script lang="ts">
	import type { TooltipData } from '@/services/tooltip.svelte';
	import { type Snippet } from 'svelte';
	import Tooltip from './tooltip/Tooltip.svelte';

	let buttonEl: HTMLElement;

	let {
		icon,
		label,
		onclick,
		inversion = 0,
		disabled = false,
		tooltip,
		tooltipDirection
	}: {
		icon: Snippet;
		label: string;
		onclick: () => void;
		disabled?: boolean;
		inversion?: number;
		tooltip?: Snippet | string;
		tooltipDirection: TooltipData['calibrateFor'];
	} = $props();
</script>

<Tooltip tooltip={tooltip || label} calibrateFor={tooltipDirection}>
	<button
		style:--inversion={`${Math.floor(inversion * 100)}%`}
		aria-label={label}
		onclickcapture={onclick}
		bind:this={buttonEl}
		{disabled}
	>
		{@render icon()}
	</button>
</Tooltip>

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
