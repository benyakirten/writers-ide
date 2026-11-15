<script lang="ts">
	import { tick } from 'svelte';
	import type { PluginCapability, PluginInfo, PluginManagementService } from '@writers-ide/plugins';

	let {
		management,
		requiredPluginIds = [],
	}: {
		management: PluginManagementService;
		requiredPluginIds?: readonly string[];
	} = $props();

	const panelId = $props.id();
	const explanations: Record<PluginCapability, string> = {
		'contributions.toolbar': 'Provide toolbar controls in the workbench.',
		'contributions.view': 'Provide a central workspace view.',
		'contributions.command': 'Provide actions the host can invoke.',
	};
	const statuses = {
		disabled: 'Disabled',
		activating: 'Enabling…',
		active: 'Enabled',
		deactivating: 'Disabling…',
		failed: 'Failed',
	};
	let plugins = $state<readonly PluginInfo[]>([]);
	let serviceError = $state('');
	let actionErrors = $state<Record<string, string>>({});
	let pendingId = $state<string | null>(null);
	let confirmation = $state.raw<{
		id: string;
		ids: readonly string[];
		service: PluginManagementService;
	} | null>(null);
	let launcher: HTMLButtonElement | null = null;
	let cancelButton = $state<HTMLButtonElement>();
	const errorLabels = {
		activation: 'Activation',
		cleanup: 'Cleanup',
		task: 'Task',
		dependency: 'Dependency',
		provider: 'Provider',
	};
	const protectedCascade = $derived(
		confirmation?.ids.some((id) => requiredPluginIds.includes(id)) ?? false,
	);

	function message(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	$effect(() => {
		const service = management;
		serviceError = '';
		actionErrors = {};
		confirmation = null;
		plugins = [];
		try {
			plugins = service.list();
			const unsubscribe = service.subscribe((snapshot) => {
				plugins = snapshot;
			});
			return () => {
				try {
					unsubscribe();
				} catch (error) {
					serviceError = `Unable to release plugin subscription: ${message(error)}`;
				}
			};
		} catch (error) {
			serviceError = message(error);
		}
	});

	function restoreLauncher(): void {
		const button = launcher;
		void tick().then(() => {
			if (confirmation === null && button?.isConnected) {
				button.focus();
			}
		});
	}

	function cancelDisable(): void {
		confirmation = null;
		restoreLauncher();
	}

	async function requestConfirmation(id: string, ids: readonly string[]): Promise<void> {
		const request = { id, ids, service: management };
		confirmation = request;
		await tick();
		if (confirmation === request) {
			cancelButton?.focus();
		}
	}

	function confirmDisable(): void {
		const request = confirmation;
		if (!request || pendingId !== null || request.service !== management) {
			return;
		}
		try {
			const ids = management.planDeactivation(request.id);
			if (ids.some((id) => requiredPluginIds.includes(id))) {
				actionErrors[request.id] = 'This would disable a plugin required by the host.';
				return;
			}
			if (ids.length !== request.ids.length || ids.some((id, index) => id !== request.ids[index])) {
				actionErrors[request.id] =
					'Dependencies changed. Review the updated list and confirm again.';
				void requestConfirmation(request.id, ids);
				return;
			}
			pendingId = request.id;
			actionErrors[request.id] = '';
			management.deactivate(request.id, { cascade: true });
			plugins = management.list();
			confirmation = null;
			restoreLauncher();
		} catch (error) {
			actionErrors[request.id] = message(error);
		} finally {
			pendingId = null;
		}
	}

	function change(plugin: PluginInfo, button: HTMLButtonElement): void {
		const id = plugin.manifest.id;
		if (
			pendingId !== null ||
			confirmation !== null ||
			plugin.status === 'activating' ||
			plugin.status === 'deactivating' ||
			(plugin.status === 'active' && requiredPluginIds.includes(id))
		) {
			return;
		}
		pendingId = id;
		actionErrors[id] = '';
		try {
			if (plugin.status === 'active') {
				const ids = management.planDeactivation(id);
				if (ids.some((affected) => requiredPluginIds.includes(affected))) {
					throw new Error('This would disable a plugin required by the host.');
				}
				if (ids.length > 1) {
					launcher = button;
					void requestConfirmation(id, ids);
					return;
				}
				management.deactivate(id);
			} else {
				management.activate(id);
			}
			plugins = management.list();
		} catch (error) {
			actionErrors[id] = message(error);
		} finally {
			pendingId = null;
		}
	}
</script>

<section aria-labelledby={`${panelId}-heading`} class="plugin-manager">
	<h2 id={`${panelId}-heading`}>Plugin manager</h2>
	<p>
		These are trusted bundled plugins running in-process. They are not sandboxed; declared
		capabilities do not restrict their ambient JavaScript access.
	</p>
	<p>Disabling a plugin removes its active contributions, not its saved data.</p>
	{#if serviceError}
		<p role="alert">
			Unable to load plugins: {serviceError}. Close and reopen this panel to retry.
		</p>
	{:else if plugins.length === 0}
		<p>No bundled plugins are registered.</p>
	{/if}
	{#if confirmation}
		<section
			class="disable-confirmation"
			role="group"
			aria-labelledby={`${panelId}-confirm-heading`}
		>
			<h3 id={`${panelId}-confirm-heading`}>Confirm dependent plugin disable</h3>
			<p>These plugins will be disabled in this order. Their saved data will be preserved.</p>
			<ul>
				{#each confirmation.ids as id}
					<li>
						{plugins.find((plugin) => plugin.manifest.id === id)?.manifest.name ?? id} (<code
							>{id}</code
						>)
					</li>
				{/each}
			</ul>
			{#if protectedCascade}
				<p role="alert">This would disable a plugin required by the host. Cancel to return.</p>
			{/if}
			<button
				type="button"
				disabled={pendingId !== null || protectedCascade}
				onclick={confirmDisable}>Confirm disable</button
			>
			<button type="button" bind:this={cancelButton} onclick={cancelDisable}>Cancel</button>
		</section>
	{/if}
	{#each plugins as plugin, index (plugin.manifest.id)}
		{@const required = requiredPluginIds.includes(plugin.manifest.id)}
		{@const busy = plugin.status === 'activating' || plugin.status === 'deactivating'}
		<article aria-labelledby={`${panelId}-plugin-${index}`} aria-busy={busy}>
			<h3 id={`${panelId}-plugin-${index}`}>{plugin.manifest.name}</h3>
			<p>{plugin.manifest.description}</p>
			<dl>
				<dt>ID</dt>
				<dd><code>{plugin.manifest.id}</code></dd>
				<dt>Version</dt>
				<dd>{plugin.manifest.version}</dd>
				<dt>Status</dt>
				<dd role="status">{statuses[plugin.status]}</dd>
			</dl>
			{#if required}
				<p>Required by the host; cannot be disabled here.</p>
			{/if}
			<h4>Declared capabilities</h4>
			<ul>
				{#each plugin.manifest.capabilities as capability}
					<li><code>{capability}</code> — {explanations[capability]}</li>
				{:else}
					<li>No capabilities declared.</li>
				{/each}
			</ul>
			<h4>Provided APIs</h4>
			<ul>
				{#each plugin.manifest.provides ?? [] as api}
					<li>
						<code>{api.id}</code> v{api.major} — {plugin.providers.some(
							(active) => active.id === api.id && active.major === api.major,
						)
							? 'Available'
							: 'Inactive'}
					</li>
				{:else}
					<li>No APIs declared.</li>
				{/each}
			</ul>
			<h4>Dependencies</h4>
			<ul>
				{#each plugin.dependencies as dependency}
					<li>
						{dependency.optional ? 'Optional' : 'Required'}: <code>{dependency.provider}</code> /
						<code>{dependency.api}</code>
						v{dependency.major} — {dependency.status}
					</li>
				{:else}
					<li>No dependencies declared.</li>
				{/each}
			</ul>
			<h4>Current contributions</h4>
			<ul>
				{#each plugin.contributions as contribution}
					<li>{contribution.kind}: <code>{contribution.id}</code></li>
				{:else}
					<li>No active contributions.</li>
				{/each}
			</ul>
			{#if plugin.errors.length > 0}
				<div role="alert">
					<ul>
						{#each plugin.errors as error}
							<li>
								{errorLabels[error.phase]} error: {error.message}
							</li>
						{/each}
					</ul>
					<p>
						{plugin.status === 'active'
							? 'Disable the plugin to stop its remaining active contributions.'
							: 'Retry enabling the plugin. If the error persists, report the plugin ID and error to the application maintainer.'}
					</p>
				</div>
			{/if}
			{#if actionErrors[plugin.manifest.id]}
				<p role="alert">
					Unable to change plugin: {actionErrors[plugin.manifest.id]}. Try again when the host is
					idle.
				</p>
			{/if}
			<button
				type="button"
				disabled={busy ||
					pendingId !== null ||
					confirmation !== null ||
					(required && plugin.status === 'active')}
				onclick={(event) => change(plugin, event.currentTarget)}
			>
				{busy
					? statuses[plugin.status]
					: plugin.status === 'active'
						? 'Disable'
						: plugin.status === 'failed'
							? 'Retry enabling'
							: 'Enable'}
				<span class="sr-only"> {plugin.manifest.name}</span>
			</button>
		</article>
	{/each}
</section>

<style>
	.plugin-manager {
		display: grid;
		gap: 0.75rem;
	}
	article {
		border: 1px solid currentColor;
		border-radius: 0.25rem;
		padding: 1rem;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.25rem 1rem;
	}
	dd {
		margin: 0;
	}
	code {
		overflow-wrap: anywhere;
	}
	button {
		border: 1px solid currentColor;
		border-radius: 0.25rem;
		padding: 0.25rem 0.75rem;
	}
	button:disabled {
		opacity: 0.6;
	}
	button:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 3px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
</style>
