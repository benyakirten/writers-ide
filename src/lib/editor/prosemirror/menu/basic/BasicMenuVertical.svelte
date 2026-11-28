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
	<div class="section">
		<div class="grouping">
			{@render textMarkButtons(snapshot, m, execute, 'vertical')}
		</div>
	</div>
	<div class="section">
		<p>Block Settings</p>
		<div class="grouping">
			{@render blockMarkButtons(snapshot, m, execute, 'vertical')}
		</div>
	</div>
</div>

<style>
	.menu {
		display: grid;
		gap: 10px;
		padding: 8px;
	}

	.grouping {
		display: flex;
		flex-wrap: wrap;
		gap: 2px;
	}

	.section {
		display: grid;
		gap: 2px;

		& p {
			font-size: 14px;
		}
	}
</style>
