<script lang="ts">
	import '../app.css';
	import './global.css';
	import { ParaglideJS } from '@inlang/paraglide-sveltekit';

	import { i18n } from '$lib/i18n';
	import Shortcuts from '$lib/services/shortcuts.svelte';

	let { children } = $props();
</script>

<svelte:window onkeydown={(e) => Shortcuts.listen(e)} onkeyup={(e) => Shortcuts.listen(e)} />
<ParaglideJS {i18n}>
	{@render children()}
</ParaglideJS>
