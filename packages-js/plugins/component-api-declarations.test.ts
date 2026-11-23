import { describe, expect, it, vi } from 'vitest';
import { CommandComponentHost } from './command-component-host';
import { capture, type ComponentDescriptor } from './command-component-model';
import { descriptor } from './command-component-fixture';
import { api, api2, apiProvider, requirement } from './component-api-fixture';

describe('component API descriptor capture', () => {
	it.each([
		undefined,
		null,
		{},
		{ packageId: 'pkg', componentId: 'component' },
		{ packageId: '@ns/pkg/extra', componentId: 'component', projectOpeningId: null },
		{ packageId: '@NS/pkg', componentId: 'component', projectOpeningId: null },
		{ packageId: 'pkg', componentId: 'Component', projectOpeningId: null },
		{ packageId: 'pkg', componentId: 'component', projectOpeningId: '' },
		{ packageId: 'pkg', componentId: 'component', projectOpeningId: 1 },
		{ packageId: 'a'.repeat(257), componentId: 'component', projectOpeningId: null },
		{ packageId: '@' + 'a'.repeat(257) + '/pkg', componentId: 'component', projectOpeningId: null },
		{ packageId: 'pkg', componentId: 'a'.repeat(257), projectOpeningId: null },
	])('rejects invalid or absent explicit identity: %j', (identity) => {
		const host = new CommandComponentHost();
		expect(() =>
			host.register({ ...descriptor('opaque-slot'), identity } as ComponentDescriptor),
		).toThrow();
	});

	it('accepts separately bounded canonical package parts and opaque openings without deriving slots', () => {
		const identity = {
			packageId: '@' + 'a'.repeat(256) + '/' + 'b'.repeat(256),
			componentId: 'c'.repeat(256),
			projectOpeningId: ' ',
		};
		const captured = capture(descriptor('not-an-identity / slot', undefined, { identity }));
		expect(captured.identity).toEqual(identity);
		expect(Object.isFrozen(captured.identity)).toBe(true);
	});

	it.each([
		{ id: '', major: 1 },
		{ id: ' \t', major: 1 },
		{ id: 'é'.repeat(129), major: 1 },
		{ id: 'id', major: 0 },
		{ id: 'id', major: 1.5 },
		{ id: 'id', major: Number.MAX_SAFE_INTEGER + 1 },
		{ id: 'id', major: '1' },
		{ id: 12, major: 1 },
		null,
	])('rejects invalid provided and requested API identity %j', (bad) => {
		for (const extra of [
			{ provides: [bad] },
			{ dependencies: [{ ...requirement(), apis: [bad] }] },
		]) {
			expect(() =>
				capture(descriptor('slot', undefined, extra as Partial<ComponentDescriptor>)),
			).toThrow();
		}
	});

	it('preserves exact flexible IDs and distinct majors, and freezes every declaration layer', () => {
		const identity = { ...descriptor('x').identity };
		const provided = [{ ...api }, { ...api2 }];
		const requested = [{ ...api }, { ...api2 }];
		const dependency = { ...requirement(), apis: requested };
		const captured = capture(
			descriptor('x', undefined, { identity, provides: provided, dependencies: [dependency] }),
		);
		identity.packageId = 'changed';
		provided[0].id = 'changed';
		requested.length = 0;
		expect(captured.provides).toEqual([api, api2]);
		expect(captured.dependencies[0].apis).toEqual([api, api2]);
		expect(captured.identity.packageId).toBe('test-fixture');
		for (const value of [
			captured,
			captured.identity,
			captured.provides,
			captured.provides![0],
			captured.dependencies,
			captured.dependencies[0],
			captured.dependencies[0].apis,
			captured.dependencies[0].apis![0],
		]) {
			expect(Object.isFrozen(value)).toBe(true);
		}
	});

	it.each(['provides', 'apis'])(
		'rejects duplicate pairs but allows up to 32 distinct pairs in %s',
		(field) => {
			const input = (pairs: unknown) =>
				descriptor(
					'slot',
					undefined,
					field === 'provides'
						? ({ provides: pairs } as Partial<ComponentDescriptor>)
						: ({
								dependencies: [{ ...requirement(), apis: pairs }],
							} as Partial<ComponentDescriptor>),
				);
			expect(() => capture(input([api, api]))).toThrow('Duplicate');
			expect(() =>
				capture(
					input(Array.from({ length: 32 }, (_, index) => ({ id: api.id, major: index + 1 }))),
				),
			).not.toThrow();
			expect(() =>
				capture(
					input(Array.from({ length: 33 }, (_, index) => ({ id: api.id, major: index + 1 }))),
				),
			).toThrow('32');
			for (const invalid of [null, {}, 'apis']) {
				expect(() => capture(input(invalid))).toThrow();
			}
		},
	);

	it('defaults only absent API lists and preserves lifecycle-only dependencies', () => {
		const captured = capture(
			descriptor('slot', undefined, {
				dependencies: [{ alias: 'lifecycle', providerSlot: 'provider', commands: [] }],
			}),
		);
		expect(captured.provides).toEqual([]);
		expect(captured.dependencies[0].apis).toEqual([]);
		const host = new CommandComponentHost();
		const order: string[] = [];
		host.register(
			descriptor('provider', () => {
				order.push('provider');
			}),
		);
		host.register({
			...captured,
			activate: () => {
				order.push('consumer');
			},
		});
		host.activate('slot');
		expect(order).toEqual(['provider', 'consumer']);
		expect(host.planDeactivation('provider')).toEqual(['slot', 'provider']);
		host.dispose();
	});

	it('requires every requested major and rejects the entire closure before callbacks', () => {
		const host = new CommandComponentHost();
		const activate = vi.fn();
		host.register(apiProvider(undefined, 'provider', { activate }));
		host.register(
			descriptor('middle', activate, { dependencies: [{ ...requirement(), apis: [api, api2] }] }),
		);
		host.register(
			descriptor('root', activate, {
				dependencies: [{ alias: 'middle', providerSlot: 'middle', commands: [] }],
			}),
		);
		expect(() => host.activate('root')).toThrow('incompatible');
		expect(activate).not.toHaveBeenCalled();
		host.dispose();
	});
});
