import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { definePluginCommand, isCommandInvocationError } from '@writers-ide/plugins';
import { isNativeServiceError } from '@writers-ide/plugins/native';

const undefinedSchema = {
	'~standard': {
		version: 1 as const,
		vendor: 'test',
		validate: vi.fn((_value: unknown) => ({ value: undefined })),
		types: undefined as { input: undefined; output: undefined } | undefined,
	},
};

describe('definePluginCommand', () => {
	it('freezes a descriptor without executing or freezing its validators', () => {
		const descriptor = {
			id: ' Example.Action ',
			major: 1,
			args: undefinedSchema,
			result: undefinedSchema,
		};
		const command = definePluginCommand(descriptor);
		expect(command).not.toBe(descriptor);
		expect(command).toEqual(descriptor);
		expect(Object.isFrozen(command)).toBe(true);
		expect(command.args).toBe(undefinedSchema);
		expect(command.result).toBe(undefinedSchema);
		expect(Object.isFrozen(undefinedSchema)).toBe(false);
		expect(undefinedSchema['~standard'].validate).not.toHaveBeenCalled();
	});

	it.each(['', ' \t\n', 'é'.repeat(129)])('rejects invalid contract ID %j', (id) => {
		expect(() =>
			definePluginCommand({ id, major: 1, args: undefinedSchema, result: undefinedSchema }),
		).toThrow();
	});

	it('uses UTF-8 bytes without normalizing valid IDs', () => {
		const id = 'é'.repeat(128);
		expect(
			definePluginCommand({ id, major: 1, args: undefinedSchema, result: undefinedSchema }).id,
		).toBe(id);
	});

	it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
		'rejects invalid major %s',
		(major) => {
			expect(() =>
				definePluginCommand({ id: 'test', major, args: undefinedSchema, result: undefinedSchema }),
			).toThrow();
		},
	);
});

const commandCodes = [
	'cancelled',
	'revoked',
	'unavailable',
	'invalid-reference',
	'contract-mismatch',
	'invalid-arguments',
	'invalid-result',
	'limit-exceeded',
	'execution-failed',
];
const nativeCodes = [
	'revoked',
	'cancelled',
	'permission-denied',
	'invalid-input',
	'unavailable',
	'not-found',
	'limit-exceeded',
	'unsupported-entry',
	'io',
];

for (const [name, guard, codes] of [
	['command', isCommandInvocationError, commandCodes],
	['native', isNativeServiceError, nativeCodes],
] as const) {
	describe(`${name} error recognition`, () => {
		it.each(codes)('recognizes standard Errors with supported code %s', (code) => {
			expect(guard(Object.assign(new Error('failure'), { code }))).toBe(true);
			expect(guard(Object.assign(new TypeError('failure'), { code }))).toBe(true);
		});

		it('recognizes Errors from another JavaScript realm', () => {
			const error: unknown = runInNewContext('Object.assign(new Error("failure"), { code })', {
				code: codes[0],
			});
			expect(error).not.toBeInstanceOf(Error);
			expect(guard(error)).toBe(true);
		});

		it('rejects unrelated values without throwing', () => {
			const revoked = Proxy.revocable({}, {});
			revoked.revoke();
			const throwingCode = Object.defineProperty(new Error('failure'), 'code', {
				get() {
					throw new Error('getter');
				},
			});
			for (const value of [
				undefined,
				null,
				true,
				1,
				'cancelled',
				Symbol('error'),
				{},
				{ name: 'Error', message: 'failure', code: 'cancelled' },
				new Error('failure'),
				Object.assign(new Error('failure'), { code: 1 }),
				Object.assign(new Error('failure'), { code: 'unknown' }),
				revoked.proxy,
				throwingCode,
			]) {
				expect(guard(value)).toBe(false);
			}
		});
	});
}

it('keeps command-only and native-only error codes separate', () => {
	expect(isNativeServiceError(Object.assign(new Error(), { code: 'execution-failed' }))).toBe(
		false,
	);
	expect(isCommandInvocationError(Object.assign(new Error(), { code: 'io' }))).toBe(false);
});
