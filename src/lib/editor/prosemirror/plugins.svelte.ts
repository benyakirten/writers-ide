import { Plugin } from 'prosemirror-state';
import { createUpdatePlugin } from './plugins/event-bus.plugin';

export class ProseMirrorPluginManager {
	record = $state<Record<string, Plugin>>({});
	plugins = $derived.by(() => Object.values(this.record));

	register(name: string, plugin: Plugin): () => void {
		this.record[name] = plugin;
		return () => this.deregister(name);
	}

	deregister(name: string): void {
		delete this.record[name];
	}

	get(name: string): Plugin | null {
		return this.record[name] ?? null;
	}
}

const ProseMirrorPlugins = new ProseMirrorPluginManager();
ProseMirrorPlugins.register('event-bus', createUpdatePlugin('global'));

export default ProseMirrorPlugins;
