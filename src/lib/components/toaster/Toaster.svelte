<script lang="ts">
	import { MAX_Z_INDEX } from '$lib/constants';
	import ToastManager from '$lib/services/toaster.svelte';
	import Toast from './Toast.svelte';
</script>

<ul style:--toast-z={MAX_Z_INDEX - 1} aria-live="polite" aria-atomic="true">
	{#each ToastManager.toasts as toast (toast.id)}
		<Toast {toast} />
	{/each}
</ul>

<style>
	ul {
		position: absolute;
		top: 60px;
		left: 100px;
		z-index: var(--toast-z);

		display: grid;
		gap: 8px;
	}
</style>
