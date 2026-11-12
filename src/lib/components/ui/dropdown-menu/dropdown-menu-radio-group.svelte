<script lang="ts">
	import { DropdownMenu as DropdownMenuPrimitive } from 'bits-ui';

	type Props = DropdownMenuPrimitive.RadioGroupProps;

	let { value = $bindable(''), children, ...restProps }: Props = $props();
</script>

<DropdownMenuPrimitive.RadioGroup {...restProps} bind:value>
	{@render children?.()}
</DropdownMenuPrimitive.RadioGroup>
