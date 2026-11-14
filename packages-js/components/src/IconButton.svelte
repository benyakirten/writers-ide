<script lang="ts">
	import { type Snippet } from 'svelte';

	import type { TooltipData, TooltipState } from './tooltip-state.svelte';
	import Tooltip from './Tooltip.svelte';

	let buttonEl = $state<HTMLButtonElement>();

	let {
		icon,
		label,
		onclick,
		inversion = 0,
		disabled = false,
		tooltip,
		tooltipDirection,
		manager,
	}: {
		manager?: TooltipState;
		icon: Snippet;
		label: string;
		onclick: () => void;
		disabled?: boolean;
		inversion?: number;
		tooltip?: Snippet | string;
		tooltipDirection: TooltipData['calibrateFor'];
	} = $props();
</script>

<Tooltip {manager} target={buttonEl} tooltip={tooltip || label} calibrateFor={tooltipDirection}>
	<button
		type="button"
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
		box-sizing: border-box;
		padding: 0;
		margin: 0;
		border: 0 solid;
		background: transparent;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;

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
