// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type {
	BundledPlugin,
	CommandContribution,
	ContributionRegistry,
	Dispose,
	FormattingRequest,
	FormattingService,
	FormattingSnapshot,
	PluginCapability,
	PluginContext,
	PluginManifest,
	ToolbarContribution,
	ViewContribution,
} from '@writers-ide/plugins';
import type { SveltePlugin, SveltePresentation } from '@writers-ide/plugins/svelte';
import { PluginHost } from './plugin-host';

const allCapabilities: PluginCapability[] = [
	'formatting.observe',
	'formatting.execute',
	'contributions.toolbar',
	'contributions.view',
	'contributions.command',
];

function plugin(
	id: string,
	activate: BundledPlugin<string>['activate'] = () => {},
	capabilities: readonly PluginCapability[] = allCapabilities,
): BundledPlugin<string> {
	return {
		manifest: {
			id,
			name: id,
			description: `${id} plugin`,
			version: '0.1.0',
			apiVersion: 1,
			capabilities,
		},
		activate,
	};
}

function registry<T extends { readonly id: string }>(): ContributionRegistry<T> & {
	items: Map<string, { ownerId: string; contribution: T }>;
	removed: ReturnType<typeof vi.fn>;
} {
	const items = new Map<string, { ownerId: string; contribution: T }>();
	const removed = vi.fn();
	return {
		items,
		removed,
		register: vi.fn((ownerId: string, contribution: T) => {
			items.set(contribution.id, { ownerId, contribution });
			return () => {
				items.delete(contribution.id);
				removed(contribution.id);
			};
		}),
	};
}

function setup() {
	const toolbar = registry<ToolbarContribution<string>>();
	const view = registry<ViewContribution<string>>();
	const command = registry<CommandContribution>();
	const listeners: ((snapshot: FormattingSnapshot | null) => void)[] = [];
	const unsubscribe = vi.fn();
	const formatting: FormattingService = {
		subscribe: vi.fn((listener) => {
			listeners.push(listener);
			listener(null);
			return unsubscribe;
		}),
		execute: vi.fn(() => true),
	};
	const registries = { toolbar, view, command };
	const host = new PluginHost({ formatting, registries });
	return { host, formatting, registries, listeners, unsubscribe };
}

const toolbarContribution: ToolbarContribution<string> = {
	id: 'tools',
	name: 'Tools',
	horizontal: { presentation: 'row', size: 3 },
	vertical: { presentation: 'column', size: 2 },
};
const request: FormattingRequest = { viewId: 'view-1', revision: 7, command: 'bold' };

// Type-only coverage of the optional Svelte adapter; no runtime Svelte dependency in the host.
function sveltePlugin(component: SveltePresentation['component']): SveltePlugin {
	return {
		manifest: plugin('svelte').manifest,
		activate(context) {
			const presentation: SveltePresentation = { component, context };
			context.contributions.view({ id: 'svelte-view', name: 'Svelte view', presentation });
			context.contributions.toolbar({
				id: 'svelte-toolbar',
				name: 'Svelte toolbar',
				horizontal: { presentation, size: 3 },
				vertical: { presentation, size: 1 },
			});
		},
	};
}
void sveltePlugin;

