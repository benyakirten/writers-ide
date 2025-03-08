<script lang="ts">
	import * as m from '$lib/paraglide/messages.js';
	import { X } from '@steeze-ui/phosphor-icons';
	import { Icon } from '@steeze-ui/svelte-icon';

	import type { BarItemComponentProps } from '../state/bar-item-registry.svelte.js';
	import TabState from '../state/tab-state.svelte.js';
	import { schema } from '../prosemirror/view/schema.js';
	import ProseMirrorEventBus from '../state/event-bus.svelte.js';
	import { SelectionUtilies } from '../prosemirror/view/selection.js';
	import { ActionUtilities } from '../prosemirror/view/actions.js';
	import VerticalBarState from '../state/vertical-bar-state.svelte.js';
	import FloaterBarState from '../state/floater-state.svelte.js';
	import HorizontalBarState from '../state/horizontal-bar-state.svelte.js';
	import type { BarItemData } from '../state/bar-items.svelte.js';
	import IconButton from '$lib/components/IconButton.svelte';
	import ErrorComponent from '../prosemirror/menu/ErrorComponent.svelte';

	let itemProps: BarItemComponentProps = {
		proseMirror: {
			actions: ActionUtilities,
			selections: SelectionUtilies,
			eventBus: ProseMirrorEventBus,
			schema
		},
		bars: {
			vertical: VerticalBarState,
			horizontal: HorizontalBarState,
			floater: FloaterBarState
		},
		tabs: TabState,
		internationalization: {
			translation: m
		}
	};

	let {
		Component,
		size,
		title,
		onremove
	}: {
		Component: BarItemData['Component'];
		size: BarItemData['size'];
		title: string;
		onremove: () => void;
	} = $props();
</script>

<div class="renderer" draggable style:--size={size}>
	<div class="menu">
		<p>{title}</p>
		<div class="buttons">
			<IconButton onclick={onremove} label="Remove item">
				{#snippet icon()}
					<Icon src={X} size="14px" />
				{/snippet}
			</IconButton>
		</div>
	</div>
	<div class="component">
		{#if Component}
			<Component {...itemProps} />
		{:else}
			<ErrorComponent />
		{/if}
	</div>
</div>

<style>
	.renderer {
		margin: 20px 0;
		height: calc(var(--size) * 33%);
		width: 100%;

		&:last-child {
			margin-bottom: 0;
		}
	}

	.menu {
		display: flex;
		justify-content: space-between;
		align-items: center;

		width: 80%;
		padding: 4px 8px;
		margin-left: 4px;

		border: 1px solid black;
		border-bottom: none;

		border-top-left-radius: 4px;
		border-top-right-radius: 4px;

		p {
			max-width: 80%;
			text-overflow: ellipsis;
			font-size: 12px;
			overflow: hidden;
			text-wrap: nowrap;
			white-space: nowrap;
		}
	}

	.component {
		height: 100%;
		border-top: 1px solid black;
	}
</style>
