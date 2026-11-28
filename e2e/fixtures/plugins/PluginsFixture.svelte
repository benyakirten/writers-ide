<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		definePluginApi,
		type BundledPlugin,
		type CommandContribution,
		type PluginDependency,
		type PluginManifest,
	} from '@writers-ide/plugins';
	import PluginManager from '../../../src/lib/plugins/PluginManager.svelte';
	import { PluginHost } from '../../../src/lib/plugins/plugin-host';

	interface ExampleApi {
		read(): string;
	}
	const exampleApi = definePluginApi<ExampleApi>({ id: 'example.messages', major: 1 });
	let generation = 0;
	let currentConsumer: ExampleApi | null = null;
	let staleConsumer: ExampleApi | null = null;
	let currentOptional: ExampleApi | null = null;
	let staleOptional: ExampleApi | null = null;
	let command: CommandContribution | null = null;
	let protectedConsumer = $state(false);
	let callResult = $state('Not called');
	let calls = $state<string[]>([]);
	let cleanup = $state<string[]>([]);
	let connections = $state<string[]>([]);
	let optionalEvents = $state<string[]>([]);
	let cachedGet = $state(false);
	let freshConsumer = $state(false);
	let freshOptional = $state(false);

	const host = new PluginHost<never>({
		registries: {
			toolbar: { register: () => () => {} },
			view: { register: () => () => {} },
			command: {
				register: (_ownerId, contribution) => {
					command = contribution;
					return () => {
						command = null;
					};
				},
			},
		},
	});

	function dependency(optional = false): PluginDependency {
		return { provider: 'example.provider', api: exampleApi.id, major: 1, optional };
	}

	function plugin(
		id: string,
		name: string,
		activate: BundledPlugin<never>['activate'],
		metadata: Partial<Pick<PluginManifest, 'capabilities' | 'provides' | 'dependencies'>>,
	): BundledPlugin<never> {
		return {
			manifest: {
				id,
				name,
				version: '1.0.0',
				apiVersion: 1,
				description: `${name} browser fixture plugin.`,
				capabilities: [],
				...metadata,
			},
			activate,
		};
	}

	// Register the consumer first so activation must resolve the provider, not registration order.
	host.register(
		plugin(
			'example.consumer',
			'Required consumer',
			(context) => {
				const api = context.apis.get('example.provider', exampleApi);
				if (!api) {
					throw new Error('Required provider API was not resolved');
				}
				currentConsumer = api;
				staleConsumer ??= api;
				freshConsumer = api !== staleConsumer;
				cachedGet = context.apis.get('example.provider', exampleApi) === api;
				context.contributions.command({
					id: 'example.consumer.read',
					name: 'Read provider',
					execute: () => {
						callResult = api.read();
						return true;
					},
				});
				context.own(() => cleanup.push('example.consumer'));
			},
			{ capabilities: ['contributions.command'], dependencies: [dependency()] },
		),
	);

	host.register(
		plugin(
			'example.provider',
			'Example provider',
			(context) => {
				generation++;
				const activeGeneration = generation;
				context.apis.provide(exampleApi, (connection) => {
					connection.own(() =>
						connections.push(`${connection.consumerId}:aborted=${connection.signal.aborted}`),
					);
					return {
						read: () => {
							const value = `${connection.consumerId}@${activeGeneration}`;
							calls.push(value);
							return value;
						},
					};
				});
				context.own(() => cleanup.push('example.provider'));
			},
			{ provides: [exampleApi] },
		),
	);

	host.register(
		plugin(
			'example.optional',
			'Optional consumer',
			(context) => {
				context.apis.subscribe('example.provider', exampleApi, (api) => {
					currentOptional = api;
					if (api) {
						staleOptional ??= api;
						freshOptional = api !== staleOptional;
						optionalEvents.push(`available:${api.read()}`);
					} else {
						optionalEvents.push('null');
					}
				});
			},
			{ dependencies: [dependency(true)] },
		),
	);

	for (const [id, name, required] of [
		['example.missing', 'Missing dependency', { ...dependency(), provider: 'example.absent' }],
		['example.incompatible', 'Incompatible dependency', { ...dependency(), major: 2 }],
	] as const) {
		host.register(
			plugin(
				id,
				name,
				() => {
					throw new Error('Unresolved dependency must prevent activation');
				},
				{ dependencies: [required] },
			),
		);
	}

	function invoke(api: ExampleApi | null): void {
		try {
			callResult = api ? api.read() : 'No handle';
		} catch (error) {
			callResult = error instanceof Error ? error.message : String(error);
		}
	}

	function runCommand(): void {
		callResult = command ? String(command.execute()) + ': ' + callResult : 'No command';
	}

	onDestroy(() => {
		host.deactivate('example.provider', { cascade: true });
		host.deactivate('example.optional');
	});
</script>

<main>
	<h1>Plugin dependencies fixture</h1>
	<section aria-label="Fixture controls">
		<label
			><input type="checkbox" bind:checked={protectedConsumer} />Protect required consumer</label
		>
		<button onclick={runCommand}>Run contributed command</button>
		<button onclick={() => invoke(currentConsumer)}>Call current consumer handle</button>
		<button onclick={() => invoke(staleConsumer)}>Call stale consumer handle</button>
		<button onclick={() => invoke(currentOptional)}>Call current optional handle</button>
		<button onclick={() => invoke(staleOptional)}>Call stale optional handle</button>
		<dl>
			<dt>Call result</dt>
			<dd><output data-testid="call-result">{callResult}</output></dd>
			<dt>Calls</dt>
			<dd><output data-testid="calls">{calls.join(' | ')}</output></dd>
			<dt>Cleanup order</dt>
			<dd><output data-testid="cleanup">{cleanup.join(' | ')}</output></dd>
			<dt>Connection cleanup</dt>
			<dd><output data-testid="connections">{connections.join(' | ')}</output></dd>
			<dt>Optional events</dt>
			<dd><output data-testid="optional-events">{optionalEvents.join(' | ')}</output></dd>
			<dt>Repeated get shares handle</dt>
			<dd><output data-testid="cached-get">{String(cachedGet)}</output></dd>
			<dt>Fresh consumer handle</dt>
			<dd><output data-testid="fresh-consumer">{String(freshConsumer)}</output></dd>
			<dt>Fresh optional handle</dt>
			<dd><output data-testid="fresh-optional">{String(freshOptional)}</output></dd>
		</dl>
	</section>
	<PluginManager
		management={host}
		requiredPluginIds={protectedConsumer ? ['example.consumer'] : []}
	/>
</main>
