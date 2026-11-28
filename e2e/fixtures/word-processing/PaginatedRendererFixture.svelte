<script lang="ts">
	import { onMount } from 'svelte';
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import {
		WORD_PROCESSING_PLUGIN_ID,
		wordProcessingApi,
		type WordProcessingApi,
	} from '@writers-ide/word-processing';
	import { defineSvelteNodeView, defineSvelteMarkView } from '@writers-ide/word-processing/svelte';
	import { TextSelection } from 'prosemirror-state';
	import { undo, closeHistory } from 'prosemirror-history';
	import { PluginHost } from '$lib/plugins/plugin-host';
	import {
		createWordProcessingPlugin,
		defaultWordProcessingSources,
	} from '$lib/editor/prosemirror/word-processing.svelte';
	import { createView } from '$lib/editor/prosemirror/view/editor';
	import { schema } from '$lib/editor/prosemirror/view/schema';
	import Editors from '$lib/editor/prosemirror/prose-mirror-editor.svelte';
	import { PageObserver } from '$lib/editor/state/page-observer.svelte';
	import { PageQueue } from '$lib/components/pagination/queue.svelte';
	import Paginator from '$lib/components/pagination/Paginator.svelte';
	import PaginatedRendererNode from './PaginatedRendererNode.svelte';
	import PaginatedRendererMark from './PaginatedRendererMark.svelte';

	const documentId = 'renderer-pagination-document';
	const rendererId = 'fixture.paginated-renderer';
	const controlsId = 'fixture.paginated-controls';
	const markRendererId = 'fixture.paginated-mark-renderer';
	const markSizing = $state({ fontSize: 16 });
	const sizing = $state({ height: 20 });
	let mount: HTMLDivElement;
	let viewport: HTMLDivElement;
	let api: WordProcessingApi;
	let ready = $state(false);
	let summary = $state('');
	const host = new PluginHost<SveltePresentation>({
		registries: {
			toolbar: { register: () => () => {} },
			view: { register: () => () => {} },
			command: { register: () => () => {} },
		},
	});
	const sources = {
		...defaultWordProcessingSources,
		listViews: () => Editors.getViews(documentId),
		activeViewId: () => Editors.get(documentId)?.viewId ?? null,
	};
	function inspect() {
		const entry = Editors.get(documentId);
		if (!entry) {
			return;
		}
		const { state } = entry.view;
		const observed = PageObserver.map[entry.viewId];
		const text: string[] = [];
		state.doc.descendants((node) => {
			if (node.isText) {
				text.push(node.text!);
			}
		});
		summary = JSON.stringify({
			text: text.join(''),
			pages: state.doc.childCount,
			caretOffset: state.doc.textBetween(0, state.selection.head, '').length,
			revision: observed?.revision,
			settled:
				!!observed &&
				observed.paginatedTo >= PageObserver.target(observed) &&
				!PageQueue.jobs.some((job) => job.viewId === entry.viewId),
			errors: [WORD_PROCESSING_PLUGIN_ID, rendererId, markRendererId, controlsId].flatMap(
				(id) => host.get(id)?.errors ?? [],
			),
		});
	}
	function edit() {
		const target = api.snapshot().views[0];
		if (target) {
			api.edit(
				target,
				({ state }) =>
					closeHistory(state.tr).setSelection(TextSelection.create(state.doc, 7)).insertText('!'),
				{ focus: true },
			);
		}
	}
	function undoEdit() {
		const target = api.snapshot().views[0];
		if (target) {
			api.runCommand(target, undo, { focus: true });
		}
	}
	onMount(() => {
		const doc = schema.node('doc', null, [
			schema.node(
				'page',
				null,
				Array.from({ length: 8 }, (_, index) =>
					schema.node(
						'paragraph',
						{ indent: 0 },
						schema.text(`Paragraph ${index + 1}: The writer keeps every word intact.`, [
							schema.marks.bold.create(),
						]),
					),
				),
			),
		]);
		const destroy = createView(documentId, 'Renderer pagination', doc, mount, viewport);
		host.register(createWordProcessingPlugin(sources));
		const manifest = (id: string) => ({
			id,
			name: id,
			description: 'Opt-in production pagination proof',
			version: '0.1.0',
			apiVersion: 1 as const,
			capabilities: [],
			dependencies: [
				{
					provider: WORD_PROCESSING_PLUGIN_ID,
					api: wordProcessingApi.id,
					major: wordProcessingApi.major,
				},
			],
		});
		host.register({
			manifest: manifest(controlsId),
			activate(context) {
				api = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
			},
		});
		host.register({
			manifest: manifest(rendererId),
			activate(context) {
				const consumer = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				consumer.registerNodeView({
					id: 'fixture.paginated-paragraph',
					name: 'Paginated Svelte paragraph',
					nodeType: 'paragraph',
					create(ctx) {
						return defineSvelteNodeView(PaginatedRendererNode, {
							contentDOM: true,
							props: { sizing },
							onError: ctx.reportError,
						});
					},
				});
			},
		});
		host.register({
			manifest: manifest(markRendererId),
			activate(context) {
				const consumer = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				consumer.registerMarkView({
					id: 'fixture.paginated-bold',
					name: 'Paginated Svelte bold',
					markType: 'bold',
					create(ctx) {
						return defineSvelteMarkView(PaginatedRendererMark, {
							props: { sizing: markSizing },
							onError: ctx.reportError,
						});
					},
				});
			},
		});
		host.activate(controlsId);
		ready = true;
		return () => {
			host.deactivate(WORD_PROCESSING_PLUGIN_ID, { cascade: true });
			destroy();
		};
	});
