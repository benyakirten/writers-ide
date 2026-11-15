import type { Component } from 'svelte';
import type {
	BundledPlugin,
	PluginContext,
	PluginRegistries,
	ToolbarContribution,
	ViewContribution,
} from './index';

/** Trusted rendering descriptor; feature dependencies are supplied explicitly as props. */
export interface SveltePresentation {
	readonly component: Component<Record<string, unknown>>;
	readonly props: Readonly<Record<string, unknown>>;
}

/** Check component props before erasing their type for the generic rendering adapter. */
export function defineSveltePresentation<Props extends object>(
	component: Component<Props>,
	props: Props,
): SveltePresentation {
	return {
		// The paired props satisfy this component's contract before type erasure.
		component: component as unknown as Component<Record<string, unknown>>,
		props: props as Readonly<Record<string, unknown>>,
	};
}

export type SveltePlugin = BundledPlugin<SveltePresentation>;
export type SveltePluginContext = PluginContext<SveltePresentation>;
export type SveltePluginRegistries = PluginRegistries<SveltePresentation>;
export type SvelteToolbarContribution = ToolbarContribution<SveltePresentation>;
export type SvelteViewContribution = ViewContribution<SveltePresentation>;
