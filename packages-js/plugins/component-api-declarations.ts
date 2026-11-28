import type { ActivationIdentity } from './frontend';
import type { PluginApiIdentity } from './index';

const encoder = new TextEncoder();
function machine(value: unknown): asserts value is string {
	if (
		typeof value !== 'string' ||
		value.length > 256 ||
		!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
	) {
		throw new Error('Invalid component identity machine identifier');
	}
}
export function captureIdentity(
	input: Omit<ActivationIdentity, 'activationId'>,
): Omit<ActivationIdentity, 'activationId'> {
	if (!input || typeof input.packageId !== 'string') {
		throw new Error('Host component identity required');
	}
	const parts = input.packageId.startsWith('@')
		? input.packageId.slice(1).split('/')
		: [input.packageId];
	if (parts.length !== (input.packageId.startsWith('@') ? 2 : 1)) {
		throw new Error('Invalid canonical package identity');
	}
	for (const part of parts) {
		machine(part);
	}
	machine(input.componentId);
	if (
		input.projectOpeningId !== null &&
		(typeof input.projectOpeningId !== 'string' || input.projectOpeningId.length === 0)
	) {
		throw new Error('Project opening identity must be a nonempty string or null');
	}
	return Object.freeze({
		packageId: input.packageId,
		componentId: input.componentId,
		projectOpeningId: input.projectOpeningId,
	});
}
export function apiIdentity(input: PluginApiIdentity): PluginApiIdentity {
	if (
		!input ||
		typeof input.id !== 'string' ||
		input.id.trim().length === 0 ||
		encoder.encode(input.id).length > 256 ||
		!Number.isSafeInteger(input.major) ||
		input.major <= 0
	) {
		throw new Error(
			'API identity requires a nonblank ID of at most 256 UTF-8 bytes and a positive safe major',
		);
	}
	return Object.freeze({ id: input.id, major: input.major });
}
export function apiKey(input: PluginApiIdentity): string {
	return JSON.stringify([input.id, input.major]);
}
export function apiDeclarations(
	input: readonly PluginApiIdentity[] | undefined,
): readonly PluginApiIdentity[] {
	const values = input === undefined ? [] : input;
	if (!Array.isArray(values) || values.length > 32) {
		throw new Error('API declarations must be an array of at most 32 pairs');
	}
	const result = values.map(apiIdentity);
	if (new Set(result.map(apiKey)).size !== result.length) {
		throw new Error('Duplicate API identity');
	}
	return Object.freeze(result);
}
