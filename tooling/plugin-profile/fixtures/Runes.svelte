<script>
	import { writable } from 'svelte/store';
	import { createAttachmentKey } from 'svelte/attachments';
	import { fade } from 'svelte/transition';
	let { children, pending = Promise.resolve('ready') } = $props();
	let count = $state(0);
	const doubled = $derived(count * 2);
	const store = writable('store');
	const attachment = { [createAttachmentKey()]: () => () => {} };
	$effect(() => {
		$inspect.trace();
		document.title = String(doubled);
	});
</script>

{#snippet label(value)}<span>{value}</span>{/snippet}
<svelte:boundary>
	<button {...attachment} onclick={() => count++}>{doubled} {$store}</button>
	{#if count}<p transition:fade>{@render label(count)}</p>{/if}
	{#each [count] as item (item)}<span>{item}</span>{/each}
	{#await pending}<p>pending</p>{:then value}<p>{value}</p>{:catch error}<p>
			{String(error)}
		</p>{/await}
	{@render children?.()}
	{#snippet failed(error, reset)}<button onclick={reset}>{String(error)}</button>{/snippet}
</svelte:boundary>
