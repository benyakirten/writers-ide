<script lang="ts">
	import { createEventForwarder } from './forward-events';
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';
	import type { TransitionConfig } from 'svelte/transition';
	import { cn, flyAndScale } from '$lib/utils';

	type Props = Omit<DropdownMenuPrimitive.ContentProps, 'child'> & {
		portal?: DropdownMenuPrimitive.PortalProps['to'] | false;
		transition?: (node: Element, params?: Parameters<typeof flyAndScale>[1]) => TransitionConfig;
		transitionConfig?: Parameters<typeof flyAndScale>[1];
	};

	let {
		class: className,
		portal = undefined,
		forceMount = false,
		sideOffset = 4,
		transition = flyAndScale,
		transitionConfig = undefined,
		onkeydown,
		children,
		...restProps
	}: Props = $props();

	type $$Events = {
		keydown: KeyboardEvent;
	};

	const forward = createEventForwarder();
</script>

<DropdownMenuPrimitive.Portal
	to={portal === false ? undefined : portal}
	disabled={portal === false}
>
	<DropdownMenuPrimitive.Content
		forceMount
		{sideOffset}
		class={cn(
			'bg-popover text-popover-foreground z-50 min-w-[8rem] rounded-md border p-1 shadow-md focus:outline-none',
			className,
		)}
		{...restProps}
		onkeydown={forward('keydown', onkeydown)}
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
	</DropdownMenuPrimitive.Content>
</DropdownMenuPrimitive.Portal>
