<script module lang="ts">
	import { type IconSource } from '@steeze-ui/svelte-icon';
	import { FontBold, FontItalic } from '@steeze-ui/radix-icons';
	type MenuItem = {
		label: string;
		icon: IconSource;
		onClick: () => void;
		getIconInversion: (activeCodeMarks: MarkAnalysis | undefined) => 'full' | 'partial' | 'none';
	};
	const menu: MenuItem[] = [
		{
			label: 'Make text bold',
			icon: FontBold,
			onClick: () => {
				console.log('BOLD CLICKED');
			},
			getIconInversion: (activeCodeMarks) => {
				if (activeCodeMarks?.complete.has('bold')) {
					return 'full';
				}
				if (activeCodeMarks?.partial.has('bold')) {
					return 'partial';
				}

				return 'none';
			}
		},
		{
			label: 'Make text italic',
			icon: FontItalic,
			onClick: () => {
				console.log('ITALIC CLICKED');
			},
			getIconInversion: (activeCodeMarks) => {
				if (activeCodeMarks?.complete.has('italic')) {
					return 'full';
				}
				if (activeCodeMarks?.partial.has('italic')) {
					return 'partial';
				}

				return 'none';
			}
		}
	];
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	import proseMirrorEventBus, { type MarkAnalysis } from '$lib/editor/state/event-bus.svelte.js';
	import ProseMirrorEventBus from '$lib/editor/state/event-bus.svelte.js';
	import IconButton from '$lib/components/IconButton.svelte';

	let activeCodeMarks = $state<MarkAnalysis>();

	onMount(() => {
		const unsub = ProseMirrorEventBus.subscribe(({ view }) => {
			const marks = proseMirrorEventBus.analyzeTextMarks(view);
			activeCodeMarks = marks;
		});

		return () => unsub();
	});
</script>

<div class="menu">
	{#each menu as { label, icon, onClick, getIconInversion } (label)}
		{@const inversion = getIconInversion(activeCodeMarks)}
		<IconButton {inversion} {icon} {label} {onClick} />
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
