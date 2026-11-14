<script lang="ts">
	import type { FormattingCommand, FormattingSnapshot } from '@writers-ide/plugins';
	import type { SveltePluginContext } from '@writers-ide/plugins/svelte';
	import * as m from '$lib/paraglide/messages';
	import { blockMarkButtons, textMarkButtons } from './Snippets.svelte';

	let { context }: { context: SveltePluginContext } = $props();
	let snapshot = $state<FormattingSnapshot | null>(null);

	$effect(() => {
		snapshot = null;
		return context.formatting.subscribe((value) => {
			snapshot = value;
		});
	});

	function execute(command: FormattingCommand) {
		if (!snapshot?.enabled[command]) {
			return;
		}

		context.formatting.execute({ viewId: snapshot.viewId, revision: snapshot.revision, command });
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
