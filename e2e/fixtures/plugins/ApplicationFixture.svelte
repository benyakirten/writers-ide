<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { FrontendContext } from '@writers-ide/plugins';
	import { defineSveltePresentation, type SveltePresentation } from '@writers-ide/plugins/svelte';
	import type { ComponentDescriptor } from '../../../packages-js/plugins/command-component-model';
	import {
		createApplicationComponentHost,
		applicationComponentPlacementId,
	} from '$lib/plugins/application-component-host.svelte';
	import Workspace from '$lib/plugins/ApplicationComponentWorkspaceFixture.svelte';
	import Registry from '$lib/editor/state/bar-item-registry.svelte';
	import TabRegistry from '$lib/editor/state/tab-state-registry.svelte';
	import TabState from '$lib/editor/state/tab-state.svelte';
	import LocaleManager from '$lib/services/locale-manager.svelte';
	import PresentationProbe from './PresentationProbe.svelte';
	import FloaterBarState from '$lib/editor/state/floater-state.svelte';
	import { BarItems } from '$lib/editor/state/bar-items.svelte';
	import type { HorizontalBar } from '$lib/editor/state/horizontal-bar-state.svelte';

	const assembly = createApplicationComponentHost();
	const { host } = assembly;
	const first = host.openProject('first', 'First');
	const second = host.openProject('second', 'Second');
	const contexts = new Map<string, FrontendContext<SveltePresentation>>();
	let events = $state<string[]>([]);
	let localeEvents = $state<string[]>([]);
	let vertical = $state(false);
	let selected = $state('first');
	let revision = $state(0);
	const generations = new Map<string, number>();
	function lifecycle(event: string): void {
		events.push(event);
	}
	function register(slotId: string, projectOpeningId: string | null): void {
		const descriptor: ComponentDescriptor<SveltePresentation> = {
			slotId,
			identity: { packageId: 'browser', componentId: slotId, projectOpeningId },
			commands: [],
			dependencies: [],
			capabilities: ['contributions.toolbar', 'contributions.view'],
			activate(context) {
				contexts.set(slotId, context);
				generations.set(slotId, (generations.get(slotId) ?? 0) + 1);
				const service = $state({
					count: 0,
					increment: () => {
						service.count++;
					},
				});
				context.locale.subscribe((snapshot) => {
					localeEvents.push(`${slotId}:${snapshot.languageTag}:${snapshot.direction}`);
				});
				context.own(() => {
					contexts.delete(slotId);
					lifecycle(`cleanup:${slotId}`);
				});
				const presentation = (kind: string, orientation: string) =>
					defineSveltePresentation(PresentationProbe, {
						label: `${slotId}-${kind}`,
						orientation,
						service,
						lifecycle,
					});
				context.contributions.toolbar({
					id: 'local',
					name: `${slotId}-toolbar`,
					horizontal: { presentation: presentation('toolbar', 'horizontal'), size: 1 },
					vertical: { presentation: presentation('toolbar', 'vertical'), size: 2 },
				});
				context.contributions.view({
					id: 'local',
					name: `${slotId}-view`,
					presentation: presentation('view', 'view'),
				});
			},
		};
		host.register(descriptor);
	}
	register('first', first.openingId);
	register('second', second.openingId);
	register('application', null);
	host.selectProject(first);
	for (const slot of ['first', 'second', 'application']) {
		host.activate(slot);
	}
	// These are host-owned workspace records, not an author-facing tab-opening API.
	const placements = host.presentations().map((record) => ({
		id: applicationComponentPlacementId(record.placementId),
		kind: record.kind,
		label: record.contribution.name,
		component: record.identity.componentId,
	}));
	const layout = new URLSearchParams(window.location.search).get('layout');
	const allToolbarIds = placements
		.filter((placement) => placement.kind === 'toolbar')
		.map((p) => p.id);
	const toolbarIds =
		layout === 'floating' ? allToolbarIds.slice(1) : layout === 'mixed' ? [] : allToolbarIds;
	const horizontalBars: HorizontalBar[] =
		layout === 'mixed'
			? [
					{
						id: 'mixed-dock',
						height: 300,
						visible: true,
						data: new BarItems(false, allToolbarIds),
					},
					{ id: 'empty-dock', height: 100, visible: true, data: new BarItems(false) },
				]
			: [];
	if (layout === 'floating' || layout === 'mixed') {
		FloaterBarState.add({
			id: 'project-floater',
			title: 'Project tools',
			data: layout === 'mixed' ? allToolbarIds : [allToolbarIds[0]],
			isVertical: false,
			left: 20,
			top: 20,
			width: 400,
			height: 360,
		});
		FloaterBarState.add({
			id: 'empty-floater',
			title: 'Empty tools',
			data: [],
			isVertical: false,
			left: 500,
			top: 20,
			width: 300,
			height: 180,
		});
	}
	function floatingSummary(): string {
		return JSON.stringify(
			FloaterBarState.bars.map((bar) => ({
				id: bar.id,
				title: bar.title,
				position: bar.position,
				vertical: bar.data.isVertical,
				ids: bar.data.ids,
			})),
		);
	}
	let records = $state(host.presentations());
	const unsubscribe = host.subscribePresentations((snapshot) => {
		records = snapshot;
		revision++;
	});
	function select(value: 'first' | 'second' | 'none'): void {
		selected = value;
		host.selectProject(value === 'first' ? first : value === 'second' ? second : null);
	}
	function open(id: string): void {
		if (!TabState.windows.some((tab) => tab.name === id)) {
			TabState.create(id, `tab:${id}`);
		}
	}
	function contextSummary(): string {
		void revision;
		return JSON.stringify(
			[...contexts].map(([slot, context]) => ({
				slot,
				keys: Object.keys(context).sort(),
				native: context.native,
				frozen: Object.isFrozen(context.native),
				generation: generations.get(slot),
				aborted: context.signal.aborted,
				project: context.project?.id ?? null,
			})),
		);
	}
	onDestroy(() => {
		unsubscribe();
		assembly.dispose();
		for (const bar of [...FloaterBarState.bars]) {
			FloaterBarState.remove(bar.id);
		}
		for (const tab of [...TabState.windows]) {
			TabState.remove(tab.id);
		}
	});
