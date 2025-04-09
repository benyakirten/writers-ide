<script lang="ts">
	import type { Snippet } from 'svelte';

	let {}: { message: string | Snippet; timeLeft: number | null; ondismiss: (() => void) | null } =
		$props();
</script>

<div class="toast">THIS IS A TOAST;</div>

<style>
	.toast {
		background: #333;
		border: 1px solid black;
	}
</style>
