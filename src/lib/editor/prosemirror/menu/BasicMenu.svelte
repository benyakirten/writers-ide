<script module lang="ts">
	import { type IconSource } from '@steeze-ui/svelte-icon';
	import { FontBold, FontItalic } from '@steeze-ui/radix-icons';
	import type { EditorView } from 'prosemirror-view';

	import { toggleBold, toggleItalics } from '$lib/editor/prosemirror/view/actions.js';

	type MenuItem = {
		label: string;
		icon: IconSource;
		onClick: (view: EditorView | undefined) => void;
		getIconInversion: (activeCodeMarks: TextMarkPresence | undefined) => number;
	};
	const menu: MenuItem[] = [
		{
			label: 'Make text bold',
			icon: FontBold,
			onClick: (view) => {
				if (!view) {
					return;
				}

				const { state, dispatch } = view;
				toggleBold(state, dispatch, view);
				view.focus();
			},
			getIconInversion: (activeCodeMarks) => {
				const ratio = activeCodeMarks?.get('bold');
				return ratio ?? 0;
			}
		},
		{
			label: 'Make text italic',
			icon: FontItalic,
			onClick: (view) => {
				if (!view) {
					return;
				}
				toggleItalics(view.state, view.dispatch, view);
				view.focus();
			},
			getIconInversion: (activeCodeMarks) => {
				const ratio = activeCodeMarks?.get('italic');
				return ratio ?? 0;
			}
		}
	];
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import ProseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import IconButton from '$lib/components/IconButton.svelte';
	import { findTextMarks, type TextMarkPresence } from '../view/selection.js';
	import { TextSelection } from 'prosemirror-state';

	let activeCodeMarks = $state<TextMarkPresence>();
	let editorView: EditorView | undefined;

	onMount(() => {
		const unsub = ProseMirrorEventBus.subscribe(({ view }) => {
			const marks = view && findTextMarks(view.state.selection, view.state.doc);
			editorView = view;
			activeCodeMarks = marks;
		});

		return () => unsub();
	});
</script>

<div class="menu">
	{#each menu as { label, icon, onClick, getIconInversion } (label)}
		{@const inversion = getIconInversion(activeCodeMarks)}
		<IconButton {inversion} {icon} {label} onClick={() => onClick(editorView)} />
	{/each}
</div>

<style>
	.menu {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px;
	}
</style>