</script>

<main>
	<h1>Application component assembly</h1>
	<section aria-label="Application host controls">
		<button onclick={() => select('first')}>Select first</button>
		<button onclick={() => select('second')}>Select second</button>
		<button onclick={() => select('none')}>Select none</button>
		<button onclick={() => host.deactivate('first')}>Disable first</button>
		<button onclick={() => host.activate('first')}>Enable first</button>
		<button
			onclick={() => {
				vertical = !vertical;
			}}>Rotate toolbar</button
		>
		<button
			onclick={() => {
				LocaleManager.locale = 'fr';
			}}>Use French</button
		>
		<button
			onclick={() => {
				LocaleManager.locale = 'en';
			}}>Use English</button
		>
		<button onclick={() => register('unrelated', null)}>Register unrelated</button>
	</section>
	<section aria-label="Actual workspace records">
		{#each placements as placement (placement.id)}
			{@const registry = placement.kind === 'toolbar' ? Registry : TabRegistry}
			{@const record = records.find(
				(record) => applicationComponentPlacementId(record.placementId) === placement.id,
			)}
			<div
				data-testid={`saved-${placement.label}`}
				data-placement-id={placement.id}
				data-runtime-id={record?.id ?? ''}
				data-visible={registry.isVisible(placement.id)}
				data-registered={Boolean(registry.items[placement.id])}
				data-horizontal-size={placement.kind === 'toolbar'
					? Registry.size(placement.id, false)
					: undefined}
				data-vertical-size={placement.kind === 'toolbar'
					? Registry.size(placement.id, true)
					: undefined}
			>
				{placement.label}
				{#if placement.kind === 'view'}
					<button onclick={() => open(placement.id)}>Open {placement.label}</button>
				{/if}
			</div>
		{/each}
	</section>
	<section aria-label="Production workspace">
		<Workspace
			{toolbarIds}
			{vertical}
			{horizontalBars}
			floatingBars={FloaterBarState.visibleBars}
		/>
	</section>
	<output data-testid="floating-layout">{floatingSummary()}</output>
	<output data-testid="tabs">{JSON.stringify(TabState.windows)}</output>
	<output data-testid="contexts">{contextSummary()}</output>
	<output data-testid="locale-events">{localeEvents.join(' | ')}</output>
	<output data-testid="locale">{LocaleManager.locale}</output>
	<output data-testid="events">{events.join(' | ')}</output>
	<output data-testid="errors">{assembly.errors.length}</output>
	<output data-testid="selected">{selected}</output>
	<output data-testid="singletons"
		>{assembly.bars === Registry && assembly.views === TabRegistry ? 'shared' : 'different'}</output
	>
</main>

<style>
	main {
		font-family: sans-serif;
	}
	section {
		margin-bottom: 1rem;
	}
	section[aria-label='Production workspace'] {
		width: 1100px;
		position: relative;
		min-height: 600px;
	}
	output {
		display: block;
		overflow-wrap: anywhere;
	}
</style>
