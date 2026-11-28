<script lang="ts">
	import { onMount } from 'svelte';
	import type { SveltePresentation } from '@writers-ide/plugins/svelte';
	import {
		WORD_PROCESSING_PLUGIN_ID,
		wordProcessingApi,
		type WordProcessingApi,
	} from '@writers-ide/word-processing';
	import { defineSvelteNodeView, defineSvelteMarkView } from '@writers-ide/word-processing/svelte';
	import { DOMSerializer } from 'prosemirror-model';
	import { NodeSelection, TextSelection } from 'prosemirror-state';
	import { closeHistory, undoDepth, redoDepth } from 'prosemirror-history';
	import { PluginHost } from '$lib/plugins/plugin-host';
	import RendererNode from './RendererNode.svelte';
	import RendererMark from './RendererMark.svelte';
	import AsyncFailureRendererNode from './AsyncFailureRendererNode.svelte';
	import AsyncFailureRendererMark from './AsyncFailureRendererMark.svelte';

	let { host, createView }: { host: PluginHost<SveltePresentation>; createView: () => void } =
		$props();
	const controlsId = 'fixture.renderer-controls';
	const exampleId = 'fixture.svelte-renderers';
	const failureId = 'fixture.failed-renderer';
	const asyncFailureId = 'fixture.async-failed-renderer';
	let asyncKind: 'node' | 'mark' = 'node';
	let failAsync = $state(false);
	let asyncAborted = $state<string[]>([]);
	const dependency = {
		provider: WORD_PROCESSING_PLUGIN_ID,
		api: wordProcessingApi.id,
		major: wordProcessingApi.major,
	};
	let api: WordProcessingApi;
	let summary = $state('');
	let status = $state('idle');
	let control = $state('');
	let error = $state('');

	let metrics = $state({
		nodeMounts: 0,
		nodeDestroys: 0,
		markMounts: 0,
		markDestroys: 0,
		factories: [] as string[],
		aborted: [] as string[],
	});
	let releaseNode: (() => void) | undefined;
	let failure: 'constructor' | 'update' = 'constructor';

	function refresh() {
		const views = api.snapshot().views.map((target) => {
			const result = api.inspect(target, ({ state, view }) => {
				const container = document.createElement('div');
				container.append(
					DOMSerializer.fromSchema(state.schema).serializeFragment(state.doc.content),
				);
				return {
					viewId: target.viewId,
					composing: view.composing,
					undoDepth: undoDepth(state),
					redoDepth: redoDepth(state),
					doc: state.doc.toJSON(),
					selection: state.selection.toJSON(),
					marks: state.storedMarks?.map((mark) => mark.type.name) ?? null,
					html: container.innerHTML,
				};
			});
			return result.ok ? result.value : result.reason;
		});
		summary = JSON.stringify(views);

		error = [controlsId, exampleId, failureId, asyncFailureId, WORD_PROCESSING_PLUGIN_ID]
			.map((id) => `${id}:${JSON.stringify(host.get(id)?.errors ?? [])}`)
			.join(' | ');
	}
	function edit(kind: 'mark' | 'select-node' | 'caret-mark' | 'stored') {
		const snapshot = api.snapshot();
		const target = snapshot.views.find((item) => item.viewId === snapshot.activeViewId);
		if (!target) {
			return;
		}
		api.edit(
			target,
			({ state }) => {
				if (kind === 'select-node') {
					return state.tr.setSelection(NodeSelection.create(state.doc, 0));
				}
				if (kind === 'stored') {
					return state.tr.setStoredMarks([state.schema.marks.strong.create()]);
				}
				if (kind === 'caret-mark') {
					return closeHistory(state.tr).setSelection(TextSelection.create(state.doc, 3));
				}
				return state.tr.addMark(1, state.doc.content.size - 1, state.schema.marks.strong.create());
			},
			{ focus: true },
		);
		refresh();
	}
	function activate(id: string) {
		host.activate(id);
		refresh();
	}
	function disable(id: string) {
		host.deactivate(id);
		refresh();
	}
	function conflict() {
		try {
			api.registerNodeView({
				id: 'fixture.conflict',
				name: 'Conflicting paragraph',
				nodeType: 'paragraph',
				create: () => () => ({ dom: document.createElement('p') }),
			});
			status = 'unexpected success';
		} catch (caught) {
			status = String(caught);
		}
		refresh();
	}

	onMount(() => {
		const manifest = (id: string) => ({
			id,
			name: id,
			description: 'Opt-in renderer browser example',
			version: '0.1.0',
			apiVersion: 1 as const,
			capabilities: [],
			dependencies: [dependency],
		});
		host.register({
			manifest: manifest(controlsId),
			activate(context) {
				api = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
			},
		});
		host.register({
			manifest: manifest(exampleId),
			activate(context) {
				const consumer = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				releaseNode = consumer.registerNodeView({
					id: 'fixture.paragraph',
					name: 'Svelte paragraph',
					nodeType: 'paragraph',
					create({ viewId, signal, reportError }) {
						metrics.factories.push(viewId);
						signal.addEventListener('abort', () => metrics.aborted.push(viewId), { once: true });
						return defineSvelteNodeView(RendererNode, {
							contentDOM: true,
							props: {
								viewId,
								onControl: (position) => {
									control = `${viewId}:${position}`;
								},
								onMount: () => {
									metrics.nodeMounts++;
								},
								onDestroy: () => {
									metrics.nodeDestroys++;
								},
							},
							onError: reportError,
						});
					},
				});
				consumer.registerMarkView({
					id: 'fixture.strong',
					name: 'Svelte strong',
					markType: 'strong',
					create({ reportError }) {
						return defineSvelteMarkView(RendererMark, {
							props: {
								onMount: () => {
									metrics.markMounts++;
								},
								onDestroy: () => {
									metrics.markDestroys++;
								},
							},
							onError: reportError,
						});
					},
				});
			},
		});
		host.register({
			manifest: manifest(failureId),
			activate(context) {
				const consumer = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				consumer.registerNodeView({
					id: 'fixture.throwing',
					name: 'Throwing paragraph',
					nodeType: 'paragraph',
					create() {
						return () => {
							if (failure === 'constructor') {
								throw new Error('intentional renderer constructor failure');
							}
							const dom = document.createElement('div');
							dom.dataset.failingRenderer = '';
							return {
								dom,
								contentDOM: dom,
								update() {
									throw new Error('intentional renderer update failure');
								},
							};
						};
					},
				});
			},
		});
		host.register({
			manifest: manifest(asyncFailureId),
			activate(context) {
				const consumer = context.apis.get(WORD_PROCESSING_PLUGIN_ID, wordProcessingApi)!;
				if (asyncKind === 'node') {
					consumer.registerNodeView({
						id: 'fixture.async-node',
						name: 'Async failing Svelte paragraph',
						nodeType: 'paragraph',
						create({ viewId, signal, reportError }) {
							signal.addEventListener('abort', () => asyncAborted.push(viewId), { once: true });
							return defineSvelteNodeView(AsyncFailureRendererNode, {
								contentDOM: true,
								props: { readFailure: () => viewId === 'view-a' && failAsync },
								onError: reportError,
							});
						},
					});
				} else {
					consumer.registerMarkView({
						id: 'fixture.async-mark',
						name: 'Async failing Svelte strong',
						markType: 'strong',
						create({ viewId, signal, reportError }) {
							signal.addEventListener('abort', () => asyncAborted.push(viewId), { once: true });
							return defineSvelteMarkView(AsyncFailureRendererMark, {
								props: { readFailure: () => viewId === 'view-a' && failAsync },
								onError: reportError,
							});
						},
					});
				}
			},
		});
		host.activate(controlsId);
		refresh();
		return () => {
			for (const id of [exampleId, failureId, asyncFailureId, controlsId]) {
				host.deactivate(id);
			}
		};
	});
