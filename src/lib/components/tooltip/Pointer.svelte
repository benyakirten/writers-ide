<script lang="ts">
	import { Pointer } from '@writers-ide/components';
	import TooltipManager from '$lib/services/tooltip.svelte';
	import { MAX_Z_INDEX } from '$lib/constants';
</script>

<Pointer manager={TooltipManager} zIndex={MAX_Z_INDEX} />
