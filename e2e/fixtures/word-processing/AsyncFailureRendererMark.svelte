<script lang="ts">
	import type { SvelteMarkViewProps } from '@writers-ide/word-processing/svelte';
	let { contentDOM, readFailure }: SvelteMarkViewProps & { readFailure: () => boolean } = $props();
	function label() {
		if (readFailure()) {
			throw new Error('intentional async Svelte mark boundary failure');
		}
		return 'Strong';
	}
</script>

<span data-async-renderer-mark>
	<span contenteditable="false">{label()}</span>
	<span use:contentDOM></span>
</span>
