<script lang="ts">
	import { createEventForwarder } from './forward-events';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import Circle from '@lucide/svelte/icons/circle';
	import { cn } from '$lib/utils';

	type Props = DropdownMenuPrimitive.RadioItemProps;

	let {
		class: className,
		value,
		onclick,
		onkeydown,
		onfocusin,
		onfocusout,
		onpointerdown,
		onpointerleave,
		onpointermove,
		children: childrenContent,
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

<DropdownMenuPrimitive.RadioItem
	class={cn(
		'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
		className,
	)}
	{value}
	{...restProps}
	onclick={forward('click', onclick)}
	onkeydown={forward('keydown', onkeydown)}
	onfocusin={forward('focusin', onfocusin)}
	onfocusout={forward('focusout', onfocusout)}
	onpointerdown={forward('pointerdown', onpointerdown)}
	onpointerleave={forward('pointerleave', onpointerleave)}
	onpointermove={forward('pointermove', onpointermove)}
>
	{#snippet children({ checked })}
		<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
			{#if checked}
				<Circle class="h-2 w-2 fill-current" />
			{/if}
		</span>
		{@render childrenContent?.({ checked })}
	{/snippet}
</DropdownMenuPrimitive.RadioItem>
