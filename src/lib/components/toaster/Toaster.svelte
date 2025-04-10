<script lang="ts">
	import { MAX_Z_INDEX } from '$lib/constants';
	import ToastManager from '@/services/toaster.svelte';
	import Toast from './Toast.svelte';
</script>

<ul style:--toast-z={MAX_Z_INDEX - 1}>
	{#each ToastManager.toasts as toast (toast.id)}
		<Toast
			message={toast.message}
			timeLeft={toast.timeLeft}
			duration={toast.duration}
			ondismiss={toast.dismissable ? () => ToastManager.removeToast(toast.id) : null}
		/>
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
