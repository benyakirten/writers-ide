<script lang="ts">
	import { PageObserver } from '$lib/editor/state/page-observer.svelte';
	import Modal from '../Modal.svelte';

	let open = $state(false);
</script>

<Modal {open} />
