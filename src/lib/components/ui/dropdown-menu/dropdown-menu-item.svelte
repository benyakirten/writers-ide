<script lang="ts">
	import { createEventForwarder } from './forward-events';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import { cn } from '$lib/utils';

	type Props = DropdownMenuPrimitive.ItemProps & {
		inset?: boolean;
	};

	let {
		class: className,
		inset = undefined,
		onclick,
		onkeydown,
		onfocusin,
		onfocusout,
		onpointerdown,
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
		pointerdown: PointerEvent;
		pointerleave: PointerEvent;
		pointermove: PointerEvent;
	};

	const forward = createEventForwarder();
</script>

<DropdownMenuPrimitive.Item
	class={cn(
		'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		inset && 'pl-8',
		className,
	)}
	{...restProps}
	onclick={forward('click', onclick)}
	onkeydown={forward('keydown', onkeydown)}
	onfocusin={forward('focusin', onfocusin)}
	onfocusout={forward('focusout', onfocusout)}
	onpointerdown={forward('pointerdown', onpointerdown)}
	onpointerleave={forward('pointerleave', onpointerleave)}
	onpointermove={forward('pointermove', onpointermove)}
>
	{@render children?.()}
</DropdownMenuPrimitive.Item>
