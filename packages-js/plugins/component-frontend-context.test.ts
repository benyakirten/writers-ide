import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { FrontendContext, FrontendEntry } from '@writers-ide/plugins';
import type { NativeServices } from '@writers-ide/plugins/native';
import type { CommandContext, ComponentDescriptor } from './command-component-model';
import { createHost, descriptor } from './command-component-fixture';

it('uses the author context and entry activation contract without a duplicate shape', () => {
	expectTypeOf<CommandContext<string>>().toEqualTypeOf<FrontendContext<string>>();
	expectTypeOf<ComponentDescriptor<string>['activate']>().toEqualTypeOf<
		FrontendEntry<string>['activate']
	>();
	expectTypeOf<CommandContext['native']>().toEqualTypeOf<NativeServices>();
});

describe.each(['application', 'project'] as const)('%s no-native frontend context', (scope) => {
	it('accepts an author entry and keeps null native groups immutable across activation lifetimes', () => {
		const host = createHost();
		const project = host.openProject('project', 'Project');
		const contexts: FrontendContext<unknown>[] = [];
		const cleanup = vi.fn();
		const owned = vi.fn();
		const entry: FrontendEntry<unknown> = {
			activate(context) {
				contexts.push(context);
				context.own(() => {
					expect(context.signal.aborted).toBe(true);
					owned();
				});
				return cleanup;
			},
		};
		host.register(
			descriptor('entry', entry.activate, {
				identity: {
					packageId: 'test-package',
					componentId: 'frontend',
					projectOpeningId: scope === 'project' ? project.openingId : null,
				},
			}),
		);

		host.activate('entry');
		const first = contexts[0];
		expect(first.project).toBe(scope === 'project' ? project : null);
		expect(first.projects === null).toBe(scope === 'project');
		expect(first.signal.aborted).toBe(false);
		expect(first.native).toEqual({ projectFiles: null, externalLinks: null });
		expect(Object.isFrozen(first)).toBe(true);
		expect(Object.isFrozen(first.native)).toBe(true);
		expect(Reflect.set(first.native, 'projectFiles', {})).toBe(false);
		expect(Reflect.set(first.native, 'externalLinks', {})).toBe(false);
		expect(Reflect.set(first, 'native', {})).toBe(false);

		host.deactivate('entry');
		expect(first.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledTimes(1);
		expect(owned).toHaveBeenCalledTimes(1);
		host.activate('entry');
		const second = contexts[1];
		expect(second).not.toBe(first);
		expect(second.identity.activationId).not.toBe(first.identity.activationId);
		expect(second.signal.aborted).toBe(false);
		expect(first.signal.aborted).toBe(true);
		for (const context of contexts) {
			expect(context.native).toEqual({ projectFiles: null, externalLinks: null });
			expect(Object.isFrozen(context.native)).toBe(true);
		}

		host.dispose();
		expect(second.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledTimes(2);
		expect(owned).toHaveBeenCalledTimes(2);
	});

	it('rolls back a failed author entry and retains no live activation', () => {
		const host = createHost();
		const project = host.openProject('project', 'Project');
		let context!: FrontendContext<unknown>;
		const cleanup = vi.fn();
		const entry: FrontendEntry<unknown> = {
			activate(value) {
				context = value;
				value.own(cleanup);
				expect(value.native).toEqual({ projectFiles: null, externalLinks: null });
				throw new Error('setup failed');
			},
		};
		host.register(
			descriptor('entry', entry.activate, {
				identity: {
					packageId: 'test-package',
					componentId: 'frontend',
					projectOpeningId: scope === 'project' ? project.openingId : null,
				},
			}),
		);
		expect(() => host.activate('entry')).toThrow('setup failed');
		expect(host.get('entry')?.status).toBe('failed');
		expect(context.signal.aborted).toBe(true);
		expect(Object.isFrozen(context.native)).toBe(true);
		expect(context.native).toEqual({ projectFiles: null, externalLinks: null });
		expect(cleanup).toHaveBeenCalledTimes(1);
		host.dispose();
		expect(cleanup).toHaveBeenCalledTimes(1);
	});
});
