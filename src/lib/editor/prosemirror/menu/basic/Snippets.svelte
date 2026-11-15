<script lang="ts" module>
	import type {
		FormattingBlockCommand,
		FormattingCommand,
		FormattingMark,
		FormattingSnapshot,
	} from './contracts';
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
		TextAlignJustify,
	} from '@steeze-ui/phosphor-icons';

	import { IconButton, type TooltipData } from '@writers-ide/components';
	import type { Internationalizator } from '$lib/editor/types';
	import { capitalize } from '$lib/utils/strings';
	import { TextOverline } from '$lib/icons';

	type TextMenuIcon = {
		iconSrc: IconSource;
		markName: FormattingMark;
		translateMark: (t: Internationalizator) => string;
	};

	const textMarks: TextMenuIcon[] = [
		{
			iconSrc: TextB,
			markName: 'bold',
			translateMark: (m) => m.bold(),
		},
		{
			iconSrc: TextItalic,
			markName: 'italic',
			translateMark: (m) => m.italic(),
		},
		{
			iconSrc: TextSuperscript,
			markName: 'superscript',
			translateMark: (m) => m.superscript(),
		},
		{
			iconSrc: TextSubscript,
			markName: 'subscript',
			translateMark: (m) => m.subscript(),
		},
		{
			iconSrc: TextUnderline,
			markName: 'underline',
			translateMark: (m) => m.underline(),
		},
		{
			iconSrc: TextOverline,
			markName: 'overline',
			translateMark: (m) => m.overline(),
		},
		{
			iconSrc: TextStrikethrough,
			markName: 'strikethrough',
			translateMark: (m) => m.strikethrough(),
		},
	];

	type BlockMenuIcon = {
		command: FormattingBlockCommand;
		generateLabel: (t: Internationalizator) => string;
		iconSrc: IconSource;
	};

	const blockMarks: BlockMenuIcon[] = [
		{
			command: 'indent',
			generateLabel: (m) => m.indent_text_more() + '.',
			iconSrc: TextIndent,
		},
		{
			command: 'dedent',
			generateLabel: (m) => m.indent_text_less() + '.',
			iconSrc: TextOutdent,
		},
		{
			command: 'align-left',
			generateLabel: (m) => m.align_text_left() + '.',
			iconSrc: TextAlignLeft,
		},
		{
			command: 'align-center',
			generateLabel: (m) => m.align_text_center() + '.',
			iconSrc: TextAlignCenter,
		},
		{
			command: 'align-right',
			generateLabel: (m) => m.align_text_right() + '.',
			iconSrc: TextAlignRight,
		},
		{
			command: 'align-justify',
			generateLabel: (m) => m.align_text_justify() + '.',
			iconSrc: TextAlignJustify,
		},
	];

	export { textMarkButtons, blockMarkButtons };
</script>

{#snippet textMarkButtons(
	snapshot: FormattingSnapshot | null,
	m: Internationalizator,
	execute: (command: FormattingCommand) => void,
	tooltipDirection: TooltipData['calibrateFor'],
)}
	{#each textMarks as { iconSrc, markName, translateMark } (markName)}
		{@const inversion = snapshot?.marks[markName] ?? 0}
		{@const translatedMark = translateMark(m)}
		{@const label =
			inversion === 1
				? m.remove_mark_from_text({ mark: translatedMark })
				: m.add_mark_to_text({ mark: translatedMark })}
		<IconButton
			{tooltipDirection}
			{inversion}
			label="{capitalize(label)}."
			disabled={!snapshot?.enabled[markName]}
			onclick={() => execute(markName)}
		>
			{#snippet icon()}
				<Icon src={iconSrc} title={label} size="16px" />
			{/snippet}
		</IconButton>
	{/each}
{/snippet}

{#snippet blockMarkButtons(
	snapshot: FormattingSnapshot | null,
	m: Internationalizator,
	execute: (command: FormattingCommand) => void,
	tooltipDirection: TooltipData['calibrateFor'],
)}
	{#each blockMarks as { command, generateLabel, iconSrc } (command)}
		{@const inversion = snapshot?.blocks[command] ?? 0}
		{@const label = generateLabel(m)}
		<IconButton
			{tooltipDirection}
			{inversion}
			{label}
			disabled={!snapshot?.enabled[command]}
			onclick={() => execute(command)}
		>
			{#snippet icon()}
				<Icon src={iconSrc} title={label} size="16px" />
			{/snippet}
		</IconButton>
	{/each}
{/snippet}