</script>

<section aria-label="Paginated renderer proofs" data-testid="paginated-renderer-fixture">
	{#if ready}
		<Paginator />
		<button onclick={() => host.activate(rendererId)}>Enable paginated renderer</button>
		<button onclick={() => host.deactivate(rendererId)}>Disable paginated renderer</button>
		<button
			onclick={() => {
				sizing.height = 80;
			}}>Grow renderer UI</button
		>
		<button
			onclick={() => {
				sizing.height = 20;
			}}>Shrink renderer UI</button
		>
		<button onclick={() => host.activate(markRendererId)}>Enable paginated mark</button>
		<button onclick={() => host.deactivate(markRendererId)}>Disable paginated mark</button>
		<button
			onclick={() => {
				markSizing.fontSize = 32;
			}}>Grow mark font</button
		>
		<button
			onclick={() => {
				markSizing.fontSize = 16;
			}}>Shrink mark font</button
		>
		<button onclick={edit}>Insert pagination marker</button>
		<button onclick={undoEdit}>Undo pagination marker</button>
		<button onclick={inspect}>Inspect pagination renderer</button>
	{/if}
	<output data-testid="paginated-renderer-state">{summary}</output>
	<div class="document-viewport" data-testid="paginated-renderer-viewport" bind:this={viewport}>
		<div bind:this={mount}></div>
	</div>
</section>

<style>
	output {
		display: block;
		overflow-wrap: anywhere;
	}
	.document-viewport {
		height: 1500px;
		overflow: auto;
		background: #ddd;
		padding: 12px;
	}
	.document-viewport :global(.ProseMirror) {
		border: 0;
		margin: 0;
		padding: 0;
		min-height: 0;
		font: 16px / 20px serif;
		white-space: pre-wrap;
	}
	.document-viewport :global(.prosemirror-page) {
		box-sizing: border-box;
		width: 480px;
		height: 320px;
		padding: 24px 36px;
		border: 1px solid #888;
		margin: 0 0 16px;
		background: white;
	}
	.document-viewport :global(.prosemirror-page > p) {
		margin: 0;
	}
</style>
