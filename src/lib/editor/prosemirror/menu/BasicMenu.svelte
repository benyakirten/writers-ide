<script module lang="ts">
	import { Icon, type IconSource } from '@steeze-ui/svelte-icon';
	import { FontBold, FontItalic } from '@steeze-ui/radix-icons';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import {
		indentLess,
		indentMore,
		toggleBold,
		toggleItalics
	} from '$lib/editor/prosemirror/view/actions.js';

	type TextMenuIcon = {
		label: string;
		steezeIcon: IconSource;
		onClick: (view: EditorView | null) => void;
		markName: string;
	};
	const textMarks: TextMenuIcon[] = [
		{
			label: 'Make text bold',
			steezeIcon: FontBold,
			onClick: (view) => {
				if (!view) {
					return;
				}

				const { state, dispatch } = view;
				toggleBold(state, dispatch, view);
				view.focus();
			},
			markName: 'bold'
		},
		{
			label: 'Make text italic',
			steezeIcon: FontItalic,
			onClick: (view) => {
				if (!view) {
					return;
				}
				toggleItalics(view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'italic'
		}
	];

	type BlockMenuIcon = {
		label: string;
		Icon: Component<{ size: number | string }>;
		onClick: (view: EditorView | null) => void;
		determineInversion: (selection: Selection, doc: Node) => number;
	};
	const blockMarks: BlockMenuIcon[] = [
		{
			label: 'Indent more',
			Icon: IndentMore,
			onClick: (view) => {
				if (!view) {
					return;
				}
				indentMore(view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) => {
				const ratio = getIndentRatio(selection, doc);
				return ratio ?? 0;
			}
		},
		{
			label: 'Indent less',
			Icon: IndentLess,
			onClick: (view) => {
				if (!view) {
					return;
				}
				indentLess(view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) => {
				const ratio = getIndentRatio(selection, doc);
				return typeof ratio === 'number' ? 1 - ratio : 0;
			}
		}
	];
</script>

<script lang="ts">
	import { onMount, type Component } from 'svelte';

	import ProseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import IconButton from '$lib/components/IconButton.svelte';
	import { findTextMarks, getIndentRatio, type TextMarkPresence } from '../view/selection.js';
	import IndentMore from '$lib/editor/icons/IndentMore.svelte';
	import IndentLess from '$lib/editor/icons/IndentLess.svelte';
	import type { Node } from 'prosemirror-model';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	onMount(() => {
		const unsub = ProseMirrorEventBus.subscribe(({ view }) => {
			const marks = view && findTextMarks(view.state.selection, view.state.doc);
			editorView = view;
			activeCodeMarks = marks;
			selection = view.state.selection;
		});

		return () => unsub();
	});
</script>

<div class="menu">
	<div class="grouping">
		{#each textMarks as { label, steezeIcon, onClick, markName } (label)}
			{@const inversion = activeCodeMarks?.get(markName) ?? 0}
			<IconButton {inversion} {label} onClick={() => onClick(editorView)}>
				{#snippet icon()}
					<Icon src={steezeIcon} title={label} size="16px" />
				{/snippet}
			</IconButton>
		{/each}
	</div>
	<div class="grouping">
		{#each blockMarks as { label, Icon, onClick, determineInversion } (label)}
			{@const inversion =
				editorView && selection ? determineInversion(selection, editorView.state.doc) : 0}
			<IconButton {inversion} {label} onClick={() => onClick(editorView)}>
				{#snippet icon()}
					<Icon size={16} />
				{/snippet}
			</IconButton>
		{/each}
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
		gap: 4px;
	}
</style>
