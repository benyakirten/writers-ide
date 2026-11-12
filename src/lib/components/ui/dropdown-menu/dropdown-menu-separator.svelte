<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	type Props = DropdownMenuPrimitive.SeparatorProps;

	let { class: className, children, ...restProps }: Props = $props();
</script>

<DropdownMenuPrimitive.Separator class={cn('bg-muted -mx-1 my-1 h-px', className)} {...restProps} />
