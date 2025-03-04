<script module lang="ts">
	import { Icon, type IconSource } from '@steeze-ui/svelte-icon';
	import {
		TextB,
		TextItalic,
		TextSuperscript,
		TextSubscript,
		TextIndent,
		TextOutdent,
		TextUnderline,
		TextStrikethrough,
		TextAlignLeft,
		TextAlignCenter,
		TextAlignRight,
		TextAlignJustify
	} from '@steeze-ui/phosphor-icons';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';
	import type { Node } from 'prosemirror-model';

	import { ActionUtilities } from '$lib/editor/prosemirror/view/actions.js';
	import { TextOverline } from '$lib/icons.js';
	import { SelectionUtilies, type TextMarkPresence } from '../view/selection.js';

	type TextMenuIcon = {
		iconSrc: IconSource;
		onClick: (view: EditorView | null) => void;
		markName: string;
	};
	const textMarks: TextMenuIcon[] = [
		{
			iconSrc: TextB,
			onClick: (view) => {
				if (!view) {
					return;
				}

				const { state, dispatch } = view;
				ActionUtilities.toggleTextMark('bold', state, dispatch, view);
				view.focus();
			},
			markName: 'bold'
		},
		{
			iconSrc: TextItalic,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.toggleTextMark('italic', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'italic'
		},
		{
			iconSrc: TextSuperscript,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.toggleTextMark('superscript', view.state, view.dispatch, view, 'subscript');
				view.focus();
			},
			markName: 'superscript'
		},
		{
			iconSrc: TextSubscript,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.toggleTextMark('subscript', view.state, view.dispatch, view, 'superscript');
				view.focus();
			},
			markName: 'subscript'
		},
		{
			iconSrc: TextUnderline,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.toggleTextMark('underline', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'underline'
		},
		{
			iconSrc: TextOverline,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.toggleTextMark('overline', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'overline'
		},
		{
			iconSrc: TextStrikethrough,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.toggleTextMark('strikethrough', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'strikethrough'
		}
	];

	type BlockMenuIcon = {
		label: string;
		iconSrc: IconSource;
		onClick: (view: EditorView | null) => void;
		determineInversion: (selection: Selection, doc: Node) => number;
	};
	const blockMarks: BlockMenuIcon[] = [
		{
			label: 'Indent text more.',
			iconSrc: TextIndent,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.dent('indent', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) => {
				const ratio = SelectionUtilies.getIndentRatio(selection, doc);
				return ratio ?? 0;
			}
		},
		{
			label: 'Indent text less.',
			iconSrc: TextOutdent,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.dent('dedent', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) => {
				const ratio = SelectionUtilies.getIndentRatio(selection, doc);
				return ratio === null ? 0 : 1 - ratio;
			}
		},
		{
			label: 'Align text left.',
			iconSrc: TextAlignLeft,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.setTextAlignment('left', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) =>
				SelectionUtilies.getBlockAttributeRatio(
					selection,
					doc,
					'align',
					// TODO: Add method to detect default alignment value
					(value) => value === 'left' || value === 'start'
				)
		},
		{
			label: 'Align text center.',
			iconSrc: TextAlignCenter,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.setTextAlignment('center', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) =>
				SelectionUtilies.getBlockAttributeRatio(selection, doc, 'align', 'center')
		},
		{
			label: 'Align text right.',
			iconSrc: TextAlignRight,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.setTextAlignment('right', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) =>
				SelectionUtilies.getBlockAttributeRatio(
					selection,
					doc,
					'align',
					(value) => value === 'right' || value === 'end'
				)
		},
		{
			label: 'Justify text.',
			iconSrc: TextAlignJustify,
			onClick: (view) => {
				if (!view) {
					return;
				}
				ActionUtilities.setTextAlignment('justify', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc) =>
				SelectionUtilies.getBlockAttributeRatio(selection, doc, 'align', 'justify')
		}
	];
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import IconButton from '$lib/components/IconButton.svelte';
	import type { BarItemComponentProps } from '$lib/editor/state/bar-item-registry.svelte.js';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	let props: BarItemComponentProps = $props();

	onMount(() => {
		const unsub = props.proseMirror.eventBus.subscribe(({ view }) => {
			const marks = view && SelectionUtilies.findTextMarks(view.state.selection, view.state.doc);
			activeCodeMarks = marks;
			editorView = view;
			selection = view.state.selection;
		});

		return () => unsub();
	});
</script>

<div class="menu">
	<div class="grouping">
		{#each textMarks as { iconSrc, onClick, markName } (markName)}
			{@const inversion = activeCodeMarks?.get(markName) ?? 0}
			{@const label = inversion === 1 ? `Remove ${markName} from text.` : `Make text ${markName}.`}
			<IconButton {inversion} {label} onClick={() => onClick(editorView)}>
				{#snippet icon()}
					<Icon src={iconSrc} title={label} size="16px" />
				{/snippet}
			</IconButton>
		{/each}
	</div>
	<div class="grouping">
		{#each blockMarks as { label, iconSrc, onClick, determineInversion } (label)}
			{@const inversion =
				editorView && selection ? determineInversion(selection, editorView.state.doc) : 0}
			<IconButton {inversion} {label} onClick={() => onClick(editorView)}>
				{#snippet icon()}
					<Icon src={iconSrc} title={label} size="16px" />
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
		gap: 2px;
	}
</style>
