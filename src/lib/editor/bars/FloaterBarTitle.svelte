<script lang="ts">
	import { tick } from 'svelte';
	import { CheckCircle, X } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import FloaterBarState from '$lib/editor/state/floater-state.svelte';

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
			FloaterBarState.update(id, 'title', newTitle.toString());
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		e.stopPropagation();
		if (e.key === 'Escape') {
			isEditing = false;
		}
	}

	async function startEditing() {
		// TODO: Don't start editing if the floater is being dragged.
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

<div>
	{#if isEditing}
		<form
			bind:this={formRef}
			onfocusout={(e) => stopEditing(e)}
			onsubmit={handleSubmit}
			onkeydowncapture={(e) => handleKeydown(e)}
		>
			<input bind:this={inputRef} type="text" value={title} name="title" />
			<button onclickcapture={() => (isEditing = false)} aria-label="Keep Title" type="button">
				<Icon src={X} size="16px" />
			</button>
			<button aria-label="Change Title" type="submit">
				<Icon src={CheckCircle} size="16px" />
			</button>
		</form>
	{:else}
		{@const titleNumber = FloaterBarState.titleNumbers.get(id) ?? 0}
		<button class="title" onclick={() => startEditing()}>
			<p>
				{title || 'Untitled'}
			</p>
			{#if titleNumber > 0}
				<span>({titleNumber})</span>
			{/if}
		</button>
	{/if}
</div>

<style>
	form {
		position: relative;
		display: flex;
		background-color: white;
		border: 1px solid black;
		border-top: none;
		border-left: none;
		height: 100%;

		&:focus {
			outline: 1px solid blue;
		}

		& > input {
			width: calc(100% - 40px);
			background: none;
			border: none;
			outline: none;
			padding-left: 4px;
		}

		& > button {
			&:nth-of-type(1) {
				right: 18px;
			}

			&:nth-of-type(2) {
				right: 2px;
			}

			cursor: pointer;
			position: absolute;
			top: 50%;
			transform: translateY(-50%);
			width: fit-content;
			padding: 0;
			height: min-content;
		}
	}

	button {
		border: none;
		width: 100%;
		height: 100%;
		background: none;
		display: flex;
		justify-content: start;
		cursor: inherit;
	}

	span {
		margin-block: auto;
		margin-inline: 2px;
	}
	p {
		margin-block: auto;
		display: inline;
	}
</style>
