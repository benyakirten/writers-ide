<script lang="ts">
	import { onMount } from 'svelte';
	import type { PluginInfo } from '@writers-ide/plugins';
	import type {
		SveltePluginContext,
		SveltePresentation,
		SvelteToolbarContribution,
	} from '@writers-ide/plugins/svelte';
	import {
		WORD_PROCESSING_PLUGIN_ID,
		wordProcessingApi,
		type EditorTarget,
		type WordProcessingApi,
		type WordProcessingSources,
	} from '@writers-ide/word-processing';
	import { Schema } from 'prosemirror-model';
	import { EditorState, TextSelection } from 'prosemirror-state';
	import { EditorView } from 'prosemirror-view';
	import { history, undo } from 'prosemirror-history';
	import { createWordProcessingPlugin } from '$lib/editor/prosemirror/word-processing.svelte';
	import {
		createQuickFormatPlugin,
		QUICK_FORMAT_PLUGIN_ID,
		QUICK_FORMAT_BOLD_COMMAND_ID,
	} from '$lib/editor/prosemirror/menu/quick-format/menu';
	import PluginPresentation from '$lib/plugins/PluginPresentation.svelte';
	import { PluginHost } from '$lib/plugins/plugin-host';
	import BehaviorFixture from './BehaviorFixture.svelte';
	import RendererFixture from './RendererFixture.svelte';
	import PaginatedRendererFixture from './PaginatedRendererFixture.svelte';

	const schema = new Schema({
		nodes: {
			doc: { content: 'paragraph+' },
			paragraph: { content: 'text*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
			text: { inline: true },
		},
		marks: { strong: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] } },
	});
	let firstMount: HTMLDivElement;
	let secondMount: HTMLDivElement;
	let laterMount: HTMLDivElement;
	let behaviorProofs = $state(false);
	let rendererProofs = $state(false);
	let paginatedRendererProofs = $state(false);
	function createLaterView(): void {
		if (entries.some((entry) => entry.viewId === 'view-later')) {
			return;
		}
		const view = new EditorView(laterMount, {
			state: EditorState.create({
				schema,
				doc: schema.node('doc', null, [schema.node('paragraph', null, schema.text('later view'))]),
				plugins: [history()],
			}),
			attributes: { role: 'textbox', 'aria-label': 'Later editor' },
			dispatchTransaction(transaction) {
				view.updateState(view.state.apply(transaction));
				notify();
			},
			handleDOMEvents: {
				focus() {
					activeViewId = 'view-later';
					notify();
					return false;
				},
			},
		});
		entries = [
			...entries,
			{ viewId: 'view-later', documentId: 'later-document', name: 'Later view', view },
		];
		notify();
	}
	let entries: ReturnType<WordProcessingSources['listViews']> = [];
	let activeViewId: string | null = 'view-a';
	const listeners = new Set<() => void>();
	const sources: WordProcessingSources = {
		listViews: () => entries,
		activeViewId: () => activeViewId,
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
	function notify(): void {
		for (const listener of [...listeners]) {
			listener();
		}
	}

	let toolbar = $state.raw<SvelteToolbarContribution | null>(null);
	let orientation = $state<'horizontal' | 'vertical'>('horizontal');
	let plugins = $state.raw<readonly PluginInfo[]>([]);
	let api: WordProcessingApi;
	let context: SveltePluginContext;
	let retainedApi: WordProcessingApi | undefined;
	let retainedTarget: EditorTarget | undefined;
	let freshHandle = $state(false);
	let result = $state('idle');
	let retainedResult = $state('idle');
	let commandList = $state('');
	let workerStatus = $state('idle');
	let pending:
		| {
				api: WordProcessingApi;
				target: EditorTarget;
				from: number;
				to: number;
				controller: AbortController;
				text?: string;
		  }
		| undefined;
	let canDeliver = $state(false);

	const host = new PluginHost<SveltePresentation>({
		registries: {
			toolbar: {
				register(_owner, contribution) {
					toolbar = contribution;
					return () => {
						toolbar = null;
					};
				},
			},
			view: { register: () => () => {} },
			command: { register: () => () => {} },
		},
	});
	host.register(createQuickFormatPlugin());
	host.register(createWordProcessingPlugin(sources));
	host.register({
		manifest: {
			id: 'fixture.controls',
			name: 'Fixture controls',
			description: 'Public API browser controls',
			version: '0.1.0',
			apiVersion: 1,
			capabilities: [],
			dependencies: [
				{
					provider: WORD_PROCESSING_PLUGIN_ID,
					api: wordProcessingApi.id,
					major: wordProcessingApi.major,
				},
			],
		},
		activate(currentContext) {
			context = currentContext;
			const connection = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi);
			if (!connection) {
				throw new Error('Missing fixture provider');
			}
			api = connection;
			freshHandle = retainedApi !== undefined && retainedApi !== api;
			if (!retainedApi) {
				retainedApi = api;
				retainedTarget = api.snapshot().views[0];
				api.registerCommand({
					id: 'fixture.retained-command',
					name: 'First activation only',
					command(state, dispatch) {
						dispatch?.(state.tr.insertText('LEAK'));
						return true;
					},
				});
			}
		},
	});

	function enable(): void {
		host.activate(QUICK_FORMAT_PLUGIN_ID);
		host.activate('fixture.controls');
		refreshCommands();
	}
	function refreshCommands(): void {
		commandList = api
			.commands()
			.map(({ id, ownerId }) => `${id} (${ownerId})`)
			.join(' | ');
	}
	function currentTarget() {
		const snapshot = api.snapshot();
		return snapshot.views.find((view) => view.viewId === snapshot.activeViewId);
	}
	function selectAll(): void {
		const target = currentTarget();
		if (target) {
			api.edit(
				target,
				({ state }) =>
					state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)),
				{ focus: true },
			);
		}
	}
	function caretAtEnd(): void {
		const target = currentTarget();
		if (target) {
			api.edit(
				target,
				({ state }) =>
					state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)),
				{ focus: true },
			);
		}
	}
	function undoEdit(): void {
		const target = currentTarget();
		if (target) {
			api.runCommand(target, undo, { requireActive: true, focus: true });
		}
	}
	function activateSecond(): void {
		activeViewId = 'view-b';
		notify();
	}
	function closeFirst(): void {
		const first = entries.find((entry) => entry.viewId === 'view-a');
		entries = entries.filter((entry) => entry.viewId !== 'view-a');
		if (activeViewId === 'view-a') {
			activeViewId = 'view-b';
		}
		first?.view.destroy();
		notify();
	}

	async function computeResult(): Promise<void> {
		const target = currentTarget();
		if (!target) {
			return;
		}
		const captured = api.inspect(target, ({ state }) => ({
			from: state.selection.from,
			to: state.selection.to,
			text: state.doc.textBetween(state.selection.from, state.selection.to),
		}));
		if (!captured.ok) {
			result = captured.reason;
			return;
		}
		pending?.controller.abort();
		const request = {
			api,
			target,
			from: captured.value.from,
			to: captured.value.to,
			controller: new AbortController(),
			text: undefined as string | undefined,
		};
		pending = request;
		canDeliver = false;
		result = 'computing';
		workerStatus = 'running';
		const task = context.tasks.worker<string, string>({
			key: 'uppercase-selection',
			label: 'Uppercase selection',
			input: captured.value.text,
			createWorker: () =>
				new Worker(new URL('./uppercase.worker.ts', import.meta.url), { type: 'module' }),
			apply(text) {
				// Deliberately gate delivery through UI, never a timer or retained transaction.
				request.text = text;
				canDeliver = true;
				result = 'ready';
			},
		});
		const outcome = await task.result;
		workerStatus = outcome.status;
	}
	function deliverResult(): void {
		const request = pending;
		if (!request || request.text === undefined) {
			return;
		}
		try {
			const outcome = request.api.applyResult(
				request.target,
				request.text,
				(text, { state }) => state.tr.insertText(text, request.from, request.to),
				{ signal: request.controller.signal },
			);
			result = outcome.ok ? `applied:${outcome.value}` : outcome.reason;
		} catch (error) {
			result = String(error);
		}
		canDeliver = false;
	}
	function callRetained(): void {
		if (!retainedApi || !retainedTarget) {
			return;
		}
		try {
			const outcome = retainedApi.executeCommand(retainedTarget, QUICK_FORMAT_BOLD_COMMAND_ID);
			retainedResult = outcome.ok ? 'unexpected success' : outcome.reason;
		} catch (error) {
			retainedResult = String(error);
		}
	}
	function callOldCommand(): void {
		const target = currentTarget();
		if (target) {
			const outcome = api.executeCommand(target, 'fixture.retained-command');
			retainedResult = outcome.ok ? 'unexpected success' : outcome.reason;
		}
	}

	onMount(() => {
		entries = [firstMount, secondMount].map((mount, index) => {
			const viewId = index === 0 ? 'view-a' : 'view-b';
			const view = new EditorView(mount, {
				state: EditorState.create({
					schema,
					doc: schema.node('doc', null, [
						schema.node('paragraph', null, schema.text(index === 0 ? 'alpha beta' : 'second view')),
					]),
					plugins: [history()],
				}),
				attributes: {
					role: 'textbox',
					'aria-label': index === 0 ? 'First editor' : 'Second editor',
					'aria-multiline': 'true',
				},
				dispatchTransaction(transaction) {
					view.updateState(view.state.apply(transaction));
					notify();
				},
				handleDOMEvents: {
					focus() {
						activeViewId = viewId;
						notify();
						return false;
					},
				},
			});
			// Same document identity deliberately does not imply synchronized view state.
			return { viewId, documentId: 'shared-document', name: viewId, view };
		});
		const unsubscribe = host.subscribe((snapshot) => {
			plugins = snapshot;
		});
		enable();
		return () => {
			pending?.controller.abort();
			host.deactivate(WORD_PROCESSING_PLUGIN_ID, { cascade: true });
			unsubscribe();
			for (const entry of entries) {
				entry.view.destroy();
			}
			entries = [];
		};
	});
