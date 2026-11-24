<script lang="ts">
	import { onDestroy } from 'svelte';
	import { TooltipProvider } from '@writers-ide/components';
	import { defineSveltePresentation, type SveltePresentation } from '@writers-ide/plugins/svelte';
	import {
		CommandComponentHost,
		type PresentationRecord,
	} from '../../../packages-js/plugins/command-component-host';
	import type { ComponentDescriptor } from '../../../packages-js/plugins/command-component-model';
	import PresentationPlacement from './PresentationPlacement.svelte';
	import PresentationProbe from './PresentationProbe.svelte';

	type Record = PresentationRecord<SveltePresentation>;
	type Placement = { id: string; label: string; kind: Record['kind'] };
	const host = new CommandComponentHost<SveltePresentation>({
		locale: {
			snapshot: () => ({ languageTag: 'en-US', direction: 'ltr' }),
			subscribe: () => () => {},
		},
	});
	const first = host.openProject('first', 'First');
	const second = host.openProject('second', 'Second');
	let records = $state<readonly Record[]>(host.presentations());
	let placements = $state<Placement[]>([]);
	let openTabs = $state<string[]>([]);
	let orientation = $state<'horizontal' | 'vertical'>('horizontal');
	const eventLog: string[] = [];
	let events = $state<readonly string[]>([]);
	function recordEvent(event: string): void {
		eventLog.push(event);
		events = [...eventLog];
	}
	let serviceResult = $state('');
	let activationResult = $state('');
	let selected = $state('first');
	const services = new Map<string, () => string>();
	const generations = new Map<string, number>();
	const unsubscribe = host.subscribePresentations((snapshot) => {
		records = snapshot;
		for (const record of snapshot) {
			if (!placements.some((placement) => placement.id === record.placementId)) {
				placements.push({
					id: record.placementId,
					label: record.contribution.name,
					kind: record.kind,
				});
			}
		}
	});

	function register(
		slotId: string,
		projectOpeningId: string | null,
		fail = false,
		rollback = false,
	): void {
		const descriptor: ComponentDescriptor<SveltePresentation> = {
			slotId,
			identity: { packageId: 'fixture', componentId: slotId, projectOpeningId },
			commands: [],
			dependencies: [],
			capabilities: ['contributions.toolbar', 'contributions.view'],
			activate(context) {
				const generation = (generations.get(slotId) ?? 0) + 1;
				generations.set(slotId, generation);
				const service = $state({
					count: 0,
					increment: () => {
						service.count++;
					},
				});
				services.set(slotId, () => {
					service.increment();
					return `${slotId}:${generation}:${service.count}:${context.signal.aborted}:${context.locale.snapshot().languageTag}`;
				});
				context.own(() => {
					services.delete(slotId);
					recordEvent(`cleanup:${slotId}`);
				});
				const presentation = (kind: string, direction: string) =>
					defineSveltePresentation(PresentationProbe, {
						label: `${slotId}-${kind}`,
						orientation: direction,
						service,
						fail,
						lifecycle: recordEvent,
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
				if (rollback) {
					throw new Error('Intentional activation rollback');
				}
			},
		};
		host.register(descriptor);
	}
	register('first', first.openingId);
	register('peer', first.openingId);
	register('second', second.openingId);
	register('application', null);
	register('broken', first.openingId, true);
	register('rollback', first.openingId, false, true);
	host.selectProject(first);
	for (const slot of ['first', 'peer', 'second', 'application']) {
		host.activate(slot);
	}

	function select(project: 'first' | 'second' | 'none'): void {
		selected = project;
		host.selectProject(project === 'first' ? first : project === 'second' ? second : null);
	}
	function activate(slot: string): void {
		try {
			const result = host.activate(slot);
			activationResult = `${result.status}:${result.errors.join(' | ')}`;
		} catch (error) {
			activationResult = String(error);
		}
	}
	function open(id: string): void {
		if (!openTabs.includes(id)) {
			openTabs.push(id);
		}
	}
	onDestroy(() => {
		unsubscribe();
		host.dispose();
	});
</script>

<main>
	<h1>Internal presentation fixture workspace</h1>
	<p>This dedicated test workspace is not the application workspace adapter.</p>
	<section aria-label="Host controls">
		<button onclick={() => select('first')}>Select first</button>
		<button onclick={() => select('second')}>Select second</button>
		<button onclick={() => select('none')}>Select none</button>
		<button onclick={() => host.deactivate('first')}>Disable first</button>
		<button onclick={() => activate('first')}>Enable first</button>
		<button onclick={() => activate('rollback')}>Activate rollback</button>
		<button onclick={() => activate('broken')}>Activate broken</button>
		<button
			onclick={() => {
				orientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
			}}>Rotate toolbar</button
		>
		<button
			onclick={() => {
				serviceResult = services.get('first')?.() ?? 'Unavailable';
			}}>Call first service</button
		>
		<output data-testid="selected">{selected}</output>
		<output data-testid="service-result">{serviceResult}</output>
		<output data-testid="activation-result">{activationResult}</output>
	</section>
	<section aria-label="Saved workspace records">
		{#each placements as placement (placement.id)}
			<div data-testid={`saved-${placement.label}`} data-placement-id={placement.id}>
				{placement.label}
				{#if placement.kind === 'view'}
					<button onclick={() => open(placement.id)}>Open {placement.label}</button>
					<output data-testid={`tab-${placement.label}`}
						>{openTabs.includes(placement.id) ? 'open' : 'closed'}</output
					>
				{/if}
			</div>
		{/each}
	</section>
	<TooltipProvider>
		<section aria-label="Fixture toolbars">
			{#each records.filter((record) => record.visible && record.kind === 'toolbar') as record (record.id)}
				<PresentationPlacement {record} {orientation} />
			{/each}
		</section>
		<section aria-label="Fixture open views">
			{#each records.filter((record) => record.visible && record.kind === 'view' && openTabs.includes(record.placementId)) as record (record.id)}
				<PresentationPlacement {record} {orientation} />
			{/each}
		</section>
	</TooltipProvider>
	<output data-testid="events">{events.join(' | ')}</output>
</main>
