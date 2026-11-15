import { describe, expect, it, vi } from 'vitest';
import type { Dispose, PluginContext } from '@writers-ide/plugins';
import type { SveltePresentation, SvelteToolbarContribution } from '@writers-ide/plugins/svelte';
import { PluginHost } from '$lib/plugins/plugin-host';
import type { FormattingRequest, FormattingService, FormattingSnapshot } from './contracts';
import { scopeFormattingService } from './scope-formatting-service';
import { createFormattingPlugin } from './menu';

function snapshot(): FormattingSnapshot {
	return {
		viewId: 'one',
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
			indent: 0,
			dedent: 1,
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
			'align-left': false,
			'align-center': true,
			'align-right': true,
			'align-justify': true,
		},
	};
}

const request: FormattingRequest = { viewId: 'one', revision: 7, command: 'bold' };
type Listener = Parameters<FormattingService['subscribe']>[0];

function source(initial: FormattingSnapshot | null = snapshot()) {
	const listeners = new Set<Listener>();
	const retained: Listener[] = [];
	const unsubscribe = vi.fn();
	const service: FormattingService = {
		subscribe: vi.fn((listener) => {
			listeners.add(listener);
			retained.push(listener);
			listener(initial);
			return () => {
				listeners.delete(listener);
				unsubscribe();
			};
		}),
		execute: vi.fn(() => true),
	};
	return { service, listeners, retained, unsubscribe };
}

function fixture(service: FormattingService, setup?: (scoped: FormattingService) => void) {
	let scoped!: FormattingService;
	let context!: PluginContext<unknown>;
	const host = new PluginHost<unknown>({
		registries: {
			toolbar: { register: () => () => {} },
			view: { register: () => () => {} },
			command: { register: () => () => {} },
		},
	});
	host.register({
		manifest: {
			id: 'formatting',
			name: 'Formatting',
			description: 'Formatting lifecycle test',
			version: '0.1.0',
			apiVersion: 1,
			capabilities: [],
		},
		activate(owner) {
			context = owner;
			scoped = scopeFormattingService(service, owner);
			setup?.(scoped);
		},
	});
	host.activate('formatting');
	return {
		host,
		get scoped() {
			return scoped;
		},
		get context() {
			return context;
		},
	};
}

