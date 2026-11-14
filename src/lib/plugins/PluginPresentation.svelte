<script lang="ts">
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';

	let { presentation }: { presentation: SveltePresentation } = $props();
	const Component = $derived(presentation.component);
</script>

<Component context={presentation.context} />
