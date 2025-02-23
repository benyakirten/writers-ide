<script lang="ts">
	let { size = 16 }: { size?: number | string } = $props();
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	<path d="M3 4h12" />
	<!-- Thinner, shorter top line -->
	<path d="M3 12h12" />
	<!-- Middle line matches top/bottom length -->
	<path d="M3 20h12" />
	<!-- Thinner, shorter bottom line -->
	<path d="M6 9l-3 3 3 3" />
	<!-- Left-pointing arrow at the far left -->
</svg>
