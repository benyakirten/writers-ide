<script lang="ts">
	import { createEventForwarder } from './forward-events';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { TransitionConfig } from 'svelte/transition';
	import { cn, flyAndScale } from '$lib/utils';

	type Props = Omit<DropdownMenuPrimitive.SubContentProps, 'child'> & {
		portal?: DropdownMenuPrimitive.PortalProps['to'] | false;
		transition?: (node: Element, params?: Parameters<typeof flyAndScale>[1]) => TransitionConfig;
		transitionConfig?: Parameters<typeof flyAndScale>[1];
	};

	let {
		class: className,
		portal = undefined,
		forceMount = false,
		transition = flyAndScale,
		transitionConfig = {
			x: -10,
			y: 0,
		},
		onkeydown,
		onfocusout,
		onpointermove,
		children,
		...restProps
	}: Props = $props();

	type $$Events = {
		keydown: KeyboardEvent;
		focusout: FocusEvent;
		pointermove: PointerEvent;
	};

	const forward = createEventForwarder();
</script>

<DropdownMenuPrimitive.Portal
	to={portal === false ? undefined : portal}
	disabled={portal === false}
>
	<DropdownMenuPrimitive.SubContent
		forceMount
		class={cn(
			'bg-popover text-popover-foreground z-50 min-w-[8rem] rounded-md border p-1 shadow-lg focus:outline-none',
			className,
		)}
		{...restProps}
		onkeydown={forward('keydown', onkeydown)}
		onfocusout={forward('focusout', onfocusout)}
		onpointermove={forward('pointermove', onpointermove)}
	>
		{#snippet child({ props, wrapperProps, open })}
			<div {...wrapperProps}>
				{#if open || forceMount}
					<div {...props} transition:transition={transitionConfig}>
						{@render children?.()}
					</div>
				{/if}
			</div>
		{/snippet}
	</DropdownMenuPrimitive.SubContent>
</DropdownMenuPrimitive.Portal>
