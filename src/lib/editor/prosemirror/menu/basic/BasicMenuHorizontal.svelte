<script lang="ts">
	import type { FormattingCommand, FormattingSnapshot, FormattingService } from './contracts';
	import * as m from '$lib/paraglide/messages';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';

	let { formatting }: { formatting: FormattingService } = $props();
	let snapshot = $state<FormattingSnapshot | null>(null);

	$effect(() => {
		snapshot = null;
		return formatting.subscribe((value) => {
			snapshot = value;
		});
	});

	function execute(command: FormattingCommand) {
		if (!snapshot?.enabled[command]) {
			return;
		}

		formatting.execute({ viewId: snapshot.viewId, revision: snapshot.revision, command });
	}
</script>

<div class="menu">
	<div class="grouping">
		{@render textMarkButtons(snapshot, m, execute, 'horizontal')}
	</div>
	<div class="grouping">
		{@render blockMarkButtons(snapshot, m, execute, 'horizontal')}
	</div>
</div>

<style>
	.menu {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px;
	}

	.grouping {
		display: flex;
		align-items: center;
		gap: 2px;
	}
</style>