describe('feature-owned formatting activation scope', () => {
	it.each([null, snapshot()])(
		'delivers immediate initial state %o and owns independent subscriptions',
		(initial) => {
			const s = source(initial);
			const f = fixture(s.service);
			const listener = vi.fn();
			const first = f.scoped.subscribe(listener);
			f.scoped.subscribe(listener);
			expect(listener).toHaveBeenCalledTimes(2);
			expect(listener).toHaveBeenLastCalledWith(initial);
			first();
			first();
			expect(s.unsubscribe).toHaveBeenCalledTimes(1);
			expect(s.listeners.size).toBe(1);
			f.host.deactivate('formatting');
			expect(s.unsubscribe).toHaveBeenCalledTimes(2);
			expect(s.listeners.size).toBe(0);
		},
	);

	it('clones all snapshot records separately for each delivery and listener', () => {
		const value = snapshot();
		const s = source(value);
		const f = fixture(s.service);
		const first = vi.fn();
		const second = vi.fn();
		f.scoped.subscribe(first);
		f.scoped.subscribe(second);
		const delivered = first.mock.calls[0][0] as FormattingSnapshot;
		expect(delivered).not.toBe(value);
		expect(delivered.marks).not.toBe(value.marks);
		expect(delivered.blocks).not.toBe(value.blocks);
		expect(delivered.enabled).not.toBe(value.enabled);
		delivered.viewId = 'changed';
		delivered.marks.bold = 0;
		delivered.blocks.indent = 1;
		delivered.enabled.bold = false;
		expect(value).toEqual(snapshot());
		expect(second.mock.calls[0][0]).toEqual(value);
		s.retained[0](value);
		expect(first.mock.calls[1][0]).toEqual(value);
		expect(first.mock.calls[1][0].marks).not.toBe(second.mock.calls[0][0].marks);
		f.host.deactivate('formatting');
	});

	it('copies requests, preserves results including stale false, and revokes retained executions', () => {
		const s = source();
		const f = fixture(s.service);
		const execute = f.scoped.execute;
		const original = { ...request };
		vi.mocked(s.service.execute).mockImplementation((copy) => {
			expect(copy).toEqual(original);
			expect(copy).not.toBe(original);
			copy.revision = 99;
			return true;
		});
		expect(execute(original)).toBe(true);
		expect(original).toEqual(request);
		vi.mocked(s.service.execute).mockReturnValue(false);
		expect(execute({ ...request, revision: 0 })).toBe(false);
		f.host.deactivate('formatting');
		expect(execute(request)).toBe(false);
		expect(() => f.scoped.subscribe(vi.fn())).toThrow('revoked');
		f.host.activate('formatting');
		expect(execute(request)).toBe(false);
		vi.mocked(s.service.execute).mockReturnValue(true);
		expect(f.scoped.execute(request)).toBe(true);
		expect(s.service.execute).toHaveBeenCalledTimes(3);
		f.host.deactivate('formatting');
	});

	it('revokes retained callbacks after early release, disable, and reactivation', () => {
		const s = source();
		const f = fixture(s.service);
		const first = vi.fn();
		const release = f.scoped.subscribe(first);
		release();
		s.retained[0](snapshot());
		expect(first).toHaveBeenCalledTimes(1);
		const second = vi.fn();
		f.scoped.subscribe(second);
		f.host.deactivate('formatting');
		s.retained[1](snapshot());
		expect(second).toHaveBeenCalledTimes(1);
		f.host.activate('formatting');
		const third = vi.fn();
		f.scoped.subscribe(third);
		s.retained[1](snapshot());
		s.retained[2](null);
		expect(second).toHaveBeenCalledTimes(1);
		expect(third).toHaveBeenLastCalledWith(null);
		f.host.deactivate('formatting');
		expect(s.unsubscribe).toHaveBeenCalledTimes(3);
	});

	it('releases and revokes subscriptions and commands on activation rollback', () => {
		const s = source();
		const listener = vi.fn();
		const f = fixture(s.service, (scoped) => {
			scoped.subscribe(listener);
			throw new Error('activation failed');
		});
		expect(f.host.get('formatting')?.status).toBe('failed');
		expect(s.unsubscribe).toHaveBeenCalledOnce();
		s.retained[0](snapshot());
		expect(listener).toHaveBeenCalledOnce();
		expect(f.scoped.execute(request)).toBe(false);
	});

	it.each([false, true])(
		'cleans up an immediate listener failure (throwing unsubscribe: %s)',
		(throws) => {
			const s = source();
			if (throws) {
				s.unsubscribe.mockImplementation(() => {
					throw new Error('unsubscribe failed');
				});
			}
			const f = fixture(s.service);
			const listener = vi.fn(() => {
				throw new Error('listener failed');
			});
			expect(() => f.scoped.subscribe(listener)).toThrow('listener failed');
			expect(s.unsubscribe).toHaveBeenCalledOnce();
			expect(s.listeners.size).toBe(0);
			expect(() => s.retained[0](snapshot())).not.toThrow();
			expect(listener).toHaveBeenCalledOnce();
			expect(f.host.get('formatting')?.errors).toEqual(
				throws ? [{ phase: 'cleanup', message: 'unsubscribe failed' }] : [],
			);
			f.host.deactivate('formatting');
			expect(s.unsubscribe).toHaveBeenCalledOnce();
		},
	);

	it('continues owned cleanup after a throwing unsubscribe and revokes its retained callback', () => {
		const s = source();
		s.unsubscribe.mockImplementation(() => {
			throw new Error('cleanup failed');
		});
		const f = fixture(s.service);
		const other = vi.fn();
		f.context.own(other);
		const listener = vi.fn();
		f.scoped.subscribe(listener);
		expect(f.host.deactivate('formatting').errors).toEqual([
			{ phase: 'cleanup', message: 'cleanup failed' },
		]);
		expect(other).toHaveBeenCalledOnce();
		s.retained[0](snapshot());
		expect(listener).toHaveBeenCalledOnce();
	});

	it('revokes a retained callback when source setup throws before returning its handle', () => {
		let retained!: Listener;
		const service: FormattingService = {
			subscribe(listener) {
				retained = listener;
				listener(null);
				throw new Error('source setup failed');
			},
			execute: () => true,
		};
		const f = fixture(service);
		const listener = vi.fn();
		expect(() => f.scoped.subscribe(listener)).toThrow('source setup failed');
		retained(snapshot());
		expect(listener).toHaveBeenCalledExactlyOnceWith(null);
		f.host.deactivate('formatting');
	});

	it('cleans up a handle returned after the initial callback deactivates its owner', () => {
		const s = source();
		const f = fixture(s.service);
		const listener = vi.fn(() => {
			f.host.deactivate('formatting');
		});
		const release = f.scoped.subscribe(listener);
		expect(s.unsubscribe).toHaveBeenCalledOnce();
		expect(s.listeners.size).toBe(0);
		s.retained[0](snapshot());
		release();
		expect(listener).toHaveBeenCalledOnce();
		expect(s.unsubscribe).toHaveBeenCalledOnce();
	});

	it('propagates update listener failures without implicitly releasing a live subscription', () => {
		const s = source();
		const f = fixture(s.service);
		const listener = vi.fn();
		const release = f.scoped.subscribe(listener);
		listener.mockImplementation(() => {
			throw new Error('update failed');
		});
		expect(() => s.retained[0](snapshot())).toThrow('update failed');
		expect(s.unsubscribe).not.toHaveBeenCalled();
		release();
		expect(s.unsubscribe).toHaveBeenCalledOnce();
		f.host.deactivate('formatting');
	});
});

describe('formatting factory composition', () => {
	it('supplies only a shared activation-scoped formatting prop and creates a fresh scope on reactivation', () => {
		const s = source();
		const toolbars: SvelteToolbarContribution[] = [];
		const cleanup = vi.fn();
		const host = new PluginHost<SveltePresentation>({
			registries: {
				toolbar: {
					register(_owner, contribution) {
						toolbars.push(contribution);
						return cleanup;
					},
				},
				view: { register: () => () => {} },
				command: { register: () => () => {} },
			},
		});
		const plugin = createFormattingPlugin(s.service);
		host.register(plugin);
		host.activate(plugin.manifest.id);
		const first = toolbars[0].horizontal.presentation.props;
		expect(Object.keys(first)).toEqual(['formatting']);
		expect(first).toBe(toolbars[0].vertical.presentation.props);
		expect(first.formatting).not.toBe(s.service);
		const formatting = first.formatting as FormattingService;
		const listener = vi.fn();
		const release: Dispose = formatting.subscribe(listener);
		host.deactivate(plugin.manifest.id);
		release();
		expect(cleanup).toHaveBeenCalledOnce();
		expect(s.unsubscribe).toHaveBeenCalledOnce();
		expect(formatting.execute(request)).toBe(false);
		host.activate(plugin.manifest.id);
		const next = toolbars[1].horizontal.presentation.props.formatting as FormattingService;
		expect(next).not.toBe(formatting);
		expect(next.execute(request)).toBe(true);
		expect(formatting.execute(request)).toBe(false);
		host.deactivate(plugin.manifest.id);
	});
});
