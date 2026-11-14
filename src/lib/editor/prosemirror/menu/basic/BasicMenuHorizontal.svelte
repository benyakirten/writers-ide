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
