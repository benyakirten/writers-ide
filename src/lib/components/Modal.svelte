<script lang="ts">
	import type { Snippet } from 'svelte';

	let { open, onclose, children } = $props<{
		open: boolean;
		onclose: () => void;
		children: Snippet;
	}>();
</script>

<dialog {open}>
	<div>
		<button aria-label="Close modal" onclick={onclose}> </button>
	</div>
	<div>
		{@render children()}
	</div>
</dialog>

<style>
	dialog {
		display: flex;

		div:first-child {
			display: flex;
			justify-content: flex-end;
		}

		div:last-child {
			flex: 1;
		}
	}

	dialog::backdrop {
		backdrop-filter: blur(4px);
	}
</style>
