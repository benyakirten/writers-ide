import {
	CommandInvocationError,
	type CommandInvocationErrorCode,
	type CommandInvoker,
	type CommandRegistration,
	type PluginCommand,
} from './commands';
import { prepareCommandPayload, PayloadError } from './command-payload';
import {
	createCommandReservationLedger,
	type CommandReservation,
	type CommandReservationLedger,
	type ReservationLimits,
	type ReservationSnapshot,
} from './command-reservations';

type Contract = PluginCommand<unknown, unknown, unknown, unknown>;
type Release = () => void;

// Internal host inputs, not a registry or an activation/publication authority.
export type CommandProviderBinding = {
	readonly instanceId: string;
	readonly signal: AbortSignal;
	readonly registrationSignal: AbortSignal;
	readonly registration: CommandRegistration<unknown, unknown, unknown, unknown>;
};
export type CommandAliasDeclaration = {
	readonly dependencyAlias: string;
	readonly commandAlias: string;
	readonly commandId: string;
	readonly contractId: string;
	readonly major: number;
	// Return the same binding object until that exact registration/connection changes.
	readonly resolve: () => CommandProviderBinding | undefined;
};
export type CommandConsumerSource = {
	readonly instanceId: string;
	readonly signal: AbortSignal;
	// Hosts can revoke a batch before dispatching its sequential abort events.
	readonly isLive?: () => boolean;
	readonly declarations: readonly CommandAliasDeclaration[];
	// Notify after replacing/removing a binding, even when availability stays true.
	readonly subscribeBindings: (listener: () => void) => Release;
};
export type CommandDiagnostic = {
	readonly diagnosticId: string;
	readonly callerInstanceId: string;
	readonly providerInstanceId?: string;
	readonly commandId?: string;
	readonly contractId?: string;
	readonly major?: number;
	readonly phase: string;
	readonly kind: 'failure' | 'validator-sync-warning' | 'validator-elapsed';
	readonly code?: CommandInvocationErrorCode;
	readonly elapsedMs: number;
	readonly synchronousMs?: number;
	readonly limits?: ReservationLimits;
	readonly reservations: ReservationSnapshot;
};
type Options = {
	readonly ledger?: CommandReservationLedger;
	readonly diagnostics?: (metadata: CommandDiagnostic) => void;
	// Explicit opt-in only. Raw exceptions never enter ordinary metadata.
	readonly inspectError?: (error: unknown, metadata: CommandDiagnostic) => void;
	readonly now?: () => number;
};
export interface CommandDispatcher {
	createInvoker(source: CommandConsumerSource): CommandInvoker;
	dispose(): void;
}

const messages: Record<CommandInvocationErrorCode, string> = {
	cancelled: 'Command invocation was cancelled.',
	revoked: 'Command invocation lifetime has ended.',
	unavailable: 'The declared command is unavailable.',
	'invalid-reference': 'Command aliases must identify a declared command.',
	'contract-mismatch': 'Command contract identity or major does not match.',
	'invalid-arguments': 'Command arguments failed validation.',
	'invalid-result': 'Command result failed validation.',
	'limit-exceeded': 'Command resource limits were exceeded.',
	'execution-failed': 'Command execution or validation failed unexpectedly.',
};
const encoder = new TextEncoder();
function identifier(value: unknown): value is string {
	return (
		typeof value === 'string' && value.trim().length > 0 && encoder.encode(value).length <= 256
	);
}
function major(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) > 0;
}
function isolate(callback: () => void): void {
	try {
		void Promise.resolve(callback()).catch(() => undefined);
	} catch {
		// Observers cannot affect invocation settlement or run subsequent phases.
	}
}
class Failure {
	constructor(readonly code: CommandInvocationErrorCode) {}
}
const stopped = Symbol('stopped invocation');

