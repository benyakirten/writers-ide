<script lang="ts">
	import * as Menu from './index';

	let {
		onlegacyclick,
		onclick,
		onValueChange,
		onCheckedChange,
		onDisabledSelect,
	}: {
		onlegacyclick?: (event: MouseEvent) => void;
		onclick?: (event: MouseEvent) => void;
		onValueChange?: (value: string) => void;
		onCheckedChange?: (value: boolean) => void;
		onDisabledSelect?: (event: Event) => void;
	} = $props();
	let value = $state('first');
	let checked = $state(false);
</script>

<Menu.Root open>
	<Menu.Trigger>Options</Menu.Trigger>
	<Menu.Content transitionConfig={{ duration: 0 }} class="custom-content">
		<Menu.Label inset>Standalone label</Menu.Label>
		<Menu.Item on:click={(event) => onlegacyclick?.(event)} {onclick}>Action</Menu.Item>
		<Menu.Item disabled onSelect={onDisabledSelect}>Disabled</Menu.Item>
		<Menu.CheckboxItem bind:checked {onCheckedChange} closeOnSelect={false}>
			Checkbox
		</Menu.CheckboxItem>
		<Menu.RadioGroup bind:value {onValueChange}>
			<Menu.RadioItem value="first" closeOnSelect={false}>First</Menu.RadioItem>
			<Menu.RadioItem value="second" closeOnSelect={false}>Second</Menu.RadioItem>
		</Menu.RadioGroup>
		<Menu.Sub>
			<Menu.SubTrigger>More</Menu.SubTrigger>
			<Menu.SubContent transitionConfig={{ duration: 0 }}>
				<Menu.Item>Nested action</Menu.Item>
			</Menu.SubContent>
		</Menu.Sub>
	</Menu.Content>
</Menu.Root>
<output data-value>{value}</output>
<output data-checked>{String(checked)}</output>
