<script lang="ts">
	let { mode, fail }: { mode: 'render' | 'effect'; fail: boolean } = $props();

	function content() {
		if (mode === 'render' && fail) {
			throw new Error('Private plugin render failure');
		}
		return 'Recovered plugin tooltip';
	}

	$effect(() => {
		if (mode === 'effect' && fail) {
			throw new Error('Private plugin effect failure');
		}
	});
</script>

<span>{content()}</span>
