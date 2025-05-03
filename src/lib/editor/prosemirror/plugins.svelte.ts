import { Plugin } from 'prosemirror-state';

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
export default ProseMirrorPlugins;