describe('PluginHost', () => {
	it('registers explicitly without activating and returns immutable management snapshots', () => {
		const { host } = setup();
		const activate = vi.fn();
		const original = plugin('one', activate);
		const info = host.register(original);
		expect(info.status).toBe('disabled');
		expect(activate).not.toHaveBeenCalled();
		expect(host.get('missing')).toBeUndefined();
		expect(host.list()).toEqual([info]);
		expect(Object.isFrozen(info)).toBe(true);
		expect(Object.isFrozen(info.manifest)).toBe(true);
		expect(Object.isFrozen(info.manifest.capabilities)).toBe(true);
		expect(Object.isFrozen(info.errors)).toBe(true);
		expect(Object.isFrozen(info.contributions)).toBe(true);
		expect(Object.isFrozen(host.list())).toBe(true);
		expect(info.manifest).not.toBe(original.manifest);
		host.activate('one');
		expect(info.status).toBe('disabled');
	});

	it('rejects incompatible APIs, invalid manifests, capabilities, and duplicate plugin IDs', () => {
		const { host } = setup();
		const bad = (manifest: PluginManifest) => host.register({ ...plugin('one'), manifest });
		expect(() =>
			bad({ ...plugin('one').manifest, apiVersion: 2 } as unknown as PluginManifest),
		).toThrow('Unsupported plugin API');
		for (const field of ['id', 'name', 'version', 'description'] as const) {
			expect(() => bad({ ...plugin('one').manifest, [field]: ' ' })).toThrow('nonempty');
		}
		expect(() =>
			bad({ ...plugin('one').manifest, capabilities: ['filesystem'] } as unknown as PluginManifest),
		).toThrow('Unknown or duplicate');
		expect(() =>
			host.register(plugin('one', undefined, ['formatting.observe', 'formatting.observe'])),
		).toThrow('Unknown or duplicate');
		expect(host.list()).toEqual([]);
		host.register(plugin('one'));
		expect(() => host.register(plugin('one'))).toThrow('already registered');
	});

	it('registers all contribution kinds with ownership and removes only the disabled owner', () => {
		const { host, registries } = setup();
		host.register(
			plugin('one', (context) => {
				context.contributions.toolbar(toolbarContribution);
				context.contributions.view({
					id: 'editor',
					name: 'Editor',
					presentation: 'editor-component',
				});
				context.contributions.command({ id: 'run', name: 'Run', execute: () => true });
			}),
		);
		host.register(
			plugin('two', (context) => {
				context.contributions.command({ id: 'other', name: 'Other', execute: () => true });
			}),
		);
		expect(host.activate('one').contributions).toEqual([
			{ kind: 'toolbar', id: 'tools' },
			{ kind: 'view', id: 'editor' },
			{ kind: 'command', id: 'run' },
		]);
		host.activate('two');
		expect(registries.toolbar.items.get('tools')).toEqual({
			ownerId: 'one',
			contribution: toolbarContribution,
		});
		expect(host.deactivate('one').status).toBe('disabled');
		expect(registries.toolbar.items.size).toBe(0);
		expect(registries.view.items.size).toBe(0);
		expect([...registries.command.items.keys()]).toEqual(['other']);
	});

	it('rejects duplicate contribution IDs across owners without removing the original', () => {
		const { host, registries } = setup();
		for (const id of ['one', 'two']) {
			host.register(
				plugin(id, (context) => {
					context.contributions.toolbar(toolbarContribution);
				}),
			);
		}
		host.activate('one');
		const failed = host.activate('two');
		expect(failed.status).toBe('failed');
		expect(failed.errors[0].message).toContain('Duplicate toolbar');
		expect(registries.toolbar.items.get('tools')?.ownerId).toBe('one');
		host.deactivate('one');
		expect(host.activate('two').status).toBe('active');
	});

	it('rolls back duplicate IDs within one plugin and permits the same ID in different kinds', () => {
		const { host, registries } = setup();
		host.register(
			plugin('one', (context) => {
				context.contributions.toolbar(toolbarContribution);
				context.contributions.view({ id: 'tools', name: 'View', presentation: 'view' });
				context.contributions.toolbar(toolbarContribution);
			}),
		);
		expect(host.activate('one').status).toBe('failed');
		expect(registries.toolbar.removed).toHaveBeenCalledOnce();
		expect(registries.view.removed).toHaveBeenCalledOnce();
	});

	it('rolls back contributions and subscriptions on activation failure, aborting first', () => {
		const { host, registries, unsubscribe } = setup();
		let saved!: PluginContext<string>;
		const dispose = vi.fn(() => {
			expect(saved.signal.aborted).toBe(true);
		});
		host.register(
			plugin('one', (context) => {
				saved = context;
				context.contributions.toolbar(toolbarContribution);
				context.formatting.subscribe(() => {});
				context.own(dispose);
				throw new Error('startup failed');
			}),
		);
		const info = host.activate('one');
		expect(info.status).toBe('failed');
		expect(info.errors).toEqual([{ phase: 'activation', message: 'startup failed' }]);
		expect(info.contributions).toEqual([]);
		expect(registries.toolbar.items.size).toBe(0);
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
		expect(saved.formatting.execute(request)).toBe(false);
	});

	it('cleans up in reverse order, idempotently, continuing after failures', () => {
		const { host, registries } = setup();
		const order: string[] = [];
		let release!: Dispose;
		host.register(
			plugin('one', (context) => {
				context.contributions.toolbar(toolbarContribution);
				release = context.own(() => {
					order.push('first');
				});
				context.own(() => {
					order.push('throw');
					throw new Error('cleanup failed');
				});
				return () => {
					order.push('returned');
				};
			}),
		);
		host.activate('one');
		const result = host.deactivate('one');
		release();
		host.deactivate('one');
		expect(order).toEqual(['returned', 'throw', 'first']);
		expect(registries.toolbar.removed).toHaveBeenCalledOnce();
		expect(result.status).toBe('failed');
		expect(result.errors).toEqual([{ phase: 'cleanup', message: 'cleanup failed' }]);
	});

	it('allows early release and re-registration without old handles removing new ownership', () => {
		const { host, registries } = setup();
		let release!: Dispose;
		let saved!: PluginContext<string>;
		host.register(
			plugin('one', (context) => {
				saved = context;
				release = context.contributions.toolbar(toolbarContribution);
			}),
		);
		host.activate('one');
		release();
		expect(host.get('one')?.contributions).toEqual([]);
		saved.contributions.toolbar(toolbarContribution);
		release();
		expect(registries.toolbar.items.size).toBe(1);
		host.deactivate('one');
		expect(registries.toolbar.removed).toHaveBeenCalledTimes(2);
	});

	it('revokes stale contexts, formatting callbacks and retained commands across re-enable', () => {
		const { host, registries, formatting, listeners, unsubscribe } = setup();
		const contexts: PluginContext<string>[] = [];
		const listener = vi.fn();
		const execute = vi.fn(() => true);
		host.register(
			plugin('one', (context) => {
				contexts.push(context);
				context.formatting.subscribe(listener);
				context.contributions.command({ id: 'run', name: 'Run', execute });
			}),
		);
		host.activate('one');
		const oldCommand = registries.command.items.get('run')!.contribution;
		expect(oldCommand.execute()).toBe(true);
		expect(contexts[0].formatting.execute(request)).toBe(true);
		expect(formatting.execute).toHaveBeenCalledWith(request);
		host.deactivate('one');
		listeners[0](null);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(unsubscribe).toHaveBeenCalledOnce();
		expect(oldCommand.execute()).toBe(false);
		expect(contexts[0].signal.aborted).toBe(true);
		expect(contexts[0].formatting.execute(request)).toBe(false);
		expect(() => contexts[0].formatting.subscribe(listener)).toThrow('revoked');
		expect(() => contexts[0].contributions.toolbar(toolbarContribution)).toThrow('revoked');
		const late = vi.fn();
		const release = contexts[0].own(late);
		release();
		expect(late).toHaveBeenCalledOnce();
		expect(host.activate('one').status).toBe('active');
		expect(contexts[1].signal.aborted).toBe(false);
		expect(oldCommand.execute()).toBe(false);
		expect(registries.command.items.get('run')!.contribution.execute()).toBe(true);
		expect(execute).toHaveBeenCalledTimes(2);
	});

	it('revokes individually released commands and subscriptions before cleanup can throw', () => {
		const { host, registries, listeners, unsubscribe } = setup();
		unsubscribe.mockImplementation(() => {
			throw new Error('unsubscribe failed');
		});
		let releaseCommand!: Dispose;
		let releaseSubscription!: Dispose;
		const listener = vi.fn();
		host.register(
			plugin('one', (context) => {
				releaseCommand = context.contributions.command({
					id: 'run',
					name: 'Run',
					execute: () => true,
				});
				releaseSubscription = context.formatting.subscribe(listener);
			}),
		);
		host.activate('one');
		const retained = registries.command.items.get('run')!.contribution;
		releaseCommand();
		releaseSubscription();
		listeners[0](null);
		expect(retained.execute()).toBe(false);
		expect(listener).toHaveBeenCalledOnce();
		expect(host.deactivate('one').errors[0].message).toBe('unsubscribe failed');
	});

	it('enforces capability declarations without touching injected services', () => {
		const { host, formatting, registries } = setup();
		let saved!: PluginContext<string>;
		host.register(
			plugin(
				'one',
				(context) => {
					saved = context;
				},
				[],
			),
		);
		host.activate('one');
		expect(saved.formatting.execute(request)).toBe(false);
		expect(() => saved.formatting.subscribe(() => {})).toThrow('formatting.observe');
		expect(() => saved.contributions.toolbar(toolbarContribution)).toThrow('contributions.toolbar');
		expect(() => saved.contributions.view({ id: 'v', name: 'V', presentation: 'v' })).toThrow(
			'contributions.view',
		);
		expect(() => saved.contributions.command({ id: 'c', name: 'C', execute: () => true })).toThrow(
			'contributions.command',
		);
		expect(formatting.execute).not.toHaveBeenCalled();
		expect(formatting.subscribe).not.toHaveBeenCalled();
		expect(registries.toolbar.register).not.toHaveBeenCalled();
	});

	it('clears old errors on retry after activation or cleanup failure', () => {
		const { host } = setup();
		let fail = true;
		host.register(
			plugin('one', () => {
				if (fail) {
					throw new Error('try again');
				}
			}),
		);
		expect(host.activate('one').status).toBe('failed');
		fail = false;
		expect(host.activate('one').errors).toEqual([]);
		expect(host.deactivate('one').status).toBe('disabled');
	});

	it('is idempotent for repeated activation/deactivation and rejects unknown IDs and reentrancy', () => {
		const { host } = setup();
		const dispose = vi.fn();
		const activate = vi.fn(() => {
			expect(host.get('one')?.status).toBe('activating');
			expect(() => host.activate('one')).toThrow('busy');
			expect(() => host.deactivate('one')).toThrow('busy');
			return dispose;
		});
		host.register(plugin('one', activate));
		host.activate('one');
		host.activate('one');
		host.deactivate('one');
		host.deactivate('one');
		expect(activate).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
		expect(() => host.activate('missing')).toThrow('Unknown plugin');
		expect(() => host.deactivate('missing')).toThrow('Unknown plugin');
	});

	it('releases reservations after an adapter throws, including retained command revocation', () => {
		const { host, registries } = setup();
		let retained!: CommandContribution;
		vi.mocked(registries.command.register).mockImplementationOnce((_owner, contribution) => {
			retained = contribution;
			throw new Error('adapter failed');
		});
		host.register(
			plugin('one', (context) => {
				expect(() =>
					context.contributions.command({ id: 'run', name: 'Run', execute: () => true }),
				).toThrow('adapter failed');
				context.contributions.command({ id: 'run', name: 'Run', execute: () => true });
			}),
		);
		expect(host.activate('one').status).toBe('active');
		expect(retained.execute()).toBe(false);
	});

	it('keeps commands revoked and continues cleanup when registry removal fails', () => {
		const { host, registries } = setup();
		const cleanup = vi.fn();
		vi.mocked(registries.command.register).mockImplementationOnce(() => () => {
			throw new Error('remove failed');
		});
		host.register(
			plugin('one', (context) => {
				context.own(cleanup);
				context.contributions.command({ id: 'run', name: 'Run', execute: () => true });
			}),
		);
		host.activate('one');
		const retained = vi.mocked(registries.command.register).mock.calls[0][1];
		expect(host.deactivate('one').errors).toEqual([{ phase: 'cleanup', message: 'remove failed' }]);
		expect(retained.execute()).toBe(false);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.activate('one').status).toBe('active');
	});

	it('copies formatting data and delegates request validation and results to the service', () => {
		const { host, formatting, listeners } = setup();
		let saved!: PluginContext<string>;
		const received: (FormattingSnapshot | null)[] = [];
		host.register(
			plugin('one', (context) => {
				saved = context;
				context.formatting.subscribe((snapshot) => {
					received.push(snapshot);
				});
			}),
		);
		host.activate('one');
		const snapshot: FormattingSnapshot = {
			viewId: 'view-1',
			revision: 7,
			marks: {
				bold: 1,
				italic: 0,
				superscript: 0,
				subscript: 0,
				underline: 0,
				overline: 0,
				strikethrough: 0,
			},
			blocks: {
				indent: 1,
				dedent: 0,
				'align-left': 1,
				'align-center': 0,
				'align-right': 0,
				'align-justify': 0,
			},
			enabled: {
				bold: true,
				italic: true,
				superscript: true,
				subscript: true,
				underline: true,
				overline: true,
				strikethrough: true,
				indent: true,
				dedent: false,
				'align-left': true,
				'align-center': true,
				'align-right': true,
				'align-justify': true,
			},
		};
		listeners[0](snapshot);
		expect(received).toEqual([null, snapshot]);
		expect(received[1]).not.toBe(snapshot);
		received[1]!.marks.bold = 99;
		received[1]!.blocks.indent = 99;
		received[1]!.enabled.bold = false;
		expect(snapshot.marks.bold).toBe(1);
		expect(snapshot.blocks.indent).toBe(1);
		expect(snapshot.enabled.bold).toBe(true);
		vi.mocked(formatting.execute).mockReturnValue(false);
		expect(saved.formatting.execute(request)).toBe(false);
		expect(vi.mocked(formatting.execute).mock.calls[0][0]).toEqual(request);
		expect(vi.mocked(formatting.execute).mock.calls[0][0]).not.toBe(request);
	});

	it('disposes a registration whose adapter synchronously deactivates an active owner', () => {
		const { host, registries } = setup();
		let saved!: PluginContext<string>;
		const dispose = vi.fn();
		host.register(
			plugin('one', (context) => {
				saved = context;
			}),
		);
		host.activate('one');
		vi.mocked(registries.toolbar.register).mockImplementationOnce(() => {
			host.deactivate('one');
			return dispose;
		});
		const release = saved.contributions.toolbar(toolbarContribution);
		release();
		expect(dispose).toHaveBeenCalledOnce();
		expect(host.get('one')?.status).toBe('disabled');
		expect(host.activate('one').status).toBe('active');
		saved.contributions.toolbar(toolbarContribution);
		expect(registries.toolbar.items.size).toBe(1);
	});

	it.each(['horizontal', 'vertical'] as const)(
		'validates %s toolbar capacity before registration',
		(orientation) => {
			const { host, registries } = setup();
			let saved!: PluginContext<string>;
			host.register(
				plugin('one', (context) => {
					saved = context;
				}),
			);
			host.activate('one');
			for (const size of [0, 4, -1, 1.5, NaN, Infinity, '1', undefined, null]) {
				const invalid = {
					...toolbarContribution,
					[orientation]: { presentation: 'invalid', size },
				} as unknown as ToolbarContribution<string>;
				expect(() => saved.contributions.toolbar(invalid)).toThrow(`Toolbar ${orientation} size`);
			}
			expect(() =>
				saved.contributions.toolbar({
					...toolbarContribution,
					[orientation]: null,
				} as unknown as ToolbarContribution<string>),
			).toThrow(`Toolbar ${orientation} size`);
			expect(registries.toolbar.register).not.toHaveBeenCalled();
			expect(host.get('one')?.contributions).toEqual([]);
			for (const size of [1, 2, 3] as const) {
				const release = saved.contributions.toolbar({
					...toolbarContribution,
					[orientation]: { presentation: 'valid', size },
				});
				release();
			}
			expect(registries.toolbar.register).toHaveBeenCalledTimes(3);
		},
	);

	it('rolls back prior resources when toolbar capacity validation fails during activation', () => {
		const { host, registries } = setup();
		const cleanup = vi.fn();
		host.register(
			plugin('one', (context) => {
				context.own(cleanup);
				context.contributions.command({ id: 'run', name: 'Run', execute: () => true });
				context.contributions.toolbar({
					...toolbarContribution,
					vertical: { presentation: 'invalid', size: 4 },
				} as unknown as ToolbarContribution<string>);
			}),
		);
		const info = host.activate('one');
		expect(info.status).toBe('failed');
		expect(info.errors[0].message).toContain('Toolbar vertical size');
		expect(cleanup).toHaveBeenCalledOnce();
		expect(registries.command.items.size).toBe(0);
		expect(registries.toolbar.register).not.toHaveBeenCalled();
	});

	it('freezes toolbar section metadata and lifecycle entries without exposing mutable internals', () => {
		const { host, registries } = setup();
		const contribution = {
			...toolbarContribution,
			horizontal: { presentation: 'row', size: 1 as const },
		};
		host.register(
			plugin('one', (context) => {
				context.contributions.toolbar(contribution);
			}),
		);
		const active = host.activate('one');
		const registered = registries.toolbar.items.get('tools')!.contribution;
		expect(Object.isFrozen(registered)).toBe(true);
		expect(Object.isFrozen(registered.horizontal)).toBe(true);
		expect(Object.isFrozen(registered.vertical)).toBe(true);
		Object.assign(contribution.horizontal, { size: 3 });
		expect(registered.horizontal.size).toBe(1);
		expect(Object.isFrozen(active.contributions[0])).toBe(true);
		expect(() => Object.assign(active.contributions[0], { id: 'changed' })).toThrow(TypeError);
		host.deactivate('one');
		expect(active.status).toBe('active');
		expect(active.contributions).toEqual([{ kind: 'toolbar', id: 'tools' }]);
		host.register(
			plugin('failed', () => {
				throw new Error('failure');
			}),
		);
		const failed = host.activate('failed');
		expect(Object.isFrozen(failed.errors[0])).toBe(true);
		expect(() => Object.assign(failed.errors[0], { message: 'changed' })).toThrow(TypeError);
		expect(host.get('failed')?.errors[0].message).toBe('failure');
	});

	it('unsubscribes when an immediate listener throws, even if unsubscribe also fails', () => {
		const { host, listeners, unsubscribe } = setup();
		const listener = vi.fn(() => {
			throw new Error('listener failed');
		});
		unsubscribe.mockImplementationOnce(() => {
			throw new Error('unsubscribe failed');
		});
		host.register(
			plugin('one', (context) => {
				context.formatting.subscribe(listener);
			}),
		);
		const info = host.activate('one');
		expect(info.status).toBe('failed');
		expect(info.errors).toEqual([
			{ phase: 'cleanup', message: 'unsubscribe failed' },
			{ phase: 'activation', message: 'listener failed' },
		]);
		expect(unsubscribe).toHaveBeenCalledOnce();
		listeners[0](null);
		expect(listener).toHaveBeenCalledOnce();
		host.deactivate('one');
		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('revokes callbacks retained by failed subscription setup while the plugin remains active', () => {
		const { host, formatting } = setup();
		let retained!: (snapshot: FormattingSnapshot | null) => void;
		const listener = vi.fn();
		vi.mocked(formatting.subscribe).mockImplementationOnce((callback) => {
			retained = callback;
			throw new Error('service setup failed');
		});
		host.register(
			plugin('one', (context) => {
				expect(() => context.formatting.subscribe(listener)).toThrow('service setup failed');
			}),
		);
		expect(host.activate('one').status).toBe('active');
		retained(null);
		expect(listener).not.toHaveBeenCalled();
	});

	it('owns the subscription handle when an immediate callback deactivates its owner', () => {
		const { host, listeners, unsubscribe } = setup();
		let saved!: PluginContext<string>;
		host.register(
			plugin('one', (context) => {
				saved = context;
			}),
		);
		host.activate('one');
		const listener = vi.fn(() => {
			host.deactivate('one');
		});
		const release = saved.formatting.subscribe(listener);
		release();
		expect(host.get('one')?.status).toBe('disabled');
		expect(unsubscribe).toHaveBeenCalledOnce();
		listeners[0](null);
		expect(listener).toHaveBeenCalledOnce();
	});

	it('rejects async activation and rolls back already-owned resources', () => {
		const { host } = setup();
		const cleanup = vi.fn();
		const activate = ((context: PluginContext<string>) => {
			context.own(cleanup);
			return Promise.resolve();
		}) as unknown as BundledPlugin<string>['activate'];
		host.register(plugin('one', activate));
		expect(host.activate('one').errors[0].message).toContain('synchronous disposer');
		expect(cleanup).toHaveBeenCalledOnce();
	});
});
