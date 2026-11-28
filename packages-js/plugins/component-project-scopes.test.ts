import { describe, expect, it, vi } from 'vitest';
import { createHost, descriptor, contract } from './command-component-fixture';
import { api } from './component-api-fixture';
import { application, projectProvider, selected, target } from './component-project-fixture';
import type { CommandContext, Dependency } from './command-component-model';
import type { ProjectReference } from './frontend';

describe('internal project scopes and references', () => {
	it('delivers the scope union, fixed issued reference and matching activation identity', () => {
		const host = createHost();
		const project = host.openProject('stable', 'Display only');
		const other = host.openProject('other', 'Display only');
		const app = application(host);
		let context!: CommandContext;
		host.register(
			descriptor(
				'project',
				(value) => {
					context = value;
				},
				{
					identity: { ...target, projectOpeningId: project.openingId },
				},
			),
		);
		host.activate('project');
		expect(context.project).toBe(project);
		expect(context.projects).toBeNull();
		expect(context.identity.projectOpeningId).toBe(project.openingId);
		expect(app.project).toBeNull();
		expect(app.identity.projectOpeningId).toBeNull();
		expect(Object.isFrozen(project)).toBe(true);
		host.selectProject(other);
		expect(context.project).toBe(project);
		host.dispose();
	});

	it('rejects copied, foreign, proxy and closed references without reading sender fields', () => {
		const host = createHost();
		const foreign = createHost();
		const ref = host.openProject('stable', 'Name');
		const app = application(host);
		const getter = vi.fn(() => {
			throw new Error('must not read');
		});
		const proxy = new Proxy(ref, { get: getter });
		for (const invalid of [{ ...ref }, foreign.openProject('stable', 'Name'), proxy, null]) {
			expect(() => app.projects.connect(invalid as ProjectReference)).toThrow();
		}
		expect(getter).not.toHaveBeenCalled();
		const old = app.projects.connect(ref);
		host.closeProject(ref);
		const reopened = host.openProject('stable', 'Renamed');
		expect(reopened.id).toBe(ref.id);
		expect(reopened.openingId).not.toBe(ref.openingId);
		expect(() => app.projects.connect(ref)).toThrow();
		expect(() => host.selectProject(ref)).toThrow();
		expect(() => host.closeProject(ref)).toThrow();
		expect(old.signal.aborted).toBe(true);
		expect(app.projects.connect(reopened).signal.aborted).toBe(false);
		host.dispose();
		foreign.dispose();
	});

	it('rejects unknown openings on register and closed openings on activate', () => {
		const host = createHost();
		expect(() =>
			host.register(
				descriptor('bad', undefined, {
					identity: { ...target, projectOpeningId: 'arbitrary' },
				}),
			),
		).toThrow(/opening/);
		const project = host.openProject('id', 'Name');
		host.register(projectProvider(project));
		host.closeProject(project);
		expect(() => host.activate('provider')).toThrow(/opening/);
		host.dispose();
	});

	it.each([false, true])(
		'rejects application to project direct dependencies, optional=%s',
		(optional) => {
			const host = createHost();
			const ref = host.openProject('id', 'Name');
			host.register(projectProvider(ref));
			expect(() =>
				application(host, undefined, {
					dependencies: [{ alias: 'bad', providerSlot: 'provider', optional, commands: [] }],
				}),
			).toThrow(/same project/);
			host.dispose();
		},
	);

	it('checks scopes when a previously missing optional slot arrives and rejects cross-project slots', () => {
		const host = createHost();
		const one = host.openProject('one', 'One');
		const two = host.openProject('two', 'Two');
		application(host, undefined, {
			dependencies: [{ alias: 'bad', providerSlot: 'later', optional: true, commands: [] }],
		});
		expect(() => host.register(projectProvider(one, 'later'))).toThrow(/same project/);
		host.register(projectProvider(one));
		expect(() =>
			host.register(
				descriptor('cross', undefined, {
					identity: {
						packageId: 'consumer',
						componentId: 'cross',
						projectOpeningId: two.openingId,
					},
					dependencies: [{ alias: 'bad', providerSlot: 'provider', optional: true, commands: [] }],
				}),
			),
		).toThrow(/same project/);
		host.dispose();
	});

	it('rejects ambiguous actual identities and duplicate selected targets', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		host.register(projectProvider(ref));
		expect(() => host.register(projectProvider(ref, 'second'))).toThrow(/already registered/);
		expect(() =>
			application(host, undefined, { dependencies: [selected(), selected({ alias: 'another' })] }),
		).toThrow(/Duplicate/);
		host.dispose();
	});

	it.each([{ optional: false }, { providerSlot: 'provider' }])(
		'rejects invalid selected declaration %j',
		(extra) => {
			const host = createHost();
			expect(() =>
				application(host, undefined, { dependencies: [{ ...selected(), ...extra } as Dependency] }),
			).toThrow();
			host.dispose();
		},
	);

	it('rejects selected bindings on project consumers', () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		expect(() =>
			host.register(projectProvider(ref, 'bad', undefined, { dependencies: [selected()] })),
		).toThrow(/application consumer/);
		host.dispose();
	});

	it('treats wrong API and command routes as author errors, never normal absence', async () => {
		const host = createHost();
		const ref = host.openProject('id', 'Name');
		const app = application(host, undefined, {
			dependencies: [
				selected(),
				{
					alias: 'direct',
					providerSlot: 'absent',
					optional: true,
					apis: [api],
					commands: [{ id: 'local.ID', contractId: contract.id, major: 1, alias: 'run' }],
				},
			],
		});
		const lease = app.projects.connect(ref);
		expect(() => app.apis.get('project-service', api)).toThrow(/route/);
		expect(() => app.apis.subscribe('project-service', api, () => undefined)).toThrow(/route/);
		expect(() => app.commands.isAvailable('project-service', 'run', contract)).toThrow(
			expect.objectContaining({ code: 'invalid-reference' }),
		);
		await expect(
			app.commands.execute('project-service', 'run', contract, null),
		).rejects.toMatchObject({ code: 'invalid-reference' });
		expect(() => lease.get('direct', api)).toThrow(/route/);
		expect(() => lease.commands.isAvailable('direct', 'run', contract)).toThrow(
			expect.objectContaining({ code: 'invalid-reference' }),
		);
		await expect(lease.commands.execute('direct', 'run', contract, null)).rejects.toMatchObject({
			code: 'invalid-reference',
		});
		host.dispose();
	});
});