/** Standalone per-window dispatcher. All resolution and lifetime authority comes from the host. */
export function createCommandDispatcher(options: Options = {}): CommandDispatcher {
	const ledger = options.ledger ?? createCommandReservationLedger();
	const now = options.now ?? (() => performance.now());
	const shutdown = new AbortController();
	const scopes = new Set<Release>();

	return {
		dispose() {
			shutdown.abort();
			for (const stop of Array.from(scopes)) {
				stop();
			}
		},
		createInvoker(source) {
			let ended = shutdown.signal.aborted || source.signal.aborted;
			const watchers = new Set<Release>();
			const cleanups = new Set<Release>();
			const notify = () => {
				for (const listener of Array.from(watchers)) {
					if (watchers.has(listener)) {
						isolate(listener);
					}
				}
			};
			const stop = () => {
				if (ended) {
					return;
				}
				ended = true;
				notify();
				for (const cleanup of Array.from(cleanups)) {
					isolate(cleanup);
				}
				cleanups.clear();
				watchers.clear();
				scopes.delete(stop);
			};
			if (!ended) {
				try {
					scopes.add(stop);
					cleanups.add(() => source.signal.removeEventListener('abort', stop));
					cleanups.add(() => shutdown.signal.removeEventListener('abort', stop));
					source.signal.addEventListener('abort', stop);
					shutdown.signal.addEventListener('abort', stop);
					const unsubscribe = source.subscribeBindings(notify);
					if (ended) {
						isolate(unsubscribe);
					} else {
						cleanups.add(unsubscribe);
					}
				} catch (error) {
					stop();
					throw error;
				}
			}
			const live = () => {
				if (
					ended ||
					source.signal.aborted ||
					shutdown.signal.aborted ||
					source.isLive?.() === false
				) {
					throw new Failure('revoked');
				}
			};
			const declaration = (
				dependency: string,
				command: string,
				contract: Contract,
				capture?: (entry: CommandAliasDeclaration) => void,
			) => {
				live();
				if (!identifier(dependency) || !identifier(command)) {
					throw new Failure('invalid-reference');
				}
				const found = source.declarations.find(
					(entry) => entry.dependencyAlias === dependency && entry.commandAlias === command,
				);
				if (!found) {
					throw new Failure('invalid-reference');
				}
				capture?.(found);
				if (
					!identifier(contract.id) ||
					!major(contract.major) ||
					contract.id !== found.contractId ||
					contract.major !== found.major ||
					!identifier(found.commandId)
				) {
					throw new Failure('contract-mismatch');
				}
				return found;
			};
			const provider = (
				entry: CommandAliasDeclaration,
				capture?: (binding: CommandProviderBinding | undefined) => void,
				recheck: Release = live,
			) => {
				const binding = entry.resolve();
				recheck();
				capture?.(binding);
				if (!binding || binding.signal.aborted || binding.registrationSignal.aborted) {
					return undefined;
				}
				if (
					binding.registration.id !== entry.commandId ||
					binding.registration.contract.id !== entry.contractId ||
					binding.registration.contract.major !== entry.major
				) {
					throw new Failure('contract-mismatch');
				}
				return binding;
			};
			const metadata = (
				id: string,
				phase: string,
				kind: CommandDiagnostic['kind'],
				started: number,
				entry?: CommandAliasDeclaration,
				binding?: CommandProviderBinding,
				reservation?: CommandReservation,
				code?: CommandInvocationErrorCode,
				synchronousMs?: number,
			): CommandDiagnostic =>
				Object.freeze({
					diagnosticId: id,
					callerInstanceId: source.instanceId,
					providerInstanceId: binding?.instanceId,
					commandId: entry?.commandId,
					contractId: entry?.contractId,
					major: entry?.major,
					phase,
					kind,
					code,
					elapsedMs: Math.max(0, now() - started),
					synchronousMs,
					limits: reservation?.limits,
					reservations: ledger.snapshot(),
				});
			const report = (data: CommandDiagnostic) => {
				isolate(() => options.diagnostics?.(data));
			};
			const resolveReference = (dependency: string, command: string, contract: Contract) => {
				let entry: CommandAliasDeclaration | undefined;
				let binding: CommandProviderBinding | undefined;
				try {
					const declared = declaration(dependency, command, contract, (found) => {
						entry = found;
					});
					const resolved = provider(declared, (found) => {
						binding = found;
					});
					return { entry: declared, binding: resolved };
				} catch (error) {
					const code = error instanceof Failure ? error.code : 'execution-failed';
					const id = crypto.randomUUID();
					const data = metadata(id, 'lookup', 'failure', now(), entry, binding, undefined, code);
					report(data);
					if (!(error instanceof Failure)) {
						isolate(() => options.inspectError?.(error, data));
					}
					throw new CommandInvocationError(code, messages[code], id);
				}
			};

			return {
				isAvailable(dependency, command, contract) {
					return resolveReference(dependency, command, contract).binding !== undefined;
				},
				subscribeAvailability(dependency, command, contract, listener) {
					const initial = resolveReference(dependency, command, contract);
					let previous = initial.binding !== undefined;
					const subscribedEntry = initial.entry;
					let subscribedBinding = initial.binding;
					let active = true;
					const providerCleanups: Release[] = [];
					const dispose = () => {
						active = false;
						watchers.delete(update);
						cleanups.delete(dispose);
						for (const cleanup of providerCleanups.splice(0)) {
							cleanup();
						}
					};
					const isActive = () => {
						if (
							!active ||
							ended ||
							source.signal.aborted ||
							shutdown.signal.aborted ||
							source.isLive?.() === false
						) {
							dispose();
							return false;
						}
						return true;
					};
					const listenerFailed = (error: unknown, phase = 'availability-listener') => {
						const data = metadata(
							crypto.randomUUID(),
							phase,
							'failure',
							now(),
							subscribedEntry,
							subscribedBinding,
							undefined,
							'execution-failed',
						);
						report(data);
						isolate(() => options.inspectError?.(error, data));
					};
					const deliver = () => {
						if (!isActive()) {
							return;
						}
						try {
							void Promise.resolve(listener(previous)).catch(listenerFailed);
						} catch (error) {
							listenerFailed(error);
						}
					};
					const watchBinding = () => {
						if (!isActive() || !subscribedBinding) {
							return;
						}
						for (const signal of [subscribedBinding.signal, subscribedBinding.registrationSignal]) {
							signal.addEventListener('abort', update);
							providerCleanups.push(() => signal.removeEventListener('abort', update));
							if (!isActive()) {
								return;
							}
						}
					};
					const update = () => {
						if (!isActive()) {
							return;
						}
						for (const cleanup of providerCleanups.splice(0)) {
							cleanup();
						}
						let binding: CommandProviderBinding | undefined;
						try {
							binding = provider(subscribedEntry, undefined, () => {
								if (!isActive()) {
									throw stopped;
								}
							});
						} catch (error) {
							if (error === stopped) {
								return;
							}
							// A changed incompatible registration is unavailable, not a callback exception.
							if (!(error instanceof Failure && error.code === 'contract-mismatch')) {
								listenerFailed(error, 'availability-resolution');
							}
						}
						if (!isActive()) {
							return;
						}
						subscribedBinding = binding;
						watchBinding();
						const next = binding !== undefined;
						if (next !== previous) {
							previous = next;
							deliver();
						}
					};
					watchers.add(update);
					cleanups.add(dispose);
					watchBinding();
					deliver();
					return dispose;
				},
				execute<ArgsInput, ArgsOutput, ResultInput, ResultOutput>(
					dependency: string,
					command: string,
					contract: PluginCommand<ArgsInput, ArgsOutput, ResultInput, ResultOutput>,
					args: NoInfer<ArgsInput>,
					request?: { readonly signal?: AbortSignal },
				) {
					// The executor contains every lookup so even malformed access returns a promise.
					return new Promise<ResultOutput>((resolve, reject) => {
						const id = crypto.randomUUID();
						const started = now();
						const controller = new AbortController();
						let terminal = false;
						let phase = 'caller';
						let entry: CommandAliasDeclaration | undefined;
						let binding: CommandProviderBinding | undefined;
						let reservation: CommandReservation | undefined;
						const detach: Release[] = [];
						const unwatch = () => {
							for (const cleanup of detach.splice(0)) {
								cleanup();
							}
						};
						const fail = (code: CommandInvocationErrorCode, raw?: { error: unknown }) => {
							const data = metadata(
								id,
								phase,
								'failure',
								started,
								entry,
								binding,
								reservation,
								code,
							);
							if (!terminal) {
								terminal = true;
								unwatch();
								reject(new CommandInvocationError(code, messages[code], id));
								controller.abort();
							}
							report(data);
							if (raw) {
								isolate(() => options.inspectError?.(raw.error, data));
							}
						};
						const checkLifetime = () => {
							if (terminal) {
								throw stopped;
							}
							live();
							if (request?.signal?.aborted) {
								throw new Failure('cancelled');
							}
							if (binding && (binding.signal.aborted || binding.registrationSignal.aborted)) {
								throw new Failure('revoked');
							}
						};
						const check = () => {
							checkLifetime();
							if (entry && binding) {
								const current = entry.resolve();
								// A host binding callback can itself process teardown.
								checkLifetime();
								if (current !== binding) {
									throw new Failure('revoked');
								}
							}
						};
						const watch = (signal: AbortSignal, code: 'cancelled' | 'revoked') => {
							const listener = () => fail(code);
							signal.addEventListener('abort', listener, { once: true });
							detach.push(() => signal.removeEventListener('abort', listener));
						};
						const payload = <T>(operation: () => T): T => {
							try {
								const result = operation();
								check();
								return result;
							} catch (error) {
								if (error instanceof PayloadError) {
									throw new Failure(
										error.code === 'limit-exceeded'
											? 'limit-exceeded'
											: phase === 'arguments'
												? 'invalid-arguments'
												: 'invalid-result',
									);
								}
								throw error;
							}
						};
						const retain = (value: unknown) => payload(() => reservation!.retain(value));
						const copy = (value: unknown) => {
							const prepared = payload(() =>
								prepareCommandPayload(value, reservation!.limits.payload),
							);
							const provisional = payload(() => reservation!.reserveCopy(prepared.inspection));
							try {
								const copied = payload(() => prepared.copy());
								// Replace ghost identities with actual copy identities, not a third representation.
								provisional();
								return { value: copied, release: retain(copied) };
							} finally {
								provisional();
							}
						};
						const validate = async (schema: Contract['args'], value: unknown) => {
							const began = now();
							let validation;
							let synchronousMs = 0;
							try {
								try {
									validation = schema['~standard'].validate(value);
								} finally {
									synchronousMs = Math.max(0, now() - began);
									if (synchronousMs > 16) {
										report(
											metadata(
												id,
												phase,
												'validator-sync-warning',
												began,
												entry,
												binding,
												reservation,
												undefined,
												synchronousMs,
											),
										);
									}
								}
								// Attach observation before consulting lifetime again, including after a warning observer.
								const asynchronous =
									validation !== null && typeof validation === 'object' && 'then' in validation;
								try {
									validation = await validation;
								} finally {
									if (asynchronous) {
										report(
											metadata(
												id,
												phase,
												'validator-elapsed',
												began,
												entry,
												binding,
												reservation,
												undefined,
												synchronousMs,
											),
										);
									}
								}
								check();
								if (validation.issues !== undefined) {
									throw new Failure(phase === 'arguments' ? 'invalid-arguments' : 'invalid-result');
								}
								return validation.value;
							} catch (error) {
								if (error === stopped || error instanceof Failure) {
									throw error;
								}
								fail('execution-failed', { error });
								throw stopped;
							}
						};
						const run = async () => {
							let input: unknown = args;
							args = undefined as typeof args;
							let copied: { value: unknown; release: Release } | undefined;
							let transformed: unknown;
							let raw: unknown;
							let output: unknown;
							try {
								check();
								phase = 'declaration';
								entry = declaration(dependency, command, contract, (found) => {
									entry = found;
								});
								phase = 'provider';
								binding = provider(
									entry,
									(found) => {
										binding = found;
									},
									checkLifetime,
								);
								if (!binding) {
									throw new Failure('unavailable');
								}
								check();
								watch(source.signal, 'revoked');
								watch(shutdown.signal, 'revoked');
								watch(binding.signal, 'revoked');
								watch(binding.registrationSignal, 'revoked');
								if (request?.signal) {
									watch(request.signal, 'cancelled');
								}
								const changed = () => {
									try {
										check();
									} catch (error) {
										if (error !== stopped) {
											fail(
												error instanceof Failure ? error.code : 'execution-failed',
												error instanceof Failure ? undefined : { error },
											);
										}
									}
								};
								watchers.add(changed);
								detach.push(() => watchers.delete(changed));
								phase = 'admission';
								payload(() => {
									reservation = ledger.admit(source.instanceId, binding!.instanceId);
								});
								phase = 'arguments';
								const inputReceipt = retain(input);
								copied = copy(input);
								input = undefined;
								inputReceipt();
								transformed = await validate(binding.registration.contract.args, copied.value);
								check();
								// Refresh mutable validator input before replacing its point-in-time receipt.
								const refreshed = retain(copied.value);
								copied.release();
								const argumentReceipt = retain(transformed);
								copied = undefined;
								refreshed();
								check();
								phase = 'implementation';
								try {
									raw = await binding.registration.execute(transformed, {
										signal: controller.signal,
									});
								} catch (error) {
									fail('execution-failed', { error });
									throw stopped;
								}
								check();
								phase = 'result';
								const currentArguments = retain(transformed);
								argumentReceipt();
								const rawReceipt = retain(raw);
								transformed = undefined;
								currentArguments();
								output = await validate(binding.registration.contract.result, raw);
								check();
								const currentRaw = retain(raw);
								rawReceipt();
								const outputReceipt = retain(output);
								raw = undefined;
								currentRaw();
								const delivery = copy(output);
								output = undefined;
								outputReceipt();
								check();
								terminal = true;
								unwatch();
								resolve(delivery.value as ResultOutput);
								delivery.release();
							} catch (error) {
								if (error !== stopped) {
									fail(
										error instanceof Failure ? error.code : 'execution-failed',
										error instanceof Failure ? undefined : { error },
									);
								}
							} finally {
								input = copied = transformed = raw = output = undefined;
								unwatch();
								reservation?.release();
							}
						};
						void run();
					});
				},
			};
		},
	};
}
