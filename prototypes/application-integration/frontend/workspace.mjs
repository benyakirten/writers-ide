import { Channel } from '@tauri-apps/api/core';
import { createApplicationComponentHost } from '../../../src/lib/plugins/application-component-host.svelte.ts';
import { definePluginCommand } from '../../../packages-js/plugins/commands.ts';
import { createWorkspaceTransport } from './workspace-transport.mjs';
import { boot, button, element, invoke, report, start, status } from './ui.mjs';

boot(async () => {
	const identity = await start('workspace');
	element('h1', 'Settings-integrated workspace fixture');
	element(
		'p',
		'Native supplies this workspace identity. Reattachment is explicit. Held commands keep reservations until their implementation settles, even after cancellation.',
	);
	const counters = element('pre');
	counters.id = 'counters';
	let render = () => {};
	const transport = createWorkspaceTransport({
		session: identity.session,
		invoke,
		channel(callback) {
			const events = new Channel();
			events.onmessage = callback;
			return events;
		},
		changed: () => render(),
	});
	const assembly = createApplicationComponentHost({ resourceSettingsClient: transport.client });
	const schema = {
		'~standard': {
			version: 1,
			vendor: 'application-integration-fixture',
			validate: (value) => ({ value }),
		},
	};
	const contract = definePluginCommand({
		id: 'fixture.hold',
		major: 1,
		args: schema,
		result: schema,
	});
	const declaration = { id: 'hold', contractId: contract.id, major: 1 };
	const calls = new Map();
	let caller;
	let serial = 0;
	let started = 0;
	let completed = 0;
	let rejected = 0;
	let cancellationRetained = false;
	let frozenAdmissionRejected = false;
	const descriptor = (slotId, activate) => ({
		slotId,
		identity: {
			packageId: 'application-integration-fixture',
			componentId: slotId,
			projectOpeningId: null,
		},
		commands: [],
		dependencies: [],
		capabilities: [],
		activate,
	});
	assembly.host.register({
		...descriptor('provider', (context) => {
			context.contributions.command({
				id: 'hold',
				name: 'Controlled long-running command',
				contract,
				execute(value, execution) {
					started++;
					return new Promise((resolve) => {
						const call = calls.get(value.id);
						call.resolve = resolve;
						call.signal = execution.signal;
						render();
					});
				},
			});
		}),
		commands: [declaration],
		capabilities: ['contributions.command'],
	});
	assembly.host.register({
		...descriptor('caller', (context) => {
			caller = context;
		}),
		dependencies: [
			{
				alias: 'provider',
				providerSlot: 'provider',
				optional: false,
				commands: [{ ...declaration, alias: 'hold' }],
			},
		],
	});
	assembly.host.activate('caller');
	render = () => {
		status.textContent = `Settings ${transport.client.status}; applied revision ${transport.revision ?? 'none'}`;
		counters.textContent = JSON.stringify(
			{
				reservations: transport.client.ledger.snapshot(),
				started,
				completed,
				rejected,
				calls: [...calls].map(([id, call]) => ({
					id,
					executing: Boolean(call.resolve),
					cancelled: call.signal?.aborted ?? false,
				})),
			},
			null,
			2,
		);
	};
	function control(id, title, action) {
		const node = button(title, action);
		node.id = id;
		return node;
	}
	control('reattach', 'Explicitly reattach settings', async () => {
		await transport.reattach();
		render();
	});
	control('detach', 'Detach settings', () => {
		transport.client.disconnect();
		render();
	});
	control('start-command', 'Start held command', () => {
		if (calls.size >= 8) {
			throw new Error('Fixture holds at most eight calls');
		}
		const id = String(++serial);
		const controller = new AbortController();
		const call = { controller };
		calls.set(id, call);
		void caller.commands
			.execute(
				'provider',
				'hold',
				contract,
				{ id, retained: 'fixture payload retained until implementation completion' },
				{ signal: controller.signal },
			)
			.then(
				() => {
					completed++;
				},
				() => {
					rejected++;
				},
			)
			.finally(() => {
				if (!call.resolve) {
					calls.delete(id);
				}
				render();
			});
		render();
	});
	control('cancel-command', 'Cancel oldest held command (leave implementation unfinished)', () => {
		const call = [...calls.values()].find(
			(value) => value.resolve && !value.controller.signal.aborted,
		);
		if (!call) {
			return;
		}
		const before = JSON.stringify(transport.client.ledger.snapshot());
		call.controller.abort();
		queueMicrotask(() => {
			cancellationRetained = before === JSON.stringify(transport.client.ledger.snapshot());
			render();
		});
	});
	control('finish-command', 'Finish oldest implementation', () => {
		const entry = [...calls].find(([, call]) => call.resolve);
		if (entry) {
			const [id, call] = entry;
			call.resolve('implementation completed');
			calls.delete(id);
			queueMicrotask(render);
		}
	});
	control('freeze', 'Freeze this workspace for 31 seconds (lease must expire)', () => {
		if (transport.client.status !== 'ready') {
			throw new Error('Attach settings before the freeze check');
		}
		frozenAdmissionRejected = false;
		const before = JSON.stringify(transport.client.ledger.snapshot());
		const end = performance.now() + 31_000;
		while (performance.now() < end) {
			/* Deliberately miss scheduler callbacks in this fixture only. */
		}
		try {
			const reservation = transport.client.ledger.admit('freeze-check', 'freeze-check');
			reservation.release();
		} catch {
			// This runs before any missed scheduler callback can resume.
			frozenAdmissionRejected =
				transport.client.status === 'stale' &&
				before === JSON.stringify(transport.client.ledger.snapshot());
		}
		render();
	});
	control('report', 'Report read-only observations', () =>
		report(identity, [
			{ name: 'workspace-settings-ready', ok: transport.client.status === 'ready' },
			{ name: 'workspace-settings-stale', ok: transport.client.status === 'stale' },
			{
				name: 'workspace-held-command-running',
				ok: transport.client.ledger.snapshot().pending > 0,
			},
			{ name: 'workspace-cancelled-unfinished-retains-accounting', ok: cancellationRetained },
			{ name: 'workspace-frozen-synchronous-admission-rejected', ok: frozenAdmissionRejected },
			{ name: 'workspace-real-host-active', ok: Boolean(assembly.host.get('caller')?.instanceId) },
		]),
	);
	window.addEventListener('pagehide', () => assembly.dispose(), { once: true });
	await transport.reattach();
	render();
	await report(identity, [
		{ name: 'workspace-real-host-created', ok: Boolean(assembly.host.get('caller')?.instanceId) },
	]);
});
