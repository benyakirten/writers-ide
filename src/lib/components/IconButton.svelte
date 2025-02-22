<script lang="ts">
	import { createPopper } from '@popperjs/core';
	import { Icon, type IconSource } from '@steeze-ui/svelte-icon';
	import { onMount, type Snippet } from 'svelte';

	// svelte-ignore non_reactive_update
	let tooltipEl: HTMLElement | null = null;
	let buttonEl: HTMLElement;

	let {
		icon,
		label,
		onClick,
		id = crypto.randomUUID(),
		tooltip,
		inversion = 'none'
	}: {
		icon: IconSource;
		label: string;
		onClick: () => void;
		id?: string;
		tooltip?: Snippet;
		inversion?: 'full' | 'partial' | 'none';
	} = $props();

	onMount(() => {
		if (!tooltip || !tooltipEl) {
			return;
		}
		const popper = createPopper(buttonEl, tooltipEl);
		return () => popper.destroy();
	});

	let inversionAmount = $derived.by(() => {
		switch (inversion) {
			case 'full':
				return '100%';
			case 'partial':
				return '75%';
			default:
				return '0%';
		}
	});
</script>

<button
	style:--inversion={inversionAmount}
	aria-label={label}
	onclick={onClick}
	bind:this={buttonEl}
>
	<Icon src={icon} title={label} size="16px" />
</button>

{#if tooltip}
	<div bind:this={tooltipEl} {id} role="tooltip">
		{@render tooltip()}
		<div data-role="popper-arrow" data-popper-arrow></div>
	</div>
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

	div[role='tooltip'][data-popper-placement^='top'] > div[data-role='arrow'] {
		bottom: -4px;
	}

	div[role='tooltip'][data-popper-placement^='bottom'] > div[data-role='arrow'] {
		top: -4px;
	}

	div[role='tooltip'][data-popper-placement^='left'] > div[data-role='arrow'] {
		right: -4px;
	}

	div[role='tooltip'][data-popper-placement^='right'] > div[data-role='arrow'] {
		left: -4px;
	}

	div[data-role='popper-arrow'],
	div[data-role='popper-arrow']::before {
		position: absolute;
		width: 8px;
		height: 8px;
		background: inherit;
	}

	div[data-role='popper-arrow'] {
		visibility: hidden;

		&::before {
			visibility: visible;
			content: '';
			transform: rotate(45deg);
		}
	}
</style>
