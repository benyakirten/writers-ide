import type { SvelteFrontendContext } from '@writers-ide/plugins/svelte';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import { Schema, Node } from 'prosemirror-model';
import { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Transform } from 'prosemirror-transform';
import { probeApi, publishedApi, double } from './contracts';
import Presentation from './Presentation.svelte';
import '@writers-ide/layout/dock-colors.css';

const fixtureGlobal = globalThis as typeof globalThis & { pluginImports?: number };
fixtureGlobal.pluginImports = (fixtureGlobal.pluginImports ?? 0) + 1;
export function activate(context: SvelteFrontendContext) {
	const probe = context.apis.get('host', probeApi)!;
	probe.event(`activate-style:${getComputedStyle(document.querySelector('.style-probe')!).color}`);
	const lifecycle = probe.lifecycle();
	context.own(() => lifecycle(`cleanup:${context.signal.aborted}`));
	const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });
	const view = new EditorView(document.createElement('div'), {
		state: EditorState.create({ schema }),
	});
	context.own(() => view.destroy());
	if (!probe.check(view)) {
		throw new Error('Plugin-to-host ProseMirror identity failed');
	}
	context.apis.provide(publishedApi, () => ({
		inspect(hostView) {
			const transaction = hostView.state.tr.insertText('plugin');
			const valid =
				hostView instanceof EditorView &&
				hostView.state instanceof EditorState &&
				hostView.state.doc instanceof Node &&
				hostView.state.schema instanceof Schema &&
				transaction instanceof Transaction &&
				transaction instanceof Transform;
			hostView.dispatch(transaction);
			return valid;
		},
	}));
	const run = async () => {
		const { message } = await import('./message');
		const value = await context.commands.execute('host', 'double', double, 21);
		probe.event(`${message}:${value}`);
	};
	context.contributions.view({
		id: 'view',
		name: 'Profile view',
		presentation: defineSveltePresentation(Presentation, {
			probe,
			lifecycle,
			broken: location.hash === '#renderer-failure',
		}),
	});
	if (location.hash === '#activation-failure') {
		throw new Error('Fixture activation failure');
	}
	void run().catch((error) => lifecycle(`command-error:${String(error)}`));
	const workerFile = './worker.js';
	void probe.worker(new URL(workerFile, import.meta.url).href, 21).then(
		(result) => lifecycle(`worker:${JSON.stringify(result)}`),
		(error) => lifecycle(`worker-error:${String(error)}`),
	);
}
