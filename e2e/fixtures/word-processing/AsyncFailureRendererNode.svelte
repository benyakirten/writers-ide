<script lang="ts">
	import type { SvelteNodeViewProps } from '@writers-ide/word-processing/svelte';
	let { contentDOM, readFailure }: SvelteNodeViewProps & { readFailure: () => boolean } = $props();
	function label() {
		if (readFailure()) {
			throw new Error('intentional async Svelte node boundary failure');
		}
		return 'Editable paragraph';
	}
</script>

<div data-async-renderer-node>
	<span contenteditable="false">{label()}</span>
	<div use:contentDOM></div>
</div>
