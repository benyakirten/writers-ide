<script lang="ts">
	import { setContext, onDestroy, untrack } from 'svelte';
	import { TooltipProvider } from '@writers-ide/components';
	import PluginPresentation from '../../../src/lib/plugins/PluginPresentation.svelte';
	import type { CommandComponentHost } from '../../../packages-js/plugins/command-component-host';
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	let { host }: { host: CommandComponentHost<SveltePresentation> } = $props();
	setContext('fixture-context', 'same-runtime-context');
	const stableHost = untrack(() => host);
	let records = $state(stableHost.presentations());
	const release = stableHost.subscribePresentations((value) => {
		records = value;
	});
	onDestroy(release);
</script>

<TooltipProvider>
	{#each records as record (record.id)}
		{#if record.kind === 'view'}<PluginPresentation
				presentation={record.contribution.presentation}
			/>{/if}
	{/each}
</TooltipProvider>
