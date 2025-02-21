<script lang="ts">
	import proseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import ProseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import { onMount } from 'svelte';

	let activeCodeMarks = $state<string[]>([]);

	onMount(() => {
		const sub = ProseMirrorEventBus.subscribe(({ view }) => {
			const marks = proseMirrorEventBus.getActiveMarkCodes(view);
			activeCodeMarks = marks;
		});

		return () => sub();
	});

	$inspect(activeCodeMarks);
</script>

<div class="menu">This is a menu.</div>

<style>
	.menu {
		width: 100%;
	}
</style>
