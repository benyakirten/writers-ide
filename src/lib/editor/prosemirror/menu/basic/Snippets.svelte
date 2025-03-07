<script lang="ts" module>
	import { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';
	import { Icon } from '@steeze-ui/svelte-icon';

	import IconButton from '$lib/components/IconButton.svelte';
	import { type Internationalizator } from '$lib/editor/types.js';
	import { type SelectionUtilies, type TextMarkPresence } from '../../view/selection.js';
	import type { TextMenuIcon, BlockMenuIcon } from './buttons.js';
	import { type ActionUtilities } from '../../view/actions.js';
	import { capitalize } from '$lib/utils/strings.js';

	export { textMarkButtons, blockMarkButtons };
</script>

{#snippet textMarkButtons(
	textMarks: TextMenuIcon[],
	activeCodeMarks: TextMarkPresence | undefined,
	m: Internationalizator,
	editorView: EditorView | null,
	actionUtils: typeof ActionUtilities
)}
	{#each textMarks as { iconSrc, onclick, markName, translateMark } (markName)}
		{@const inversion = activeCodeMarks?.get(markName) ?? 0}
		{@const translatedMark = translateMark(m)}
		{@const label =
			inversion === 1
				? m.remove_mark_from_text({ mark: translatedMark })
				: m.add_mark_to_text({ mark: translatedMark })}
		<IconButton
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
	blockMarks: BlockMenuIcon[],
	editorView: EditorView | null,
	selection: Selection | null,
	m: Internationalizator,
	actionUtils: typeof ActionUtilities,
	selectionUtils: typeof SelectionUtilies
)}
	{#each blockMarks as { id, generateLabel, iconSrc, onclick, determineInversion } (id)}
		{@const inversion =
			editorView && selection
				? determineInversion(selection, editorView.state.doc, selectionUtils)
				: 0}
		{@const label = generateLabel(m)}
		<IconButton {inversion} {label} onclick={() => onclick(editorView, actionUtils)}>
			{#snippet icon()}
				<Icon src={iconSrc} title={label} size="16px" />
			{/snippet}
		</IconButton>
	{/each}
{/snippet}
