<script module lang="ts">
	import { type IconSource } from '@steeze-ui/svelte-icon';
	import { FontBold, FontItalic } from '@steeze-ui/radix-icons';
	type MenuItem = {
		label: string;
		icon: IconSource;
		onClick: () => void;
	};
	const menu: MenuItem[] = [
		{
			label: 'Bold',
			icon: FontBold,
			onClick: () => {
				console.log('BOLD CLICKED');
			}
		},
		{
			label: 'Italic',
			icon: FontItalic,
			onClick: () => {
				console.log('ITALIC CLICKED');
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

	function determineInversionAmount(activeCodeMarks: MarkAnalysis | undefined, label: string) {
		if (activeCodeMarks?.complete.has(label)) {
			console.log('FULL');
			return 'full';
		}
		if (activeCodeMarks?.partial.has(label)) {
			console.log('PARTIAL');
			return 'partial';
		}
		console.log('NONE');
		return 'none';
	}
</script>

<div class="menu">
	{#each menu as { label, icon, onClick } (label)}
		{@const inversion = determineInversionAmount(activeCodeMarks, label.toLowerCase())}
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
