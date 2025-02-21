<script lang="ts">
	import proseMirrorEventBus, { type MarkAnalysis } from '$lib/editor/state/event-bus.svelte.js';
	import ProseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import { onMount } from 'svelte';

	let activeCodeMarks = $state<MarkAnalysis>();

	onMount(() => {
		const sub = ProseMirrorEventBus.subscribe(({ view }) => {
			const marks = proseMirrorEventBus.analyzeTextMarks(view);
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
