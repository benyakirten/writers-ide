import type { Dispose } from './index';
import { hasErrorCode } from './error-guard';

/** Structural Standard Schema v1 contract; no validator library is required. */
interface StandardSchema<Input, Output> {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
		) =>
			| { readonly value: Output; readonly issues?: undefined }
			| { readonly issues: readonly StandardIssue[] }
			| Promise<
					| { readonly value: Output; readonly issues?: undefined }
					| { readonly issues: readonly StandardIssue[] }
			  >;
		readonly types?: { readonly input: Input; readonly output: Output };
	};
}

type StandardIssue = {
	readonly message: string;
	readonly path?: readonly (PropertyKey | { readonly key: PropertyKey })[];
};

/** A shared descriptor, not a registered implementation or a command dispatcher. */
export type PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput> = {
	readonly id: string;
	readonly major: number;
	readonly args: StandardSchema<ArgsInput, ArgsOutput>;
	readonly result: StandardSchema<ResultInput, ResultOutput>;
};

export function definePluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>(
	descriptor: PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>,
): PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput> {
	if (
		typeof descriptor.id !== 'string' ||
		descriptor.id.trim().length === 0 ||
		new TextEncoder().encode(descriptor.id).byteLength > 256
	) {
		throw new Error('Plugin command contract ID must be nonempty and at most 256 UTF-8 bytes');
	}
	if (!Number.isSafeInteger(descriptor.major) || descriptor.major <= 0) {
		throw new Error('Plugin command contract major must be a positive safe integer');
	}
	return Object.freeze({
		id: descriptor.id,
		major: descriptor.major,
		args: descriptor.args,
		result: descriptor.result,
	});
}

export type CommandRegistration<ArgsInput, ArgsOutput, ResultInput, ResultOutput> = {
	readonly id: string;
	readonly name: string;
	readonly contract: PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>;
	readonly execute: (
		args: NoInfer<ArgsOutput>,
		context: { readonly signal: AbortSignal },
	) => NoInfer<ResultInput> | Promise<NoInfer<ResultInput>>;
};

/** Host-supplied access to declared dependencies, bound to activation or connection lifetime. */
export interface CommandInvoker {
	isAvailable<ArgsInput, ArgsOutput, ResultInput, ResultOutput>(
		dependencyAlias: string,
		commandAlias: string,
		contract: PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>,
	): boolean;
	subscribeAvailability<ArgsInput, ArgsOutput, ResultInput, ResultOutput>(
		dependencyAlias: string,
		commandAlias: string,
		contract: PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>,
		listener: (available: boolean) => void,
	): Dispose;
	execute<ArgsInput, ArgsOutput, ResultInput, ResultOutput>(
		dependencyAlias: string,
		commandAlias: string,
		contract: PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>,
		args: NoInfer<ArgsInput>,
		options?: { readonly signal?: AbortSignal },
	): Promise<ResultOutput>;
}

export type CommandInvocationErrorCode =
	| 'cancelled'
	| 'revoked'
	| 'unavailable'
	| 'invalid-reference'
	| 'contract-mismatch'
	| 'invalid-arguments'
	| 'invalid-result'
	| 'limit-exceeded'
	| 'execution-failed';

export type CommandInvocationError = Error & { readonly code: CommandInvocationErrorCode };

const commandErrorCodes: ReadonlySet<string> = new Set<CommandInvocationErrorCode>([
	'cancelled',
	'revoked',
	'unavailable',
	'invalid-reference',
	'contract-mismatch',
	'invalid-arguments',
	'invalid-result',
	'limit-exceeded',
	'execution-failed',
]);

/** Recognizes representation only, not the error's origin or authority. */
export function isCommandInvocationError(value: unknown): value is CommandInvocationError {
	return hasErrorCode(value, commandErrorCodes);
}
