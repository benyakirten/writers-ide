<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	type Props = HTMLAttributes<HTMLSpanElement>;

	let { class: className, children, ...restProps }: Props = $props();
</script>

<span class={cn('ml-auto text-xs tracking-widest opacity-60', className)} {...restProps}>
	{@render children?.()}
</span>
