import { Plugin } from 'prosemirror-state';
import { createEventBusPlugin } from './plugins/event-bus.plugin';

type CreatePluginFn = (id: string) => Plugin;

export class ProseMirrorPluginManager {
	record = $state<Record<string, CreatePluginFn>>({});
	pluginRegistryFunctions = $derived.by(() => Object.values(this.record));

	register(name: string, fn: CreatePluginFn): () => void {
		this.record[name] = fn;
		return () => this.deregister(name);
	}

	deregister(name: string): void {
		delete this.record[name];
	}

	get(name: string): CreatePluginFn | null {
		return this.record[name] ?? null;
	}
}

const ProseMirrorPlugins = new ProseMirrorPluginManager();
ProseMirrorPlugins.register('event-bus', createEventBusPlugin);

export default ProseMirrorPlugins;
