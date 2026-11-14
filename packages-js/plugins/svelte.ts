import type { Component } from 'svelte';
import type {
	BundledPlugin,
	PluginContext,
	PluginRegistries,
	ToolbarContribution,
	ViewContribution,
} from './index';

/** Trusted rendering descriptor carrying only the activation's scoped, revocable context. */
export interface SveltePresentation {
	readonly component: Component<{ context: SveltePluginContext }>;
	readonly context: SveltePluginContext;
}
export type SveltePlugin = BundledPlugin<SveltePresentation>;
export type SveltePluginContext = PluginContext<SveltePresentation>;
export type SveltePluginRegistries = PluginRegistries<SveltePresentation>;
export type SvelteToolbarContribution = ToolbarContribution<SveltePresentation>;
export type SvelteViewContribution = ViewContribution<SveltePresentation>;
