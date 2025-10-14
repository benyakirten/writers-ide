<script lang="ts">
	import { PageObserver, type ObservedPage } from '$lib/editor/state/page-observer.svelte';

	function getViewsThatNeedPagination(map: Record<string, ObservedPage>) {
		return Object.entries(map)
			.filter(([_, data]) => data.viewedPage > data.paginatedTo)
			.map(([id]) => id);
	}

	let idsToPaginate = $derived.by(() => getViewsThatNeedPagination(PageObserver.map));
</script>
