<script module lang="ts">
	export interface ArgumentsArgs {
		label?: string;
		enabled?: boolean;
		amount?: number;
		optional?: string | null;
	}
</script>

<script lang="ts">
	let {
		label = 'default',
		enabled = true,
		amount = 1,
		optional = 'default',
	}: ArgumentsArgs = $props();
</script>

<output data-testid="arguments">{JSON.stringify({ label, enabled, amount, optional })}</output>
