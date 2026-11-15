<script lang="ts">
	import type { SveltePluginContext } from '@writers-ide/plugins/svelte';
	import { failures, type PresentationEvents } from './plugin-presentation-failures';
	let { context, events }: { context: SveltePluginContext; events: PresentationEvents } = $props();

	function initialize() {
		if (failures.get(context.signal) === 'init') {
			throw new Error('Private plugin initialization details');
		}
	}
	initialize();

	$effect(() => context.own(events.subscribe()));
	$effect(() => {
		if (failures.get(context.signal) === 'effect') {
			throw new Error('Private plugin effect details');
		}
	});
</script>

<p>Plugin interface ready</p>