</script>

<section aria-label="Renderer proof controls">
	<button onclick={() => activate(exampleId)}>Enable Svelte renderers</button>
	<button onclick={() => disable(exampleId)}>Disable Svelte renderers</button>
	<button
		onclick={() => {
			releaseNode?.();
			refresh();
		}}>Release paragraph renderer</button
	>
	<button onclick={conflict}>Try renderer conflict</button>
	<button onclick={() => edit('mark')}>Mark active text strong</button>
	<button onclick={() => edit('select-node')}>Select paragraph node</button>
	<button onclick={() => edit('caret-mark')}>Caret inside strong</button>
	<button onclick={() => edit('stored')}>Store renderer strong</button>
	<button onclick={createView}>Create renderer later view</button>
	<button
		onclick={() => {
			failure = 'constructor';
			activate(failureId);
		}}>Enable constructor failure</button
	>
	<button
		onclick={() => {
			failure = 'update';
			activate(failureId);
		}}>Enable update failure</button
	>
	<button
		onclick={() => {
			asyncKind = 'node';
			activate(asyncFailureId);
		}}>Enable async node renderer</button
	>
	<button
		onclick={() => {
			asyncKind = 'mark';
			activate(asyncFailureId);
		}}>Enable async mark renderer</button
	>
	<button
		onclick={() => {
			failAsync = true;
		}}>Trigger independent reactive failure</button
	>
	<button onclick={refresh}>Inspect renderer state</button>
	<output data-testid="renderer-async-aborted">{JSON.stringify(asyncAborted)}</output>
	<output data-testid="renderer-state">{summary}</output>
	<output data-testid="renderer-metrics">{JSON.stringify(metrics)}</output>
	<output data-testid="renderer-status">{status}</output>
	<output data-testid="renderer-control">{control}</output>

	<output data-testid="renderer-errors">{error}</output>
</section>

<style>
	output {
		display: block;
		overflow-wrap: anywhere;
	}
</style>
