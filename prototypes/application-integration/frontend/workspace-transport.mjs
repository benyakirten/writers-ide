import { createCommandResourceSettingsClient } from '../../../packages-js/plugins/command-resource-settings.ts';
import {
	attachment,
	event,
	fail,
	payload,
	record,
	sameSettings,
	snapshot,
	version,
} from './wire.mjs';

// One instance and one scheduler belong to the entire workspace lifetime, not each attachment.
export function createWorkspaceTransport({
	session,
	invoke,
	channel,
	now = () => performance.now(),
	schedule = (tick) => setInterval(tick, 250),
	unschedule = clearInterval,
	challenge = () => crypto.randomUUID(),
	changed = () => {},
}) {
	const client = createCommandResourceSettingsClient();
	let active;
	let disposed = false;
	let stale = false;
	const pending = new Set();
	function dto(context, extra = {}) {
		return {
			version: 1,
			session,
			epoch: context.identity.epoch,
			attachment: context.identity.attachment,
			...extra,
		};
	}
	function detachNative(context) {
		if (context.identity && !context.detached) {
			context.detached = true;
			void Promise.resolve()
				.then(() => invoke('settings_detach', payload(dto(context))))
				.catch(() => {});
		}
	}
	function close(context, reason = 'Attachment stale') {
		if (context.closed) {
			return;
		}
		context.closed = true;
		context.early = undefined;
		context.waiting = undefined;
		for (const operation of [...pending]) {
			if (operation.context === context) {
				pending.delete(operation);
				operation.reject(new Error(reason));
			}
		}
		const observer = context.observer;
		context.observer = undefined;
		if (active === context) {
			stale = true;
			observer?.closed();
			client.disconnect();
		}
		detachNative(context);
		changed();
	}
	function gate(context = active) {
		if (disposed || !context || context !== active || context.closed) {
			throw new Error('Settings attachment is not ready');
		}
		if (
			now() >= context.lease ||
			(!context.confirmed && context.initialDeadline && now() >= context.initialDeadline) ||
			(context.renewal && now() >= context.renewal.deadline) ||
			[...pending].some((operation) => operation.context === context && now() >= operation.deadline)
		) {
			close(context, 'Monotonic lease or challenge deadline expired');
			throw new Error('Settings lease expired; explicitly reattach');
		}
		return context;
	}
	function request(context, command, args, milliseconds) {
		return new Promise((resolve, reject) => {
			const operation = { context, deadline: now() + milliseconds, reject };
			pending.add(operation);
			Promise.resolve()
				.then(() => invoke(command, args))
				.then(
					(value) => {
						if (!pending.delete(operation)) {
							// A late attach still needs best-effort cleanup of its native identity.
							if (command === 'settings_attach') {
								try {
									context.identity = attachment(value, context.challenge);
									detachNative(context);
								} catch {
									/* Native deadlines reclaim an unidentifiable attachment. */
								}
							}
							return;
						}
						if (context.closed || context !== active || now() >= operation.deadline) {
							if (command === 'settings_attach') {
								try {
									context.identity = attachment(value, context.challenge);
								} catch {
									/* Native deadline owns malformed replies. */
								}
							}
							reject(new Error('Late attachment response'));
							close(context);
							return;
						}
						resolve(value);
					},
					(error) => {
						if (pending.delete(operation)) {
							reject(error);
							close(context);
						}
					},
				);
		});
	}
	function acknowledge(context, message) {
		if (context.ack) {
			return;
		}
		context.ack = true;
		void request(
			context,
			'settings_ack',
			payload(dto(context, { sequence: message.sequence, revision: message.revision })),
			Math.max(0, context.deliveryDeadline - now()),
		)
			.then((value) => {
				gate(context);
				if (value !== true) {
					fail('Acknowledgment refused');
				}
				context.ack = false;
				context.confirmed = true;
				const waiting = context.waiting;
				context.waiting = undefined;
				if (waiting) {
					deliver(context, waiting.message, waiting.received);
				}
				changed();
			})
			.catch(() => close(context));
	}
	function deliver(context, message, received = now()) {
		try {
			gate(context);
			if (
				message.epoch !== context.identity.epoch ||
				message.attachment !== context.identity.attachment
			) {
				fail('Foreign attachment message');
			}
			if (message.kind === 'closed') {
				close(context, message.reason);
				return;
			}
			const previous = context.last;
			if (previous && message.sequence === previous.sequence) {
				if (
					message.revision !== previous.revision ||
					!sameSettings(message.settings, previous.settings)
				) {
					fail('Inconsistent duplicate');
				}
				if (!context.ack) {
					context.deliveryDeadline = received + 10_000;
				}
				acknowledge(context, message);
				return;
			}
			if (
				BigInt(message.sequence) !== (previous ? BigInt(previous.sequence) + 1n : 1n) ||
				(previous &&
					(BigInt(message.revision) < BigInt(previous.revision) ||
						(message.revision === previous.revision &&
							!sameSettings(message.settings, previous.settings))))
			) {
				fail('Delivery gap or inconsistent revision');
			}
			if (context.ack) {
				if (
					context.waiting &&
					JSON.stringify(context.waiting.message) !== JSON.stringify(message)
				) {
					fail();
				}
				context.waiting ??= { message, received };
				return;
			}
			context.deliveryDeadline = received + 10_000;
			if (now() >= context.deliveryDeadline) {
				fail('Delivery application deadline expired');
			}
			context.last = message;
			context.observer.snapshot(
				{ epoch: message.epoch, revision: message.revision, settings: message.settings },
				() => {
					gate(context);
					acknowledge(context, message);
				},
			);
			if (client.status !== 'ready') {
				fail('Client did not apply snapshot');
			}
			changed();
		} catch {
			close(context);
		}
	}
	function receive(context, value) {
		if (context.closed || context !== active) {
			return;
		}
		try {
			const message = event(value);
			if (!context.identity || !context.observer) {
				if (context.early?.kind === 'closed') {
					return;
				}
				if (
					message.kind !== 'closed' &&
					context.early &&
					JSON.stringify(context.early) !== JSON.stringify(message)
				) {
					fail('More than one early delivery');
				}
				if (!context.early || message.kind === 'closed') {
					context.earlyReceived = now();
				}
				context.early = message;
			} else {
				deliver(context, message);
			}
		} catch {
			close(context);
		}
	}
	async function renew(context) {
		const sent = now();
		const token = challenge();
		context.renewal = { token, deadline: sent + 5000 };
		context.nextRenew = sent + 10_000;
		try {
			const value = await request(
				context,
				'settings_renew',
				payload(dto(context, { challenge: token })),
				5000,
			);
			gate(context);
			record(value, ['version', 'epoch', 'attachment', 'challenge', 'valid']);
			version(value);
			if (
				value.epoch !== context.identity.epoch ||
				value.attachment !== context.identity.attachment ||
				value.challenge !== token ||
				value.valid !== true
			) {
				fail('Renewal refused');
			}
			context.lease = sent + 30_000;
			context.renewal = undefined;
		} catch {
			close(context);
		}
	}
	function tick() {
		const context = active;
		if (!context || context.closed) {
			return;
		}
		try {
			gate(context);
			for (const operation of pending) {
				if (now() >= operation.deadline) {
					close(context, 'Transport deadline expired');
					return;
				}
			}
			if (context.identity && context.confirmed && !context.renewal && now() >= context.nextRenew) {
				void renew(context);
			}
		} catch {
			/* The synchronous gate already closed this attachment. */
		}
	}
	const timer = schedule(tick);
	const facade = Object.freeze({
		ledger: Object.freeze({
			admit(caller, provider) {
				const context = gate();
				if (!context.confirmed) {
					throw new Error('Initial application acknowledgment is pending');
				}
				return client.ledger.admit(caller, provider);
			},
			updateLimits: (...args) => client.ledger.updateLimits(...args),
			snapshot: () => client.ledger.snapshot(),
		}),
		get status() {
			if (disposed) {
				return 'disposed';
			}
			if (stale) {
				return 'stale';
			}
			return client.status === 'ready' && !active?.confirmed ? 'connecting' : client.status;
		},
		attach() {
			throw new Error('Use explicit fixture reattach');
		},
		disconnect() {
			if (active) {
				close(active);
			}
		},
		dispose() {
			if (!disposed) {
				if (active) {
					close(active);
				}
				disposed = true;
				unschedule(timer);
				client.dispose();
			}
		},
	});
	return Object.freeze({
		client: facade,
		get revision() {
			return active?.last?.revision ?? null;
		},
		async reattach() {
			if (disposed) {
				throw new Error('Workspace disposed');
			}
			if (active && !active.closed) {
				throw new Error('Detach before reattaching');
			}
			const sent = now();
			const context = {
				challenge: challenge(),
				lease: sent + 30_000,
				nextRenew: sent + 10_000,
				closed: false,
				confirmed: false,
			};
			active = context;
			stale = false;
			try {
				const events = channel((value) => receive(context, value));
				const result = await request(
					context,
					'settings_attach',
					{ ...payload({ version: 1, session, challenge: context.challenge }), events },
					10_000,
				);
				context.identity = attachment(result, context.challenge);
				gate(context);
				const service = Object.freeze({
					epoch: context.identity.epoch,
					subscribe(observer) {
						gate(context);
						if (context.observer) {
							fail('Only one settings subscriber is allowed');
						}
						context.observer = observer;
						const early = context.early;
						context.early = undefined;
						// The existing client records its subscription before delivery.
						queueMicrotask(() => {
							if (early && !context.closed) {
								deliver(context, early, context.earlyReceived);
							}
						});
						return Object.freeze({
							close() {
								close(context);
							},
						});
					},
					async read() {
						gate(context);
						const value = snapshot(
							await request(context, 'settings_attachment_read', payload(dto(context)), 10_000),
						);
						gate(context);
						if (value.epoch !== context.identity.epoch) {
							fail();
						}
						return value;
					},
				});
				client.attach(service);
				// Bound a missing initial channel delivery with the same shared scheduler.
				void service.read().catch(() => close(context));
				context.initialDeadline = now() + 10_000;
				changed();
			} catch (error) {
				close(context);
				throw error;
			}
		},
		dispose: facade.dispose,
	});
}
