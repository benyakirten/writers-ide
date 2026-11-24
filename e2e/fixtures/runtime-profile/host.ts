import { mount, tick } from 'svelte';
import { Schema, Node } from 'prosemirror-model';
import { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Transform } from 'prosemirror-transform';
import type { SveltePresentation } from '@writers-ide/plugins/svelte';
import { CommandComponentHost } from '../../../packages-js/plugins/command-component-host';
import { probeApi, publishedApi, double } from './plugin/contracts';
import { Resources } from './resources';
import Host from './Host.svelte';

const accepted: ConstructorParameters<typeof Resources>[0] = await (
	await fetch(location.hash === '#portable-sdk' ? '/sample-accepted.json' : '/accepted.json')
).json();
// Native dynamic imports live in the unbundled fixture bootstrap. The trusted
// profile builder deliberately requires literal, closed references in its graph.
const importArtifact = (
	window as unknown as { fixtureImport(url: string): Promise<Record<string, unknown>> }
).fixtureImport;
const resources = new Resources(accepted);
const events: string[] = [];
const stats = { created: 0, terminated: 0, revoked: 0 };
const host = new CommandComponentHost<SveltePresentation>({
	locale: {
		snapshot: () => ({ languageTag: 'en', direction: 'ltr' }),
		subscribe(listener) {
			listener(this.snapshot());
			return () => {};
		},
	},
});
const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
const view = new EditorView(document.createElement('div'), {
	state: EditorState.create({ schema }),
});
const base = (slotId: string) => ({
	slotId,
	identity: { packageId: 'runtime-profile-fixture', componentId: slotId, projectOpeningId: null },
	commands: [],
	dependencies: [],
	capabilities: [],
});
let hostContext: Parameters<Parameters<typeof host.register>[0]['activate']>[0];
const handles = new Set<{ cancel(): void }>();
async function worker(url: string, input: number, mode = '', signal = hostContext.signal) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal.addEventListener('abort', abort, { once: true });
	if (signal.aborted) {
		controller.abort();
	}
	try {
		const bytes = await resources.verify(url, controller.signal);
		const task = hostContext.tasks.worker<number, number>({
			key: `worker-${stats.created}`,
			label: 'Verified fixture worker',
			signal: controller.signal,
			input,
			createWorker() {
				controller.signal.throwIfAborted();
				const blob = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
				let instance: Worker;
				try {
					if (mode === 'constructor-failure') {
						throw new Error('Fixture constructor failure');
					}
					instance = new Worker(blob, { type: 'module' });
					stats.created++;
				} catch (error) {
					URL.revokeObjectURL(blob);
					stats.revoked++;
					throw error;
				}
				const terminate = instance.terminate.bind(instance);
				let live = true;
				instance.terminate = () => {
					if (live) {
						live = false;
						terminate();
						stats.terminated++;
						URL.revokeObjectURL(blob);
						stats.revoked++;
					}
				};
				return instance;
			},
		});
		handles.add(task);
		if (mode === 'cancel') {
			task.cancel();
		}
		try {
			return await task.result;
		} finally {
			handles.delete(task);
		}
	} finally {
		signal.removeEventListener('abort', abort);
	}
}
host.register({
	...base('host'),
	provides: [probeApi],
	commands: [{ id: 'double', contractId: double.id, major: 1 }],
	capabilities: ['contributions.command'],
	activate(context) {
		hostContext = context;
		context.contributions.command({
			id: 'double',
			name: 'Double',
			contract: double,
			execute: (value) => value * 2,
		});
		context.apis.provide(probeApi, (connection) => ({
			event(value) {
				events.push(value);
			},
			lifecycle() {
				return (value: string) => {
					events.push(value);
				};
			},
			worker: (url, input, mode) => worker(url, input, mode, connection.signal),
			check(pluginView) {
				const tr = pluginView.state.tr.insertText('host');
				const valid =
					pluginView instanceof EditorView &&
					pluginView.state instanceof EditorState &&
					pluginView.state.doc instanceof Node &&
					pluginView.state.schema instanceof Schema &&
					tr instanceof Transaction &&
					tr instanceof Transform;
				pluginView.dispatch(tr);
				events.push(`pm-plugin:${valid}:${pluginView.state.doc.textContent}`);
				return valid;
			},
		}));
	},
});
for (const style of accepted.sharedStyles) {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = new URL(style, new URL('/profile/', location.href)).href;
	const ready = new Promise<void>((resolve, reject) => {
		link.onload = () => resolve();
		link.onerror = reject;
	});
	document.head.append(link);
	await ready;
}
const styleProbe = document.createElement('div');
styleProbe.className = 'style-probe';
document.body.append(styleProbe);
mount(Host, { target: document.querySelector('#app')!, props: { host } });
let registered = false;
type StartSession = {
	generation: number;
	controller: AbortController;
	release?: () => void;
	active: boolean;
};
let generation = 0;
let current: StartSession | undefined;
async function disposeSession(session: StartSession) {
	session.controller.abort();
	if (session.active) {
		session.active = false;
		host.deactivate('plugin', { cascade: true });
	}
	await tick();
	session.release?.();
	session.release = undefined;
}
function checkSession(session: StartSession) {
	session.controller.signal.throwIfAborted();
	if (current !== session || session.generation !== generation) {
		throw new DOMException('Superseded fixture start', 'AbortError');
	}
}
let retained: { inspect(view: EditorView): boolean } | null = null;
async function start(profile = accepted.profile) {
	const previousTeardown = stop();
	const session: StartSession = { generation, controller: new AbortController(), active: false };
	current = session;
	try {
		await previousTeardown;
		checkSession(session);
		session.release = await resources.prepare(profile, session.controller.signal);
		checkSession(session);
		const plugin = await importArtifact(new URL(accepted.entry, resources.base).href);
		checkSession(session);
		if (typeof plugin.activate !== 'function') {
			throw new Error('Named activate export required');
		}
		if (!registered) {
			host.register({
				...base('plugin'),
				provides: [publishedApi],
				capabilities: ['contributions.view'],
				dependencies: [
					{
						alias: 'host',
						providerSlot: 'host',
						apis: [probeApi],
						commands: [{ alias: 'double', id: 'double', contractId: double.id, major: 1 }],
					},
				],
				activate: plugin.activate as Parameters<typeof host.register>[0]['activate'],
			});
			host.register({
				...base('consumer'),
				dependencies: [
					{ alias: 'plugin', providerSlot: 'plugin', apis: [publishedApi], commands: [] },
				],
				activate(context) {
					retained = context.apis.get('plugin', publishedApi);
					events.push(`pm-host:${retained!.inspect(view)}:${view.state.doc.textContent}`);
				},
			});
			registered = true;
		}
		session.active = true;
		host.activate('consumer');
		await tick();
		checkSession(session);
	} catch (error) {
		if (current === session) {
			current = undefined;
			await disposeSession(session);
		} else {
			session.release?.();
			session.release = undefined;
		}
		throw error;
	}
}
async function stop() {
	generation++;
	const session = current;
	current = undefined;
	if (session) {
		await disposeSession(session);
	}
}
const api = {
	start,
	stop,
	events,
	stats,
	base: resources.base.href,
	owners: () => [...resources.styles.values()].map((entry) => entry.owners),
	acquire: (signal?: AbortSignal) => resources.acquire(signal),
	worker,
	workerAbortController: new AbortController(),
	workerWithAbort(url: string) {
		return worker(url, 1, '', api.workerAbortController.signal);
	},
	cancel: () => {
		for (const task of handles) {
			task.cancel();
		}
	},
	retained: () => retained!.inspect(view),
	async abortedPrepare() {
		const controller = new AbortController();
		controller.abort();
		await resources.prepare(accepted.profile, controller.signal);
	},
	async inventory() {
		const result: Record<string, string[]> = {};
		for (const [id, description] of Object.entries(accepted.modules) as [
			string,
			{ exports: string[] },
		][]) {
			const namespace = await importArtifact(id);
			const keys = Object.keys(namespace).sort();
			if (JSON.stringify(keys) !== JSON.stringify(description.exports)) {
				throw new Error(`Namespace mismatch: ${id}`);
			}
			result[id] = keys;
		}
		return result;
	},
};
Object.assign(window, { profileFixture: api });
try {
	await start(location.hash === '#unsupported' ? 'unsupported/1' : accepted.profile);
	document.body.dataset.ready = 'true';
} catch (error) {
	document.body.dataset.error = String(error);
}
