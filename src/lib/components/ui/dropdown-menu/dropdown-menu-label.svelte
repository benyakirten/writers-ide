<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	type Props = HTMLAttributes<HTMLDivElement> & {
		inset?: boolean;
		children?: Snippet;
		ref?: HTMLDivElement | null;
	};

	let { class: className, inset, children, ref = $bindable(null), ...restProps }: Props = $props();
</script>

<!-- Unlike Bits 2 GroupHeading, the existing Label API also works outside a Group. -->
<div
	bind:this={ref}
	class={cn('px-2 py-1.5 text-sm font-semibold', inset && 'pl-8', className)}
	{...restProps}
>
	{@render children?.()}
</div>
