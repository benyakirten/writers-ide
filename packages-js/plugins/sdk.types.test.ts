import { expectTypeOf, it } from 'vitest';
import {
	definePluginCommand,
	isCommandInvocationError,
	type CommandInvoker,
	type CommandRegistration,
	type FrontendContext,
	type FrontendEntry,
	type PluginCommand,
	type ProjectConnections,
	type ProjectReference,
	type CommandInvocationError,
} from '@writers-ide/plugins';
import {
	isNativeServiceError,
	type NativeServiceError,
	type NativeServices,
	type ProjectFiles,
	type FileIndexPage,
} from '@writers-ide/plugins/native';
import type {
	SvelteFrontendContext,
	SvelteFrontendEntry,
	SveltePresentation,
} from '@writers-ide/plugins/svelte';

function schema<Input, Output>(output: Output) {
	return {
		'~standard': {
			version: 1 as const,
			vendor: 'test',
			validate: (_value: unknown) => ({ value: output }),
			types: undefined as { readonly input: Input; readonly output: Output } | undefined,
		},
	};
}

const transformed = definePluginCommand({
	id: 'test.transformed',
	major: 1,
	args: schema<string, Date>(new Date()),
	result: {
		'~standard': {
			version: 1 as const,
			vendor: 'test-async',
			validate: async (_value: unknown) => ({ value: 42 }),
			types: undefined as
				| { readonly input: { total: number }; readonly output: number }
				| undefined,
		},
	},
});

function checkAuthorTypes(
	context: FrontendContext<string>,
	commands: CommandInvoker,
	files: ProjectFiles,
	caught: unknown,
) {
	expectTypeOf(transformed).toEqualTypeOf<PluginCommand<string, Date, { total: number }, number>>();
	expectTypeOf(commands.execute('provider', 'action', transformed, '2026-01-01')).toEqualTypeOf<
		Promise<number>
	>();
	// @ts-expect-error The caller supplies schema input, not its transformed output.
	commands.execute('provider', 'action', transformed, new Date());
	// @ts-expect-error Callers must supply the argument explicitly.
	commands.execute('provider', 'action', transformed);

	context.contributions.command({
		id: 'action',
		name: 'Action',
		contract: transformed,
		execute(args, invocation) {
			expectTypeOf(args).toEqualTypeOf<Date>();
			expectTypeOf(invocation.signal).toEqualTypeOf<AbortSignal>();
			return { total: args.getTime() };
		},
	});
	context.contributions.command({
		id: 'async',
		name: 'Async',
		contract: transformed,
		execute: async (args) => ({ total: args.getTime() }),
	});
	context.contributions.command({
		id: 'wrong-result',
		name: 'Wrong',
		contract: transformed,
		// @ts-expect-error Implementations return result-schema input, not output.
		execute: () => 42,
	});
	context.contributions.command({
		id: 'wrong-args',
		name: 'Wrong',
		contract: transformed,
		// @ts-expect-error Implementations receive argument-schema output, not input.
		execute: (_args: string) => ({ total: 1 }),
	});
	const registration: CommandRegistration<string, Date, { total: number }, number> = {
		id: 'explicit',
		name: 'Explicit',
		contract: transformed,
		execute: () => ({ total: 1 }),
	};
	context.contributions.command(registration);

	if (context.project === null) {
		expectTypeOf(context.projects).toEqualTypeOf<ProjectConnections>();
	} else {
		expectTypeOf(context.project).toEqualTypeOf<ProjectReference>();
		expectTypeOf(context.projects).toEqualTypeOf<null>();
	}
	expectTypeOf(context.native).toEqualTypeOf<NativeServices>();
	expectTypeOf(files.queryIndex('.', { after: 'cursor', signal: context.signal })).toEqualTypeOf<
		Promise<FileIndexPage>
	>();
	// @ts-expect-error No caller-selected page size is approved.
	files.queryIndex('.', { pageSize: 10 });
	// @ts-expect-error No implicit project root is approved.
	files.queryIndex();
	// @ts-expect-error Native links accept strings, not URL instances.
	context.native.externalLinks?.open(new URL('https://example.com'));
	if (isCommandInvocationError(caught)) {
		expectTypeOf(caught).toEqualTypeOf<CommandInvocationError>();
	}
	if (isNativeServiceError(caught)) {
		expectTypeOf(caught).toEqualTypeOf<NativeServiceError>();
	}
}

function checkExplicitUndefined(commands: CommandInvoker, context: FrontendContext<string>) {
	const contract = definePluginCommand({
		id: 'test.void',
		major: 1,
		args: schema<undefined, undefined>(undefined),
		result: schema<void, void>(undefined),
	});
	expectTypeOf(contract).toEqualTypeOf<PluginCommand<undefined, undefined, void, void>>();
	expectTypeOf(commands.execute('provider', 'void', contract, undefined)).toEqualTypeOf<
		Promise<void>
	>();
	context.contributions.command({ id: 'void', name: 'Void', contract, execute() {} });
	// @ts-expect-error Explicit undefined does not add an argument-omission overload.
	commands.execute('provider', 'void', contract);
	// @ts-expect-error Both validators are required.
	definePluginCommand({ id: 'missing', major: 1 });
}

function checkEntries() {
	expectTypeOf<SvelteFrontendContext>().toEqualTypeOf<FrontendContext<SveltePresentation>>();
	expectTypeOf<SvelteFrontendEntry>().toEqualTypeOf<FrontendEntry<SveltePresentation>>();
	const entry: FrontendEntry<string> = { activate: (_context) => () => {} };
	const invalid: FrontendEntry<string> = {
		// @ts-expect-error Activation remains synchronous.
		activate: async () => {},
	};
	return [entry, invalid];
}

it('keeps author contract checks compile-only', () => {
	expectTypeOf(checkAuthorTypes).toBeFunction();
	expectTypeOf(checkExplicitUndefined).toBeFunction();
	expectTypeOf(checkEntries).toBeFunction();
});
