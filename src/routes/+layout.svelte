<script lang="ts">
	import '../app.css';
	import './global.css';
	import { getLocale } from '$lib/paraglide/runtime';
	import Shortcuts from '$lib/services/shortcuts.svelte';

	let { children } = $props();

	$effect.pre(() => {
		document.documentElement.lang = getLocale();
		document.documentElement.dir = 'ltr';
	});
</script>

<svelte:window onkeydown={(e) => Shortcuts.listen(e)} onkeyup={(e) => Shortcuts.listen(e)} />
{@render children()}
