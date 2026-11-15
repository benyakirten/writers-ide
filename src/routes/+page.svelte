<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { TooltipProvider } from '@writers-ide/components';
	import TooltipManager from '$lib/services/tooltip.svelte';
	import PluginManager from '$lib/plugins/PluginManager.svelte';
	import { createApplicationPluginHost } from '$lib/plugins/application-plugin-host';
	import Editor from '$lib/editor/Editor.svelte';
	import { createFormattingPlugin } from '$lib/editor/prosemirror/menu/basic/menu';
	import Formatting from '$lib/editor/prosemirror/menu/basic/formatting-service.svelte';
	import Shortcuts from '$lib/services/shortcuts.svelte';
	import TabRegistry from '$lib/editor/state/tab-state-registry.svelte';
	import ProseMirrorView from '$lib/editor/prosemirror/view/ProseMirrorView.svelte';
	import tabState from '$lib/editor/state/tab-state.svelte';
	import { builtInShortcuts } from './shortcuts';

	Shortcuts.add(builtInShortcuts);
	const pluginHost = createApplicationPluginHost();
	const formattingPlugin = createFormattingPlugin(Formatting);
	pluginHost.register(formattingPlugin);
	const formatting = pluginHost.activate(formattingPlugin.manifest.id);
	if (formatting.status === 'failed') {
		console.error('Formatting plugin activation failed', formatting.errors);
	}
	onDestroy(() => pluginHost.deactivate(formattingPlugin.manifest.id));
	TabRegistry.register(
		{
			component: ProseMirrorView,
		},
		'prosemirror',
	);
	tabState.create('prosemirror');

	let managerDialog: HTMLDialogElement;
	let managerOpen = $state(false);
	let managerLauncher: HTMLButtonElement;

	async function openPluginManager(launcher: HTMLButtonElement) {
		managerLauncher = launcher;
		managerOpen = true;
		await tick();
		managerDialog.showModal();
	}
</script>

<TooltipProvider manager={TooltipManager} renderPointer={false}>
	<Editor onplugins={openPluginManager} />
</TooltipProvider>

<dialog
	bind:this={managerDialog}
	aria-label="Plugin manager"
	onclose={() => {
		managerOpen = false;
		managerLauncher?.focus();
	}}
>
	{#if managerOpen}
		<form method="dialog">
			<button type="submit">Close plugin manager</button>
		</form>
		<PluginManager management={pluginHost} />
	{/if}
</dialog>

<style>
	dialog {
		width: min(48rem, calc(100vw - 2rem));
		max-height: calc(100vh - 2rem);
		overflow: auto;
		padding: 1.5rem;
		border: 1px solid hsl(var(--border));
		border-radius: 0.5rem;
		background: hsl(var(--background));
		color: hsl(var(--foreground));
	}

	dialog::backdrop {
		background: rgb(0 0 0 / 45%);
	}

	form {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 1rem;
	}

	form button {
		border: 1px solid currentColor;
		border-radius: 0.25rem;
		padding: 0.25rem 0.75rem;
	}
</style>
