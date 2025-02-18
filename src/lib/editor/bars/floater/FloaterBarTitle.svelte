<script lang="ts">
	import { CheckCircled } from '@steeze-ui/radix-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import FloaterState from '$lib/editor/state/floater-state.svelte.js';
	import { tick } from 'svelte';

	let { title, id }: { index: number; title: string; id: string } = $props();

	let isEditing = $state(false);

	let inputRef: HTMLInputElement | null = $state(null);
	let formRef: HTMLFormElement | null = $state(null);

	function handleSubmit(event: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement }) {
		event.preventDefault();
		isEditing = false;

		const formData = new FormData(event.currentTarget);
		const newTitle = formData.get('title');
		if (newTitle !== null && newTitle !== title) {
			FloaterState.rename(id, newTitle.toString());
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			isEditing = false;
		}
	}

	async function startEditing() {
		isEditing = true;
		await tick();
		inputRef?.focus();
	}

	async function stopEditing(e: FocusEvent) {
		// We want the form to revert to a P tag if the user clicks outside of the form.
		// However, clicking the submit button will cause this event to trigger.
		// We can check if the related target is the button to prevent this.
		if (!formRef?.contains(e.relatedTarget as Node)) {
			isEditing = false;
		}
	}
</script>

<div class="container">
	{#if isEditing}
		<form
			bind:this={formRef}
			onfocusout={(e) => stopEditing(e)}
			onsubmit={handleSubmit}
			onkeydowncapture={(e) => handleKeydown(e)}
		>
			<input bind:this={inputRef} type="text" value={title} name="title" />
			<button aria-label="Change Title" type="submit">
				<Icon src={CheckCircled} size="16px" />
			</button>
		</form>
	{:else}
		{@const titleNumber = FloaterState.titleNumbers.get(id) ?? 0}
		<button onclick={() => startEditing()}>
			<p>
				{title}
			</p>
			{#if titleNumber > 1}
				<span>({titleNumber})</span>
			{/if}
		</button>
	{/if}
</div>

<style>
	.container {
		flex: 1;
		padding-block: 2px;
	}

	p {
		margin: 0;
		display: inline;
	}

	form {
		position: relative;
		background-color: white;
		border: 1px solid black;

		&:focus {
			outline: 1px solid blue;
		}

		& > input {
			width: 80%;
			background: none;
			border: none;
			outline: none;
		}

		& > button {
			cursor: pointer;
			position: absolute;
			right: 2px;
			top: 50%;
			transform: translateY(-50%);
			width: fit-content;
			padding: 0;
			height: min-content;
		}
	}
	button {
		appearance: none;
		border: none;
		width: 100%;
		height: 100%;
		background: none;
		display: flex;
		justify-content: start;
	}
</style>
