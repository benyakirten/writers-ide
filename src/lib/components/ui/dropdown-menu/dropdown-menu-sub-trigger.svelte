<script lang="ts">
	import { createEventForwarder } from './forward-events';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import { cn } from '$lib/utils';

	type Props = DropdownMenuPrimitive.SubTriggerProps & {
		inset?: boolean;
	};

	let {
		class: className,
		inset = undefined,
		onclick,
		onkeydown,
		onfocusin,
		onfocusout,
		onpointerleave,
		onpointermove,
		children,
		...restProps
	}: Props = $props();

	type $$Events = {
		click: MouseEvent;
		keydown: KeyboardEvent;
		focusin: FocusEvent;
		focusout: FocusEvent;
		pointerleave: PointerEvent;
		pointermove: PointerEvent;
	};

	const forward = createEventForwarder();
</script>

<DropdownMenuPrimitive.SubTrigger
	class={cn(
		'data-[highlighted]:bg-accent data-[state=open]:bg-accent data-[highlighted]:text-accent-foreground data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none',
		inset && 'pl-8',
		className,
	)}
	{...restProps}
	onclick={forward('click', onclick)}
	onkeydown={forward('keydown', onkeydown)}
	onfocusin={forward('focusin', onfocusin)}
	onfocusout={forward('focusout', onfocusout)}
	onpointerleave={forward('pointerleave', onpointerleave)}
	onpointermove={forward('pointermove', onpointermove)}
>
	{@render children?.()}
	<ChevronRight class="ml-auto h-4 w-4" />
</DropdownMenuPrimitive.SubTrigger>
