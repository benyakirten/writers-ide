<script lang="ts">
	import { onMount } from 'svelte';

	import IconButton from '$lib/components/IconButton.svelte';
	import type { BarItemComponentProps } from '$lib/editor/state/bar-item-registry.svelte.js';
	import type { EditorView } from 'prosemirror-view';
	import type { Selection } from 'prosemirror-state';

	import { capitalize } from '$lib/utils/strings.js';
	import type { TextMarkPresence } from '../../view/selection.js';

	import { blockMarks, textMarks } from './buttons.js';
	import { Icon } from '@steeze-ui/svelte-icon';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView = $state<EditorView | null>(null);
	let selection = $state<Selection | null>(null);

	let props: BarItemComponentProps = $props();

	onMount(() => {
		const unsub = props.proseMirror.eventBus.subscribe(({ view }) => {
			const marks =
				view && props.proseMirror.selections.findTextMarks(view.state.selection, view.state.doc);
			activeCodeMarks = marks;
			editorView = view;
			selection = view.state.selection;
		});

		return () => unsub();
	});
</script>

<div class="menu">
	<div class="grouping">
		{#each textMarks as { iconSrc, onclick, markName, translateMark } (markName)}
			{@const inversion = activeCodeMarks?.get(markName) ?? 0}
			{@const translatedMark = translateMark(props.internationalization.translation)}
			{@const label =
				inversion === 1
					? props.internationalization.translation.remove_mark_from_text({ mark: translatedMark })
					: props.internationalization.translation.add_mark_to_text({ mark: translatedMark })}
			<IconButton
				{inversion}
				label="{capitalize(label)}."
				onclick={() => onclick(editorView, props.proseMirror.actions)}
			>
				{#snippet icon()}
					<Icon src={iconSrc} title={label} size="16px" />
				{/snippet}
			</IconButton>
		{/each}
	</div>
	<div class="grouping">
		{#each blockMarks as { id, generateLabel, iconSrc, onclick, determineInversion } (id)}
			{@const inversion =
				editorView && selection ? determineInversion(selection, editorView.state.doc) : 0}
			{@const label = generateLabel(props.internationalization.translation)}
			<IconButton
				{inversion}
				{label}
				onclick={() => onclick(editorView, props.proseMirror.actions)}
			>
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
