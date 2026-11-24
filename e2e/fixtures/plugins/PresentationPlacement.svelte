<script lang="ts">
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import type { PresentationRecord } from '../../../packages-js/plugins/command-component-host';
	import PluginPresentation from '../../../src/lib/plugins/PluginPresentation.svelte';

	let {
		record,
		orientation,
	}: {
		record: PresentationRecord<SveltePresentation>;
		orientation: 'horizontal' | 'vertical';
	} = $props();
	// Visibility snapshots replace records, not their presentation descriptors.
	const presentation = $derived(
		record.kind === 'view'
			? record.contribution.presentation
			: record.contribution[orientation].presentation,
	);
</script>

<div
	data-testid={`record-${record.contribution.name}`}
	data-runtime-id={record.id}
	data-placement-id={record.placementId}
>
	<PluginPresentation {presentation} />
</div>
