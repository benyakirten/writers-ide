<script>
	import { createEventDispatcher } from 'svelte';
	import { writable } from 'svelte/store';
	export let name = 'legacy';
	const dispatch = createEventDispatcher();
	const store = writable(1);
	// eslint-disable-next-line no-undef -- Svelte creates the reactive binding and store subscription.
	$: greeting = `${name} ${$store}`;
</script>

<button on:click={() => dispatch('selected', greeting)}>{greeting}</button>
