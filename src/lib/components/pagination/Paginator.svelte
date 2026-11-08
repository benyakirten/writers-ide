<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { PageQueue } from './queue.svelte';
	import PageLayout from '$lib/editor/state/page-layout.svelte';
	import { PageObserver } from '$lib/editor/state/page-observer.svelte';

	let dialog: HTMLDialogElement;
	const catchUp = $derived(PageQueue.catchUp);

	onMount(() => {
		const stop = PageQueue.start();
		const fontsChanged = () => PageObserver.invalidateAll();
		document.fonts?.addEventListener('loadingdone', fontsChanged);
		return () => {
			stop();
			document.fonts?.removeEventListener('loadingdone', fontsChanged);
		};
	});

	$effect(() => {
		// Layout settings invalidate measurements, independently of document transactions.
		void [
			PageLayout.units,
			PageLayout.pageWidth,
			PageLayout.pageHeight,
			PageLayout.pageXMargin,
			PageLayout.pageYMargin,
			PageLayout.orphanLines,
			PageLayout.widowLines,
			PageLayout.defaultParagraphIndent,
		];
		untrack(() => PageObserver.invalidateAll());
	});

	$effect(() => {
		if (!dialog) return;
		if (catchUp && !dialog.open) dialog.showModal();
		else if (!catchUp && dialog.open) dialog.close();
	});

	function dismiss() {
		if (catchUp) PageQueue.dismiss(catchUp.viewId);
	}
</script>

<dialog bind:this={dialog} aria-labelledby="pagination-heading" oncancel={dismiss}>
	{#if catchUp}
		<h2 id="pagination-heading">Catching up with document layout</h2>
		<p>You can continue editing while pagination runs in the background.</p>
		<p>{catchUp.handle.label}</p>
		<progress
			value={catchUp.handle.progress.completed ?? 0}
			max={catchUp.handle.progress.total ?? 1}
		></progress>
		<p>{catchUp.handle.progress.completed ?? 0} / {catchUp.handle.progress.total ?? '…'} pages</p>
		<button onclick={dismiss}>Continue editing</button>
	{/if}
</dialog>

<style>
	dialog {
		max-width: 28rem;
		padding: 1.5rem;
		border-radius: 0.5rem;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 25%);
	}
	progress {
		width: 100%;
	}
</style>
