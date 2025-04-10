<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Icon } from '@steeze-ui/svelte-icon';
	import { X } from '@steeze-ui/phosphor-icons';
	import { fade } from 'svelte/transition';

	import IconButton from '$lib/components/IconButton.svelte';

	let {
		message,
		timeLeft,
		duration,
		ondismiss
	}: {
		message: string | Snippet;
		timeLeft: number | null;
		duration: number | null;
		ondismiss: (() => void) | null;
	} = $props();

	const percentage = $derived.by(() => (timeLeft && duration ? (timeLeft / duration) * 100 : 0));
</script>

<div class="toast" out:fade|global={{ duration: 200 }}>
	<div class="time-remaining" style:--remaining={percentage + '%'}></div>
	{#if typeof message === 'string'}
		{message}
	{:else}
		{@render message()}
	{/if}
	{#if ondismiss}
		<div class="dismiss">
			<IconButton label="Dismiss Toast" tooltipDirection="vertical" onclick={ondismiss}>
				{#snippet icon()}
					<Icon src={X} size="16px" />
				{/snippet}
			</IconButton>
		</div>
	{/if}
</div>

<style>
	.toast {
		position: relative;

		min-width: 200px;
		max-width: fit-content;

		padding: 8px 4px;
		border: 2px solid black;
		border-radius: 4px;
		background-color: white;
	}

	.time-remaining {
		position: absolute;
		top: 0;
		left: 0;
		height: 6px;
		width: 100%;
		transform-origin: left;
		transform: scaleX(var(--remaining));
		background-color: green;
	}

	.dismiss {
		margin-left: 8px;
		float: right;
	}
</style>
