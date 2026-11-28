<script lang="ts">
	import type { PluginManagementService } from '@writers-ide/plugins';
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import PluginManager from '$lib/plugins/PluginManager.svelte';
	import PluginPresentation from '$lib/plugins/PluginPresentation.svelte';

	let {
		presentation,
		management,
	}: {
		presentation: SveltePresentation | null;
		management: PluginManagementService;
	} = $props();
	let clicks = $state(0);
</script>

<button onclick={() => clicks++}>Host action: {clicks}</button>
<PluginManager {management} />
{#if presentation}
	<PluginPresentation {presentation} />
{/if}
