import { describe, expect, it, vi } from 'vitest';
import { CommandComponentHost, type PresentationRecord } from './command-component-host';
import type { CommandContext, ComponentDescriptor } from './command-component-model';
import type { Dispose, ToolbarContribution, ViewContribution } from './index';
import {
	createHost,
	dependency,
	descriptor,
	flush,
	publish,
	provider,
} from './command-component-fixture';

const view = (id = 'local'): ViewContribution<unknown> => ({ id, name: 'View', presentation: {} });
const toolbar = (id = 'local'): ToolbarContribution<unknown> => ({
	id,
	name: 'Toolbar',
	horizontal: { presentation: {}, size: 1 },
	vertical: { presentation: {}, size: 3 },
});
const capabilities = ['contributions.toolbar', 'contributions.view'] as const;

function ui(
	slot: string,
	activate: ComponentDescriptor['activate'] = (context) => {
		context.contributions.toolbar(toolbar());
		context.contributions.view(view());
	},
	extra: Partial<ComponentDescriptor> = {},
) {
	return descriptor(slot, activate, { capabilities, ...extra });
}

describe('internal UI contribution routing', () => {
	it('stages UI, captures immutable metadata and exposes all three contribution methods', () => {
		const host = createHost();
		const events: (readonly PresentationRecord[])[] = [];
		host.subscribePresentations((records) => events.push(records));
		const input = toolbar();
		let context!: CommandContext;
		host.register({
			...provider((value) => {
				context = value;
				publish(value);
				value.contributions.toolbar(input);
				value.contributions.view(view());
				expect(host.presentations()).toEqual([]);
			}),
			capabilities: [...capabilities, 'contributions.command'],
		});
		host.activate('provider');
		const records = host.presentations();
		expect(records.map((record) => record.kind)).toEqual(['toolbar', 'view']);
		expect(records.every((record) => record.visible && record.project === null)).toBe(true);
		expect(records[0].identity).toBe(context.identity);
		expect(records[0].id).not.toBe(records[1].id);
		expect(records[0].placementId).not.toBe(records[1].placementId);
		expect(JSON.parse(records[0].id)).toEqual([context.identity.activationId, 'toolbar', 'local']);
		expect(events.map((snapshot) => snapshot.length)).toEqual([0, 0, 2]);
		expect(Object.isFrozen(records)).toBe(true);
		expect(Object.isFrozen(records[0])).toBe(true);
		expect(Object.isFrozen(records[0].contribution)).toBe(true);
		if (records[0].kind !== 'toolbar') {
			throw new Error('Expected toolbar');
		}
		expect(Object.isFrozen(records[0].contribution.horizontal)).toBe(true);
		expect(records[0].contribution.horizontal.presentation).toBe(input.horizontal.presentation);
		(input as { name: string }).name = 'Changed';
		(input.horizontal as { size: number }).size = 2;
		expect(records[0].contribution.name).toBe('Toolbar');
		expect(records[0].contribution.horizontal.size).toBe(1);
		host.dispose();
		expect(events.at(-1)).toEqual([]);
	});

	it('filters project visibility without stopping activation or services and preserves placement across reopen', () => {
		const host = createHost();
		const first = host.openProject('first', 'First');
		const second = host.openProject('second', 'Second');
		let context!: CommandContext;
		const snapshots: (readonly PresentationRecord[])[] = [];
		host.subscribePresentations((records) => snapshots.push(records));
		const cleanup = vi.fn();
		const identity = { packageId: 'feature', componentId: 'ui', projectOpeningId: first.openingId };
		host.register(
			ui(
				'first',
				(value) => {
					context = value;
					value.contributions.view(view());
					return cleanup;
				},
				{ identity },
			),
		);
		host.register(
			ui('second', undefined, { identity: { ...identity, projectOpeningId: second.openingId } }),
		);
		host.register(ui('application'));
		host.activate('first');
		host.activate('second');
		host.activate('application');
		const original = host.presentations()[0];
		expect(original.visible).toBe(false);
		expect(original.project).toBe(first);
		host.selectProject(first);
		expect(host.presentations().filter((record) => record.visible)).toHaveLength(3);
		host.selectProject(second);
		expect(snapshots.at(-1)?.filter((record) => record.visible)).toHaveLength(4);
		expect(host.presentations()[0]).toMatchObject({
			visible: false,
			id: original.id,
			project: first,
		});
		expect(context.signal.aborted).toBe(false);
		expect(context.locale.snapshot().languageTag).toBe('en-US');
		expect(context.project).toBe(first);
		expect(cleanup).not.toHaveBeenCalled();
		host.selectProject(null);
		expect(host.presentations().filter((record) => record.visible)).toHaveLength(2);
		host.selectProject(first);
		expect(host.presentations()[0]).toMatchObject({ visible: true, id: original.id });
		host.closeProject(first);
		expect(context.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.presentations()).toHaveLength(4);
		const reopened = host.openProject('first', 'Renamed');
		expect(() => host.activate('first')).toThrow('closed');
		host.unregister('first');
		host.register(
			ui(
				'reopened',
				(value) => {
					value.contributions.view(view());
				},
				{
					identity: { ...identity, projectOpeningId: reopened.openingId },
				},
			),
		);
		host.activate('reopened');
		const replacement = host.presentations().find((record) => record.project === reopened)!;
		expect(replacement.placementId).toBe(original.placementId);
		expect(replacement.id).not.toBe(original.id);
		expect(replacement.identity.projectOpeningId).toBe(reopened.openingId);
		expect(replacement.project).toBe(reopened);
		expect(replacement.visible).toBe(false);
		host.dispose();
	});

	it('removes individual records idempotently and makes old handles harmless after reactivation', () => {
		const host = createHost();
		let release!: Dispose;
		let context!: CommandContext;
		host.register(
			ui('ui', (value) => {
				context = value;
				release = value.contributions.view(view());
				value.contributions.toolbar(toolbar());
			}),
		);
		host.activate('ui');
		const original = host.presentations();
		const stale = release;
		release();
		release();
		expect(host.presentations().map((record) => record.kind)).toEqual(['toolbar']);
		expect(context.signal.aborted).toBe(false);
		host.deactivate('ui');
		expect(host.presentations()).toEqual([]);
		host.activate('ui');
		stale();
		expect(host.presentations()).toHaveLength(2);
		expect(host.presentations().map((record) => record.placementId)).toEqual(
			original.map((record) => record.placementId),
		);
		expect(host.presentations()[0].id).not.toBe(original[0].id);
		host.unregister('ui');
		release();
		expect(host.presentations()).toEqual([]);
		host.dispose();
		host.dispose();
	});

	it('allows early setup disposal without publication or activation failure', () => {
		const host = createHost();
		host.register(
			ui('ui', (context) => {
				const release = context.contributions.view(view());
				release();
				release();
				context.contributions.toolbar(toolbar());
			}),
		);
		host.activate('ui');
		expect(host.get('ui')?.status).toBe('active');
		expect(host.presentations().map((record) => record.kind)).toEqual(['toolbar']);
		host.dispose();
	});

	it.each([
		'duplicate',
		'disposed-duplicate',
		'capability',
		'invalid-size',
		'invalid-name',
		'invalid-id',
		'missing-presentation',
		'throw',
	])('rolls back all staged UI on sticky %s failure', (failure) => {
		const host = createHost();
		const events: number[] = [];
		host.subscribePresentations((records) => events.push(records.length));
		const cleanup = vi.fn();
		let context!: CommandContext;
		host.register(
			ui(
				'ui',
				(value) => {
					context = value;
					value.own(cleanup);
					const release = value.contributions.view(view());
					try {
						switch (failure) {
							case 'disposed-duplicate':
								release();
								value.contributions.view(view());
								break;
							case 'duplicate':
								value.contributions.view(view());
								break;
							case 'capability':
								value.contributions.toolbar(toolbar());
								break;
							case 'invalid-size':
								value.contributions.toolbar({
									...toolbar(),
									horizontal: { presentation: {}, size: 4 as 1 },
								});
								break;
							case 'invalid-name':
								value.contributions.view({ ...view('other'), name: ' ' });
								break;
							case 'invalid-id':
								value.contributions.view(view(''));
								break;
							case 'missing-presentation':
								value.contributions.view({
									id: 'other',
									name: 'Missing',
								} as ViewContribution<unknown>);
								break;
							case 'throw':
								throw new Error('setup failed');
						}
					} catch (error) {
						if (failure === 'throw') {
							throw error;
						}
					}
				},
				{ capabilities: failure === 'capability' ? ['contributions.view'] : capabilities },
			),
		);
		expect(() => host.activate('ui')).toThrow();
		expect(host.get('ui')?.status).toBe('failed');
		expect(context.signal.aborted).toBe(true);
		expect(cleanup).toHaveBeenCalledOnce();
		expect(host.presentations()).toEqual([]);
		expect(events.every((length) => length === 0)).toBe(true);
		host.dispose();
	});

	it('validates capabilities and namespaces UI separately from command IDs', () => {
		const host = createHost();
		expect(() =>
			host.register(
				ui('duplicate', undefined, { capabilities: ['contributions.view', 'contributions.view'] }),
			),
		).toThrow('Duplicate');
		expect(() =>
			host.register(
				ui('unknown', undefined, { capabilities: ['invalid' as 'contributions.view'] }),
			),
		).toThrow('Unsupported');
		host.register({
			...provider((context) => {
				publish(context);
				context.contributions.view(view('local.ID'));
				context.contributions.toolbar(toolbar('local.ID'));
			}, 'one'),
			capabilities: [...capabilities, 'contributions.command'],
		});
		host.register(ui('two'));
		host.activate('one');
		host.activate('two');
		expect(new Set(host.presentations().map((record) => record.id)).size).toBe(4);
		expect(new Set(host.presentations().map((record) => record.placementId)).size).toBe(4);
		host.dispose();
	});

	it('isolates throwing and rejecting observers and guards lifecycle and publication disposal', async () => {
		const host = createHost();
		let release: Dispose = () => undefined;
		let context!: CommandContext;
		host.register(
			ui('ui', (value) => {
				context = value;
				release = value.contributions.view(view());
			}),
		);
		const failures: string[] = [];
		const attempt = (callback: () => void) => {
			try {
				callback();
				failures.push('unexpected success');
			} catch (error) {
				failures.push((error as Error).message);
			}
		};
		const guarded = vi.fn(() => {
			attempt(() => host.deactivate('ui'));
			attempt(() => host.selectProject(null));
			attempt(() => host.dispose());
			if (host.presentations().length > 0) {
				attempt(release);
			}
		});
		host.subscribePresentations(guarded);
		host.subscribePresentations(() => {
			throw new Error('observer failure');
		});
		host.subscribePresentations(async () => {
			throw new Error('async observer failure');
		});
		const sibling = vi.fn();
		const unsubscribe = host.subscribePresentations(sibling);
		host.activate('ui');
		expect(host.presentations()).toHaveLength(1);
		expect(context.signal.aborted).toBe(false);
		expect(guarded).toHaveBeenCalledTimes(2);
		expect(failures).toHaveLength(7);
		expect(failures.every((message) => message.includes('busy'))).toBe(true);
		expect(sibling).toHaveBeenCalledTimes(2);
		unsubscribe();
		unsubscribe();
		host.dispose();
		expect(sibling).toHaveBeenCalledTimes(2);
		expect(() => host.subscribePresentations(() => undefined)).toThrow('disposed');
		await flush();
	});

	it('guards setup disposal in locale callbacks and delays subscriptions created inside setup until commit', () => {
		const host = createHost();
		const delivered = vi.fn();
		const failures: string[] = [];
		host.register(
			ui('ui', (context) => {
				const release = context.contributions.view(view());
				context.locale.subscribe(() => {
					try {
						release();
					} catch (error) {
						failures.push((error as Error).message);
					}
				});
				host.subscribePresentations(delivered);
				expect(delivered).not.toHaveBeenCalled();
			}),
		);
		host.activate('ui');
		expect(failures).toHaveLength(1);
		expect(failures[0]).toContain('busy');
		expect(delivered).toHaveBeenCalledOnce();
		expect(delivered.mock.calls[0][0]).toHaveLength(1);
		host.dispose();
	});

	it('revokes UI before reverse cleanup and keeps teardown idempotent after cleanup failure', () => {
		const host = createHost();
		const order: string[] = [];
		const cleanupSnapshots: (readonly PresentationRecord[])[] = [];
		let aborted = false;
		let release!: Dispose;
		host.register(
			ui('ui', (context) => {
				release = context.contributions.view(view());
				context.own(() => {
					order.push('first');
					cleanupSnapshots.push(host.presentations());
				});
				context.own(() => {
					order.push('second');
					aborted = context.signal.aborted;
					release();
					throw new Error('cleanup failure');
				});
			}),
		);
		host.activate('ui');
		host.deactivate('ui');
		expect(order).toEqual(['second', 'first']);
		expect(aborted).toBe(true);
		expect(cleanupSnapshots).toEqual([[]]);
		expect(host.get('ui')?.errors).toEqual(['cleanup-failed']);
		host.deactivate('ui');
		release();
		expect(order).toHaveLength(2);
		host.dispose();
	});

	it('delivers only rollback state to a subscription added during failing setup', () => {
		const host = createHost();
		const observer = vi.fn();
		host.register(
			ui('ui', (context) => {
				context.contributions.view(view());
				host.subscribePresentations(observer);
				throw new Error('failed setup');
			}),
		);
		expect(() => host.activate('ui')).toThrow('failed setup');
		expect(observer).toHaveBeenCalledExactlyOnceWith([]);
		host.dispose();
	});

	it.each(['toolbar', 'view'] as const)(
		'requires the exact %s capability and rejects late registrations',
		(kind) => {
			const host = createHost();
			const register = (context: CommandContext) => {
				if (kind === 'view') {
					return context.contributions.view(view());
				}
				return context.contributions.toolbar(toolbar());
			};
			host.register(
				ui(
					'missing',
					(context) => {
						register(context);
					},
					{ capabilities: [] },
				),
			);
			expect(() => host.activate('missing')).toThrow('capability');
			let context!: CommandContext;
			host.register(
				ui('live', (value) => {
					context = value;
				}),
			);
			host.activate('live');
			expect(() => register(context)).toThrow('synchronous activation');
			host.deactivate('live');
			expect(() => register(context)).toThrow('synchronous activation');
			expect(host.presentations()).toEqual([]);
			host.dispose();
		},
	);

	it('queues nested subscriptions and honors unsubscribe during snapshot delivery', () => {
		const host = createHost();
		host.register(ui('ui'));
		const order: string[] = [];
		let removeSibling: Dispose = () => undefined;
		const nested = vi.fn(() => {
			order.push('nested');
		});
		host.subscribePresentations((records) => {
			if (records.length > 0) {
				order.push('start');
				removeSibling();
				host.subscribePresentations(nested);
				order.push('end');
			}
		});
		const sibling = vi.fn();
		removeSibling = host.subscribePresentations(sibling);
		host.activate('ui');
		expect(order).toEqual(['start', 'end', 'nested']);
		expect(sibling).toHaveBeenCalledExactlyOnceWith([]);
		expect(nested).toHaveBeenCalledOnce();
		host.dispose();
	});

	it('removes required-consumer UI when a command publication is lost without hiding provider UI', () => {
		const host = createHost();
		let removeCommand!: Dispose;
		host.register({
			...provider((context) => {
				removeCommand = publish(context);
				context.contributions.view(view());
			}),
			capabilities: ['contributions.command', 'contributions.view'],
		});
		host.register(ui('consumer', undefined, { dependencies: [dependency()] }));
		host.activate('consumer');
		expect(host.presentations()).toHaveLength(3);
		removeCommand();
		expect(host.get('consumer')?.status).toBe('disabled');
		expect(host.get('provider')?.status).toBe('active');
		expect(host.presentations()).toHaveLength(1);
		expect(host.presentations()[0].kind).toBe('view');
		host.dispose();
	});

	it('queues nested initial delivery without recursive callbacks and honors pending unsubscribe', async () => {
		const host = createHost();
		const order: string[] = [];
		const cancelled = vi.fn();
		let depth = 0;
		let maximumDepth = 0;
		const subscribe = (remaining: number) => {
			let initial = true;
			host.subscribePresentations(() => {
				if (!initial) {
					return;
				}
				initial = false;
				depth++;
				maximumDepth = Math.max(maximumDepth, depth);
				order.push(`start:${remaining}`);
				if (remaining > 0) {
					subscribe(remaining - 1);
				} else {
					const release = host.subscribePresentations(cancelled);
					release();
					host.subscribePresentations(async () => {
						throw new Error('nested rejection');
					});
				}
				order.push(`end:${remaining}`);
				depth--;
			});
		};
		subscribe(20);
		expect(maximumDepth).toBe(1);
		expect(order.slice(0, 4)).toEqual(['start:20', 'end:20', 'start:19', 'end:19']);
		expect(order).toHaveLength(42);
		expect(cancelled).not.toHaveBeenCalled();
		host.dispose();
		await flush();
	});

	it.each(['view-presentation', 'toolbar-presentation', 'name', 'id'] as const)(
		'rejects same-key getter reentry through %s even when the getter catches the duplicate',
		(source) => {
			const host = createHost();
			const observed: string[] = [];
			const setupErrors: string[] = [];
			const snapshots: (readonly PresentationRecord[])[] = [];
			host.subscribePresentations((records) => snapshots.push(records));
			host.register(
				ui('ui', (context) => {
					const kind = source === 'toolbar-presentation' ? 'toolbar' : 'view';
					const reenter = () => {
						try {
							if (kind === 'toolbar') {
								context.contributions.toolbar(toolbar());
							} else {
								context.contributions.view(view());
							}
						} catch (error) {
							observed.push((error as Error).message);
						}
					};
					try {
						if (kind === 'toolbar') {
							context.contributions.toolbar({
								...toolbar(),
								horizontal: {
									size: 1,
									get presentation() {
										reenter();
										return {};
									},
								},
							});
						} else {
							context.contributions.view({
								get id() {
									if (source === 'id') {
										reenter();
									}
									return 'local';
								},
								get name() {
									if (source === 'name') {
										reenter();
									}
									return 'View';
								},
								get presentation() {
									if (source === 'view-presentation') {
										reenter();
									}
									return {};
								},
							});
						}
					} catch (error) {
						setupErrors.push((error as Error).message);
					}
				}),
			);
			expect(() => host.activate('ui')).toThrow();
			expect(host.get('ui')?.status).toBe('failed');
			expect(host.presentations()).toEqual([]);
			expect(snapshots.every((records) => records.length === 0)).toBe(true);
			expect(setupErrors).toHaveLength(1);
			if (source !== 'id') {
				expect(observed).toEqual(['Duplicate UI publication']);
			}
			host.dispose();
		},
	);

	it('reads changing author metadata once and uses the captured ID consistently', () => {
		const host = createHost();
		let reads = 0;
		let nameReads = 0;
		let sizeReads = 0;
		let release!: Dispose;
		host.register(
			ui('ui', (context) => {
				release = context.contributions.toolbar({
					get id() {
						reads++;
						return `id-${reads}`;
					},
					get name() {
						nameReads++;
						return `Name ${nameReads}`;
					},
					horizontal: {
						presentation: {},
						get size() {
							sizeReads++;
							return sizeReads === 1 ? 1 : 3;
						},
					},
					vertical: { presentation: {}, size: 2 },
				});
			}),
		);
		host.activate('ui');
		const record = host.presentations()[0];
		expect(reads).toBe(1);
		expect(nameReads).toBe(1);
		expect(sizeReads).toBe(1);
		expect(record.contribution).toMatchObject({
			id: 'id-1',
			name: 'Name 1',
			horizontal: { size: 1 },
		});
		expect(JSON.parse(record.id)).toEqual([record.identity.activationId, 'toolbar', 'id-1']);
		expect(JSON.parse(record.placementId)).toEqual([
			record.identity.packageId,
			record.identity.componentId,
			'toolbar',
			'id-1',
			null,
		]);
		release();
		expect(host.presentations()).toEqual([]);
		host.dispose();
	});

	it('supports a concrete internal presentation type', () => {
		const host = new CommandComponentHost<string>({
			locale: {
				snapshot: () => ({ languageTag: 'en', direction: 'ltr' }),
				subscribe: () => () => undefined,
			},
		});
		const component: ComponentDescriptor<string> = {
			slotId: 'typed',
			identity: { packageId: 'typed', componentId: 'ui', projectOpeningId: null },
			capabilities: ['contributions.view'],
			commands: [],
			dependencies: [],
			activate(context) {
				context.contributions.view({ id: 'typed', name: 'Typed', presentation: 'render' });
			},
		};
		host.register(component);
		host.activate('typed');
		const record = host.presentations()[0];
		if (record.kind === 'view') {
			const presentation: string = record.contribution.presentation;
			expect(presentation).toBe('render');
		}
		host.dispose();
	});
});
