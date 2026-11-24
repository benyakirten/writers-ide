import type { FrontendContext, PluginCommand } from '@writers-ide/plugins';
import { defineSveltePresentation } from '@writers-ide/plugins/svelte';
import { IconButton } from '@writers-ide/components';
import { DockDraggable } from '@writers-ide/layout';
import type { ComponentProps, Snippet } from 'svelte';
import {
	createTaskService,
	type AdvancedTaskService,
	type TaskContext,
	type TaskHandle,
	type TaskService,
	type TaskServiceOptions,
	type WorkerTaskOptions,
	type WorkerFactoryTaskOptions,
} from '@writers-ide/tasks';
import Card from './Card.svelte';
import { fourRoles, probeApi, publishedApi } from './contracts';

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type Roles = Assert<Equal<typeof fourRoles, PluginCommand<string, number, boolean, Date>>>;
export type Icon = Assert<Equal<ComponentProps<typeof IconButton>['icon'], Snippet>>;
export type Children = Assert<
	Equal<ComponentProps<typeof DockDraggable>['children'], Snippet<[Snippet]>>
>;

// This function is checked, not called. The fixture only declares its double command.
export function checkApi(
	context: FrontendContext<unknown>,
	icon: Snippet,
	render: Snippet<[{ id: string; count: number }]>,
) {
	const identity: string = context.identity.activationId;
	const language: string = context.locale.snapshot().languageTag;
	const signal: AbortSignal = context.signal;
	context.own(
		context.locale.subscribe((locale) => {
			const direction: 'ltr' | 'rtl' = locale.direction;
			context.apis.get('host', probeApi)?.event(direction);
		}),
	);
	context.apis.get('host', probeApi)?.event(identity + language);
	context.apis.subscribe('host', probeApi, (probe) => probe?.event('checked'));
	context.apis.provide(publishedApi, (connection) => ({
		inspect: () => !signal.aborted && !connection.signal.aborted,
	}));
	context.contributions.command({
		id: 'roles',
		name: 'Roles',
		contract: fourRoles,
		execute(args) {
			const parsed: Assert<Equal<typeof args, number>> = true;
			return parsed && args > 0;
		},
	});
	const result = context.commands.execute('provider', 'roles', fourRoles, '1');
	const resultType: Assert<Equal<typeof result, Promise<Date>>> = true;
	defineSveltePresentation(IconButton, {
		label: 'Checked',
		icon,
		onclick() {},
		tooltipDirection: 'horizontal',
	});
	defineSveltePresentation(Card<{ id: string; count: number }>, {
		value: { id: 'one', count: 1 },
		render,
	});
	return { result, resultType };
}

// These calls are checked against the copied SDK, not executed by the fixture.
export function checkTasks(context: FrontendContext<unknown>, options: TaskServiceOptions) {
	const ordinary: Assert<Equal<typeof context.tasks, TaskService>> = true;
	const advanced = createTaskService(options);
	const advancedType: Assert<Equal<typeof advanced, AdvancedTaskService>> = true;
	const module = new URL('./worker.js', import.meta.url);
	const input = { buffer: new ArrayBuffer(8), count: 2 };
	const request: WorkerTaskOptions<typeof input, number> = {
		key: 'module',
		label: 'Module',
		module,
		input,
		transfer: [input.buffer],
		apply(value, task) {
			const output: Assert<Equal<typeof value, number>> = true;
			const taskContext: Assert<Equal<typeof task, TaskContext>> = true;
			void [output, taskContext];
		},
	};
	const handle = context.tasks.worker(request);
	const handleType: Assert<Equal<typeof handle, TaskHandle<number>>> = true;
	const inferred = context.tasks.worker({
		key: 'inferred',
		label: 'Inferred',
		module,
		input,
		transfer: [input.buffer],
		apply(value: number, task) {
			const taskContext: Assert<Equal<typeof task, TaskContext>> = true;
			void [value, taskContext];
		},
	});
	const inferredType: Assert<Equal<typeof inferred, TaskHandle<number>>> = true;
	const factory: WorkerFactoryTaskOptions<typeof input, number> = {
		key: 'factory',
		label: 'Factory',
		input,
		transfer: [input.buffer],
		createWorker: () => new Worker(module, { type: 'module' }),
		apply(value, task) {
			const output: Assert<Equal<typeof value, number>> = true;
			const taskContext: Assert<Equal<typeof task, TaskContext>> = true;
			void [output, taskContext];
		},
	};
	const factoryHandle = advanced.worker(factory);
	const factoryType: Assert<Equal<typeof factoryHandle, TaskHandle<number>>> = true;
	const inferredFactory = advanced.worker({
		key: 'inferred-factory',
		label: 'Inferred factory',
		input,
		transfer: [input.buffer],
		createWorker: () => new Worker(module),
		apply(value: number) {
			void value;
		},
	});
	const inferredFactoryType: Assert<Equal<typeof inferredFactory, TaskHandle<number>>> = true;
	advanced.worker(request);
	// @ts-expect-error ordinary activation tasks do not accept worker factories, even via a variable
	context.tasks.worker(factory);
	// @ts-expect-error ordinary tasks require a module URL
	context.tasks.worker({ key: 'bad', label: 'Bad', input, createWorker: () => new Worker(module) });
	// @ts-expect-error module and factory selections are mutually exclusive
	advanced.worker({ ...factory, module });
	// @ts-expect-error ordinary tasks reject mixed selections too
	context.tasks.worker({ ...request, createWorker: () => new Worker(module) });
	// @ts-expect-error module is required
	context.tasks.worker({ key: 'bad', label: 'Bad', input });
	// @ts-expect-error module is a URL, not a string
	context.tasks.worker({ ...request, module: './worker.js' });
	// @ts-expect-error input type is preserved
	context.tasks.worker<typeof input, number>({ ...request, input: 'bad' });
	context.tasks.worker<typeof input, number>({
		...request,
		// @ts-expect-error apply receives the declared output type
		apply(value: string) {
			void value;
		},
	});
	// @ts-expect-error transfer entries must be transferable
	context.tasks.worker({ ...request, transfer: [null] });
	return { ordinary, advancedType, handleType, inferredType, factoryType, inferredFactoryType };
}
