// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Component } from 'svelte';
import type {
	BundledPlugin,
	CommandContribution,
	ContributionRegistry,
	Dispose,
	PluginCapability,
	PluginContext,
	PluginManifest,
	PluginInfo,
	PluginManagementService,
	ToolbarContribution,
	ViewContribution,
} from '@writers-ide/plugins';
import { defineSveltePresentation, type SveltePlugin } from '@writers-ide/plugins/svelte';
import { PluginHost } from './plugin-host';

const allCapabilities: PluginCapability[] = [
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
	const registries = { toolbar, view, command };
	const host = new PluginHost({ registries });
	return { host, registries };
}

const toolbarContribution: ToolbarContribution<string> = {
	id: 'tools',
	name: 'Tools',
	horizontal: { presentation: 'row', size: 3 },
	vertical: { presentation: 'column', size: 2 },
};

// Typed prop coverage of the optional adapter; no runtime Svelte dependency in the host.
function sveltePlugin(component: Component<{ label: string }>): SveltePlugin {
	return {
		manifest: plugin('svelte').manifest,
		activate(context) {
			const presentation = defineSveltePresentation(component, { label: 'Svelte view' });
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
	it('publishes registration, transitions, contribution changes and cleanup errors', () => {
		const { host } = setup();
		const management: PluginManagementService = host;
		const snapshots: (readonly PluginInfo[])[] = [];
		const unsubscribe = management.subscribe((plugins) => snapshots.push(plugins));
		expect(snapshots).toEqual([[]]);
		let context!: PluginContext<string>;
		host.register(
			plugin('one', (value) => {
				context = value;
			}),
		);
		expect(snapshots.at(-1)?.[0].status).toBe('disabled');
		host.activate('one');
		expect(snapshots.map((snapshot) => snapshot[0]?.status)).toEqual([
			undefined,
			'disabled',
			'activating',
			'active',
		]);
		const release = context.contributions.toolbar(toolbarContribution);
		expect(snapshots.at(-1)?.[0].contributions).toEqual([{ kind: 'toolbar', id: 'tools' }]);
		release();
		expect(snapshots.at(-1)?.[0].contributions).toEqual([]);
		context.own(() => {
			throw new Error('Cleanup needs attention');
		})();
		expect(snapshots.at(-1)?.[0].errors).toEqual([
			{ phase: 'cleanup', message: 'Cleanup needs attention' },
		]);
		host.deactivate('one');
		expect(snapshots.some((snapshot) => snapshot[0]?.status === 'deactivating')).toBe(true);
		expect(snapshots.at(-1)?.[0].status).toBe('failed');
		expect(Object.isFrozen(snapshots.at(-1))).toBe(true);
		expect(Object.isFrozen(snapshots.at(-1)?.[0].errors[0])).toBe(true);
		unsubscribe();
		unsubscribe();
		const count = snapshots.length;
		host.activate('one');
		expect(snapshots).toHaveLength(count);
	});

	it('isolates throwing observers and rejects notification-driven lifecycle resurrection', () => {
		const { host, registries } = setup();
		host.subscribe(() => {
			throw new Error('Broken manager');
		});
		const observed = vi.fn();
		host.subscribe(observed);
		const attempts: (Error | undefined)[] = [];
		host.subscribe((plugins) => {
			if (plugins.length === 0) {
				return;
			}
			for (const action of [
				() => host.activate('one'),
				() => host.deactivate('one'),
				() => host.register(plugin('two')),
			]) {
				let failure: Error | undefined;
				try {
					action();
				} catch (error) {
					failure = error as Error;
				}
				attempts.push(failure);
			}
		});
		host.register(
			plugin('one', (context) => {
				context.contributions.toolbar(toolbarContribution);
				throw new Error('Activation failed');
			}),
		);
		expect(host.activate('one').status).toBe('failed');
		expect(host.get('one')?.contributions).toEqual([]);
		expect(registries.toolbar.items.size).toBe(0);
		expect(host.list()).toHaveLength(1);
		expect(attempts.length).toBeGreaterThan(0);
		for (const failure of attempts) {
			expect(failure?.message).toContain('busy notifying');
		}
		expect(observed.mock.calls.at(-1)?.[0][0].errors).toEqual([
			{ phase: 'activation', message: 'Activation failed' },
		]);
	});

	it('cannot be resurrected by observers during successful deactivation', () => {
		const { host } = setup();
		let context!: PluginContext<string>;
		const dispose = vi.fn();
		host.register(
			plugin('one', (value) => {
				context = value;
				value.contributions.toolbar(toolbarContribution);
				return dispose;
			}),
		);
		host.activate('one');
		const attempted: string[] = [];
		host.subscribe((plugins) => {
			if (plugins[0].status === 'deactivating' || plugins[0].status === 'disabled') {
				attempted.push(plugins[0].status);
				host.activate('one');
			}
		});
		expect(host.deactivate('one').status).toBe('disabled');
		expect(host.get('one')?.contributions).toEqual([]);
		expect(context.signal.aborted).toBe(true);
		expect(dispose).toHaveBeenCalledOnce();
		expect(attempted).toContain('deactivating');
		expect(attempted).toContain('disabled');
	});

	it('keeps identical callbacks independently subscribed and honors removal during delivery', () => {
		const { host } = setup();
		const listener = vi.fn();
		const first = host.subscribe(listener);
		const second = host.subscribe(listener);
		expect(listener).toHaveBeenCalledTimes(2);
		first();
		first();
		host.register(plugin('one'));
		expect(listener).toHaveBeenCalledTimes(3);
		second();
		let remove = () => {};
		host.subscribe((plugins) => {
			if (plugins[0]?.status === 'activating') {
				remove();
			}
		});
		remove = host.subscribe(listener);
		listener.mockClear();
		host.activate('one');
		expect(listener).not.toHaveBeenCalled();
	});

	it('projects manifest metadata without carrying extra execution references', () => {
		const { host } = setup();
		const definition = plugin('one');
		const manifest = { ...definition.manifest, execute: () => true, context: {} };
		host.register({ ...definition, manifest });
		expect(Object.keys(host.list()[0].manifest).sort()).toEqual([
			'apiVersion',
			'capabilities',
			'description',
			'id',
			'name',
			'version',
		]);
	});

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
			host.register(plugin('one', undefined, ['contributions.toolbar', 'contributions.toolbar'])),
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

	it('rolls back contributions and owned resources on activation failure, aborting first', () => {
		const { host, registries } = setup();
		const unsubscribe = vi.fn();
		let saved!: PluginContext<string>;
		const dispose = vi.fn(() => {
			expect(saved.signal.aborted).toBe(true);
		});
		host.register(
			plugin('one', (context) => {
				saved = context;
				context.contributions.toolbar(toolbarContribution);
				context.own(unsubscribe);
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
		expect(() => saved.contributions.toolbar(toolbarContribution)).toThrow('revoked');
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

	it('revokes stale contexts and retained commands across re-enable', () => {
		const { host, registries } = setup();
		const contexts: PluginContext<string>[] = [];
		const execute = vi.fn(() => true);
		host.register(
			plugin('one', (context) => {
				contexts.push(context);
				context.contributions.command({ id: 'run', name: 'Run', execute });
			}),
		);
		host.activate('one');
		const oldCommand = registries.command.items.get('run')!.contribution;
		expect(oldCommand.execute()).toBe(true);
		host.deactivate('one');
		expect(oldCommand.execute()).toBe(false);
		expect(contexts[0].signal.aborted).toBe(true);
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

	it('revokes individually released commands before registry cleanup can throw', () => {
		const { host, registries } = setup();
		let releaseCommand!: Dispose;
		const cleanup = vi.fn(() => {
			throw new Error('registry cleanup failed');
		});
		vi.mocked(registries.command.register).mockImplementationOnce((ownerId, contribution) => {
			registries.command.items.set(contribution.id, { ownerId, contribution });
			return cleanup;
		});
		host.register(
			plugin('one', (context) => {
				releaseCommand = context.contributions.command({
					id: 'run',
					name: 'Run',
					execute: () => true,
				});
			}),
		);
		host.activate('one');
		const retained = registries.command.items.get('run')!.contribution;
		releaseCommand();
		expect(retained.execute()).toBe(false);
		releaseCommand();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.deactivate('one').errors[0].message).toBe('registry cleanup failed');
	});

	it('enforces capability declarations before touching registries', () => {
		const { host, registries } = setup();
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
		expect(() => saved.contributions.toolbar(toolbarContribution)).toThrow('contributions.toolbar');
		expect(() => saved.contributions.view({ id: 'v', name: 'V', presentation: 'v' })).toThrow(
			'contributions.view',
		);
		expect(() => saved.contributions.command({ id: 'c', name: 'C', execute: () => true })).toThrow(
			'contributions.command',
		);
		expect(registries.toolbar.register).not.toHaveBeenCalled();
		expect(registries.view.register).not.toHaveBeenCalled();
		expect(registries.command.register).not.toHaveBeenCalled();
		expect(Object.keys(saved).sort()).toEqual(['contributions', 'own', 'signal']);
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