</script>

<main>
	<h1>Word-processing proof consumer</h1>
	<p>
		Basic formatting: <output data-testid="basic-status"
			>{host.get('writers-ide.formatting')?.status ?? 'unregistered'}</output
		>
	</p>
	<p>
		Lifecycle: <output data-testid="lifecycle"
			>{plugins.map((plugin) => `${plugin.manifest.id}:${plugin.status}`).join(' | ')}</output
		>
	</p>
	<section aria-label="Quick format toolbar">
		{#if toolbar}
			<PluginPresentation presentation={toolbar[orientation].presentation} />
			<output data-testid="toolbar-size">{toolbar[orientation].size}</output>
		{/if}
	</section>
	<button
		onclick={() => {
			orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
		}}>Change orientation</button
	>
	<div bind:this={firstMount}></div>
	<div bind:this={secondMount}></div>
	<button
		onclick={() => {
			behaviorProofs = true;
		}}>Mount behavior proofs</button
	>
	{#if behaviorProofs}
		<BehaviorFixture {host} createView={createLaterView} />
	{/if}
	<button
		onclick={() => {
			rendererProofs = true;
		}}>Mount renderer proofs</button
	>
	{#if rendererProofs}
		<RendererFixture {host} createView={createLaterView} />
	{/if}
	<button
		onclick={() => {
			paginatedRendererProofs = true;
		}}>Mount paginated renderer proofs</button
	>
	{#if paginatedRendererProofs}
		<PaginatedRendererFixture />
	{/if}
	<div bind:this={laterMount}></div>
	<section aria-label="Editor controls">
		<button onclick={selectAll}>Select active text</button>
		<button onclick={caretAtEnd}>Caret at end</button>
		<button onclick={undoEdit}>Undo edit</button>
		<button onclick={activateSecond}>Activate second view</button>
		<button onclick={closeFirst}>Close first view</button>
	</section>
	<section aria-label="Result controls">
		<button onclick={computeResult}>Compute uppercase result</button>
		<button onclick={() => pending?.controller.abort()}>Cancel result</button>
		<button disabled={!canDeliver} onclick={deliverResult}>Deliver result</button>
		<p>Worker: <output data-testid="worker-status">{workerStatus}</output></p>
		<p>Application: <output data-testid="result">{result}</output></p>
	</section>
	<section aria-label="Lifecycle controls">
		<button onclick={() => host.deactivate(WORD_PROCESSING_PLUGIN_ID, { cascade: true })}
			>Disable provider and dependents</button
		>
		<button onclick={enable}>Re-enable proof consumer</button>
		<button onclick={callRetained}>Call retained API command</button>
		<button onclick={callOldCommand}>Call first activation command</button>
		<button onclick={refreshCommands}>Refresh commands</button>
		<p>Commands: <output data-testid="commands">{commandList}</output></p>
		<p>Retained: <output data-testid="retained-result">{retainedResult}</output></p>
		<p>Fresh handle: <output data-testid="fresh-handle">{String(freshHandle)}</output></p>
	</section>
</main>

<style>
	:global(body) {
		font-family: sans-serif;
	}
	:global(.ProseMirror) {
		border: 1px solid #777;
		padding: 0.75rem;
		margin: 0.5rem 0;
		min-height: 2rem;
		white-space: pre-wrap;
	}
	section {
		margin: 0.75rem 0;
	}
	button {
		margin: 0.2rem;
	}
</style>
