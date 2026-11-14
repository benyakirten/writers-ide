<script lang="ts">
	import { TooltipProvider } from '@writers-ide/components';
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import PluginPresentation from '$lib/plugins/PluginPresentation.svelte';

	let { presentation }: { presentation: SveltePresentation } = $props();
</script>

<TooltipProvider>
	<PluginPresentation {presentation} />
</TooltipProvider>
