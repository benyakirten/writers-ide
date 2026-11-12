<script lang="ts">
	import { createEventForwarder } from './forward-events';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import Check from '@lucide/svelte/icons/check';
	import { cn } from '$lib/utils';

	type Props = DropdownMenuPrimitive.CheckboxItemProps;

	let {
		class: className,
		checked = $bindable(false),
		indeterminate = $bindable(false),
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

<DropdownMenuPrimitive.CheckboxItem
	bind:checked
	bind:indeterminate
	class={cn(
		'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground relative flex cursor-default items-center rounded-sm py-1.5 pr-2 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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
	<span class="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
		{#if checked || indeterminate}
			<Check class="h-4 w-4" />
		{/if}
	</span>
	{@render children?.({ checked, indeterminate })}
</DropdownMenuPrimitive.CheckboxItem>
