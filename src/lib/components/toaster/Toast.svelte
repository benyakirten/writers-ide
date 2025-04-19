<script lang="ts">
	import { fade } from 'svelte/transition';
	import { Icon } from '@steeze-ui/svelte-icon';
	import { Pause, Play, X } from '@steeze-ui/phosphor-icons';

	import IconButton from '$lib/components/IconButton.svelte';
	import type { Toast } from '$lib/services/toaster.svelte';
	import ToastManager from '$lib/services/toaster.svelte';

	let {
		toast
	}: {
		toast: Toast;
	} = $props();

	const percentage = $derived.by(() =>
		toast.timeLeft && toast.duration ? (toast.timeLeft / toast.duration) * 100 : 0
	);
</script>

<li role="status" class="toast" out:fade|global={{ duration: 200 }}>
	<div class="buttons">
		{#if percentage}
			{#if toast.interval !== null}
				<IconButton label="Pause Toast" tooltipDirection="vertical" onclick={() => toast.stop()}>
					{#snippet icon()}
						<Icon src={Pause} size="16px" />
					{/snippet}
				</IconButton>
			{:else}
				<IconButton label="Resume Toast" tooltipDirection="vertical" onclick={() => toast.start()}>
					{#snippet icon()}
						<Icon src={Play} size="16px" />
					{/snippet}
				</IconButton>
			{/if}
		{/if}
		<IconButton
			label="Dismiss Toast"
			tooltipDirection="vertical"
			onclick={() => ToastManager.removeToast(toast.id)}
		>
			{#snippet icon()}
				<Icon src={X} size="16px" />
			{/snippet}
		</IconButton>
	</div>
	{#if percentage}
		<div class="time-remaining" style:--remaining={percentage + '%'}></div>
	{/if}
	{#if typeof toast.message === 'string'}
		{toast.message}
	{:else}
		{@render toast.message()}
	{/if}
</li>

<style>
	.toast {
		position: relative;

		min-width: 200px;
		width: fit-content;
		max-width: 400px;

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

	.buttons {
		margin: 2px 0 8px 8px;
		float: right;
	}
</style>
