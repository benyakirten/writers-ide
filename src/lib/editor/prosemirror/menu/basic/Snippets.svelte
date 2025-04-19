<script lang="ts" module>
	import { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';
	import type { Node } from 'prosemirror-model';
	import { Icon } from '@steeze-ui/svelte-icon';
	import { type IconSource } from '@steeze-ui/svelte-icon';
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

	import IconButton from '$lib/components/IconButton.svelte';
	import { type Internationalizator } from '$lib/editor/types';
	import { type SelectionUtilities, type TextMarkPresence } from '../../view/selection';
	import { type ActionUtilities } from '../../view/actions';
	import { capitalize } from '$lib/utils/strings';

	import type { UseableMarkName } from '$lib/editor/prosemirror/view/actions';
	import { TextOverline } from '$lib/icons';
	import { type TooltipData } from '@/services/tooltip.svelte';

	type TextMenuIcon = {
		iconSrc: IconSource;
		onclick: (view: EditorView | null, utils: typeof ActionUtilities) => void;
		markName: UseableMarkName;
		translateMark: (t: Internationalizator) => string;
	};

	const textMarks: TextMenuIcon[] = [
		{
			iconSrc: TextB,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}

				const { state, dispatch } = view;
				utils.toggleTextMark('bold', state, dispatch, view);
				view.focus();
			},
			markName: 'bold',
			translateMark: (m) => m.bold()
		},
		{
			iconSrc: TextItalic,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.toggleTextMark('italic', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'italic',
			translateMark: (m) => m.italic()
		},
		{
			iconSrc: TextSuperscript,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.toggleTextMark('superscript', view.state, view.dispatch, view, 'subscript');
				view.focus();
			},
			markName: 'superscript',
			translateMark: (m) => m.superscript()
		},
		{
			iconSrc: TextSubscript,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.toggleTextMark('subscript', view.state, view.dispatch, view, 'superscript');
				view.focus();
			},
			markName: 'subscript',
			translateMark: (m) => m.subscript()
		},
		{
			iconSrc: TextUnderline,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.toggleTextMark('underline', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'underline',
			translateMark: (m) => m.underline()
		},
		{
			iconSrc: TextOverline,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.toggleTextMark('overline', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'overline',
			translateMark: (m) => m.overline()
		},
		{
			iconSrc: TextStrikethrough,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.toggleTextMark('strikethrough', view.state, view.dispatch, view);
				view.focus();
			},
			markName: 'strikethrough',
			translateMark: (m) => m.strikethrough()
		}
	] as const;

	type BlockMenuIcon = {
		id: string;
		generateLabel: (t: Internationalizator) => string;
		iconSrc: IconSource;
		onclick: (view: EditorView | null, utils: typeof ActionUtilities) => void;
		determineInversion: (
			selection: Selection,
			doc: Node,
			utils: typeof SelectionUtilities
		) => number;
	};

	const blockMarks: BlockMenuIcon[] = [
		{
			id: 'indent_more',
			generateLabel: (m) => m.indent_text_more() + '.',
			iconSrc: TextIndent,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.dent('indent', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc, utils) => {
				const ratio = utils.getIndentRatio(selection, doc);
				return ratio ?? 0;
			}
		},
		{
			id: 'indent_less',
			generateLabel: (m) => m.indent_text_less() + '.',
			iconSrc: TextOutdent,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.dent('dedent', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc, utils) => {
				const ratio = utils.getIndentRatio(selection, doc);
				return ratio === null ? 0 : 1 - ratio;
			}
		},
		{
			id: 'align_left',
			generateLabel: (m) => m.align_text_left() + '.',
			iconSrc: TextAlignLeft,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.setTextAlignment('left', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc, utils) =>
				utils.getBlockAttributeRatio(
					selection,
					doc,
					'align',
					// TODO: Add method to detect default alignment value
					(value) => value === 'left' || value === 'start'
				)
		},
		{
			id: 'align_center',
			generateLabel: (m) => m.align_text_center() + '.',
			iconSrc: TextAlignCenter,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.setTextAlignment('center', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc, utils) =>
				utils.getBlockAttributeRatio(selection, doc, 'align', 'center')
		},
		{
			id: 'align_right',
			generateLabel: (m) => m.align_text_right() + '.',
			iconSrc: TextAlignRight,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.setTextAlignment('right', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc, utils) =>
				utils.getBlockAttributeRatio(
					selection,
					doc,
					'align',
					(value) => value === 'right' || value === 'end'
				)
		},
		{
			id: 'align_justify',
			generateLabel: (m) => m.align_text_justify() + '.',
			iconSrc: TextAlignJustify,
			onclick: (view, utils) => {
				if (!view) {
					return;
				}
				utils.setTextAlignment('justify', view.state, view.dispatch);
				view.focus();
			},
			determineInversion: (selection, doc, utils) =>
				utils.getBlockAttributeRatio(selection, doc, 'align', 'justify')
		}
	];

	export { textMarkButtons, blockMarkButtons };
</script>

{#snippet textMarkButtons(
	activeCodeMarks: TextMarkPresence | undefined,
	m: Internationalizator,
	editorView: EditorView | null,
	actionUtils: typeof ActionUtilities,
	tooltipDirection: TooltipData['calibrateFor']
)}
	{#each textMarks as { iconSrc, onclick, markName, translateMark } (markName)}
		{@const inversion = activeCodeMarks?.get(markName) ?? 0}
		{@const translatedMark = translateMark(m)}
		{@const label =
			inversion === 1
				? m.remove_mark_from_text({ mark: translatedMark })
				: m.add_mark_to_text({ mark: translatedMark })}
		<IconButton
			{tooltipDirection}
			{inversion}
			label="{capitalize(label)}."
			onclick={() => onclick(editorView, actionUtils)}
		>
			{#snippet icon()}
				<Icon src={iconSrc} title={label} size="16px" />
			{/snippet}
		</IconButton>
	{/each}
{/snippet}

{#snippet blockMarkButtons(
	editorView: EditorView | null,
	selection: Selection | null,
	m: Internationalizator,
	actionUtils: typeof ActionUtilities,
	selectionUtils: typeof SelectionUtilities,
	tooltipDirection: TooltipData['calibrateFor']
)}
	{#each blockMarks as { id, generateLabel, iconSrc, onclick, determineInversion } (id)}
		{@const inversion =
			editorView && selection
				? determineInversion(selection, editorView.state.doc, selectionUtils)
				: 0}
		{@const label = generateLabel(m)}
		<IconButton
			{tooltipDirection}
			{inversion}
			{label}
			onclick={() => onclick(editorView, actionUtils)}
		>
			{#snippet icon()}
				<Icon src={iconSrc} title={label} size="16px" />
			{/snippet}
		</IconButton>
	{/each}
{/snippet}
