<script lang="ts">
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';

	let { presentation }: { presentation: SveltePresentation } = $props();
	const Component = $derived(presentation.component);
	const identity = $derived({ presentation, props: presentation.props });
</script>

{#key identity}
	<svelte:boundary>
		<Component {...presentation.props} />
		{#snippet failed()}
			<p role="alert">
				This plugin’s interface could not be displayed. Open Plugins to disable and re-enable the
				plugin.
			</p>
		{/snippet}
	</svelte:boundary>
{/key}
