<script lang="ts">
	let { size = 16 }: { size?: number | string; title?: string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.5"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<path d="M3 4h12" />
	<path d="M3 12h10" />
	<path d="M3 20h12" />
	<path d="M12 9l3 3-3 3" />
</svg>
