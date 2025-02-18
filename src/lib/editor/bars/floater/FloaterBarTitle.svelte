<script lang="ts">
	import FloaterState from '$lib/editor/state/floater-state.svelte.js';

	let { title, id }: { index: number; title: string; id: string } = $props();

	let isEditing = $state(false);

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
</script>

<div class="container">
	{#if isEditing}
		<form
			onfocusout={() => (isEditing = false)}
			onsubmit={handleSubmit}
			onkeydowncapture={(e) => handleKeydown(e)}
		>
			<input type="text" value={title} name="title" />
		</form>
	{:else}
		<button onclick={() => (isEditing = true)}>
			<p>
				{title}
			</p>
			<span>{FloaterState.titleNumbers.get(id) ?? ''}</span>
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

	input {
		width: 100%;
	}

	form {
		position: relative;
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
