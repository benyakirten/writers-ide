<script lang="ts">
	// TODO: Add state handler
	import FloaterState from '$lib/editor/state/floater-state.svelte.js';

	function addFloatingBar(e: SubmitEvent & { currentTarget: EventTarget & HTMLFormElement }) {
		e.preventDefault();
		const formData = new FormData(e.currentTarget);
		const _width = formData.get('width');
		const _height = formData.get('height');
		const _top = formData.get('top');
		const _left = formData.get('left');

		if (!_width || !_height || !_top || !_left) {
			return;
		}

		const width = parseInt(_width as string);
		const height = parseInt(_height as string);
		const top = parseInt(_top as string);
		const left = parseInt(_left as string);

		FloaterState.add({
			width,
			height,
			top,
			left
		});
	}
</script>

<div class="base-bar">
	Base Horizontal Bar
	<button onclick={() => FloaterState.add()}>Add Floating Bar</button>
	<form onsubmit={addFloatingBar}>
		<input required type="number" name="width" placeholder="Width" />
		<input required type="number" name="height" placeholder="Height" />
		<input required type="number" name="top" placeholder="Top" />
		<input required type="number" name="left" placeholder="Left" />
		<button type="submit">Add Floating Bar With Specifications</button>
	</form>
</div>

<style>
	.base-bar {
		border-right: 1px solid greenyellow;
		width: min-content;
	}
</style>
