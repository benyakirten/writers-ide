export const forceWarning =
	'Unfinished changes may not be saved. A transaction may already have committed without a delivered response.';

function record(value, keys) {
	if (
		!value ||
		typeof value !== 'object' ||
		Array.isArray(value) ||
		Object.keys(value).length !== keys.length ||
		keys.some((key) => !Object.hasOwn(value, key)) ||
		new TextEncoder().encode(JSON.stringify(value)).length > 4096
	) {
		throw new Error('Invalid shutdown response');
	}
}
function text(value, max = 1024) {
	if (typeof value !== 'string' || value.length === 0 || value.length > max) {
		throw new Error('Invalid shutdown text');
	}
	return value;
}
function snapshot(value) {
	record(value, ['version', 'attempt', 'phase', 'stage', 'message', 'failure', 'forceEligible']);
	if (
		value.version !== 1 ||
		!['draining', 'failed', 'complete', 'forced'].includes(value.phase) ||
		typeof value.forceEligible !== 'boolean'
	) {
		throw new Error('Invalid shutdown snapshot');
	}
	return {
		...value,
		attempt: text(value.attempt, 128),
		stage: text(value.stage, 128),
		message: text(value.message),
		failure: value.failure === null ? null : text(value.failure),
	};
}

export function mountShutdown({
	document,
	invoke,
	channel,
	now = () => performance.now(),
	schedule = setTimeout,
	unschedule = clearTimeout,
}) {
	const element = (tag, id, content, parent = document.body) => {
		const node = document.createElement(tag);
		node.id = id;
		node.textContent = content;
		parent.append(node);
		return node;
	};
	element('h1', 'shutdown-title', 'Finishing shutdown');
	const status = element('p', 'shutdown-status', 'Connecting to shutdown status…');
	status.setAttribute('role', 'status');
	const failure = element('p', 'shutdown-failure', '');
	const error = element('p', 'shutdown-error', '');
	error.setAttribute('role', 'alert');
	const waiting = element('button', 'keep-waiting', 'Keep waiting');
	waiting.type = 'button';
	waiting.autofocus = true;
	const force = element('button', 'force-quit', 'Force quit…');
	force.type = 'button';
	const dialog = element('dialog', 'force-dialog', '');
	dialog.setAttribute('aria-labelledby', 'force-title');
	dialog.setAttribute('aria-describedby', 'force-warning');
	element('h2', 'force-title', 'Force quit?', dialog);
	element('p', 'force-warning', forceWarning, dialog);
	const cancel = element('button', 'cancel-force', 'Cancel', dialog);
	const confirm = element('button', 'confirm-force', 'Force quit', dialog);
	cancel.type = confirm.type = 'button';
	let disposed = false;
	let broken = false;
	let identity;
	let current;
	let early;
	let operation = null;
	let panel = false;
	let canceled = false;
	let confirmation;
	let deadline = 0;
	let timer;
	const events = channel();
	const terminal = () => current?.phase === 'complete' || current?.phase === 'forced';
	const eligible = () => !broken && !terminal() && current?.forceEligible === true;
	const render = () => {
		force.disabled = !identity || !eligible() || operation !== null || panel;
		confirm.disabled =
			!panel || !eligible() || operation !== null || !confirmation || now() >= deadline;
	};
	const request = (command, extra = {}) =>
		invoke(command, { payload: JSON.stringify({ version: 1, ...identity, ...extra }) });
	const closePanel = () => {
		panel = false;
		confirmation = undefined;
		unschedule(timer);
		if (dialog.open) {
			dialog.close();
		}
		waiting.focus();
	};
	const sendCancel = async () => {
		operation = 'cancel';
		render();
		try {
			if ((await request('shutdown_cancel_force_quit')) !== true) {
				throw new Error('Cancellation refused');
			}
		} catch {
			if (!disposed) {
				broken = true;
				error.textContent =
					'Force quit cancellation could not be confirmed. Keep waiting. No request was retried.';
			}
		} finally {
			operation = null;
			if (!disposed) {
				render();
			}
		}
	};
	const dismiss = () => {
		if (!panel || operation === 'confirm') {
			return;
		}
		canceled = true;
		closePanel();
		if (operation !== 'prepare') {
			void sendCancel();
		}
		render();
	};
	const fail = () => {
		broken = true;
		early = undefined;
		error.textContent =
			'Shutdown status is unavailable. Keep waiting. Cleanup has not been retried or reported as saved.';
		dismiss();
		render();
	};
	const apply = (value) => {
		if (value.attempt !== identity.attempt) {
			throw new Error('Wrong shutdown attempt');
		}
		if (terminal()) {
			return;
		}
		current = value;
		status.textContent = `${value.phase}: ${value.stage} — ${value.message}`;
		failure.textContent = value.failure === null ? '' : `Original failure: ${value.failure}`;
		if (!eligible()) {
			dismiss();
		}
		render();
	};
	events.onmessage = (value) => {
		if (disposed || broken) {
			return;
		}
		try {
			const update = snapshot(value);
			if (identity) {
				apply(update);
			} else if (!early || !['complete', 'forced'].includes(early.phase)) {
				// One full snapshot slot, never an unbounded pre-handshake queue.
				early = update;
			}
		} catch {
			fail();
		}
	};
	const prepare = async () => {
		if (force.disabled || disposed) {
			return;
		}
		operation = 'prepare';
		canceled = false;
		panel = true;
		error.textContent = '';
		dialog.showModal();
		cancel.focus();
		render();
		const started = now();
		try {
			const reply = await request('shutdown_prepare_force_quit');
			if (!disposed && !canceled && eligible()) {
				record(reply, ['version', 'confirmation', 'expiresInMs']);
				if (reply.version !== 1 || reply.expiresInMs !== 30000) {
					throw new Error('Invalid confirmation lifetime');
				}
				confirmation = text(reply.confirmation, 128);
				deadline = started + reply.expiresInMs;
				timer = schedule(
					() => {
						if (!disposed) {
							error.textContent = 'Force quit confirmation expired. Cancel to keep waiting.';
							render();
						}
					},
					Math.max(0, deadline - now()),
				);
			}
		} catch {
			if (!disposed && !canceled) {
				broken = true;
				error.textContent = 'Force quit preparation failed. Keep waiting. No request was retried.';
				canceled = true;
				closePanel();
			}
		} finally {
			operation = null;
			// Cancel after preparation settles so a late token cannot survive dismissal.
			if (canceled && !disposed) {
				await sendCancel();
			}
			if (!disposed) {
				render();
			}
		}
	};
	const confirmForce = async () => {
		if (disposed || confirm.disabled || now() >= deadline) {
			return;
		}
		const token = confirmation;
		confirmation = undefined;
		operation = 'confirm';
		cancel.disabled = true;
		render();
		try {
			if ((await request('shutdown_confirm_force_quit', { confirmation: token })) !== true) {
				throw new Error('Force quit refused');
			}
		} catch {
			if (!disposed) {
				error.textContent = 'Force quit was not confirmed. Keep waiting. No request was retried.';
			}
		} finally {
			operation = null;
			broken = true;
			if (!disposed) {
				closePanel();
				render();
			}
		}
	};
	force.addEventListener('click', prepare);
	confirm.addEventListener('click', confirmForce);
	cancel.addEventListener('click', dismiss);
	waiting.addEventListener('click', dismiss);
	const onCancel = (event) => {
		event.preventDefault();
		dismiss();
	};
	const onClose = () => {
		if (panel && !dialog.open) {
			dismiss();
		}
	};
	dialog.addEventListener('cancel', onCancel);
	dialog.addEventListener('close', onClose);
	waiting.focus();
	render();
	const ready = (async () => {
		try {
			const reply = await invoke('shutdown_connect', {
				payload: JSON.stringify({ version: 1 }),
				events,
			});
			if (disposed || broken) {
				return;
			}
			record(reply, ['version', 'session', 'attempt', 'snapshot']);
			if (reply.version !== 1) {
				throw new Error('Invalid shutdown version');
			}
			identity = { session: text(reply.session, 128), attempt: text(reply.attempt, 128) };
			apply(snapshot(reply.snapshot));
			if (early) {
				apply(early);
				early = undefined;
			}
		} catch {
			if (!disposed) {
				fail();
			}
		}
	})();
	return {
		ready,
		dispose() {
			if (disposed) {
				return;
			}
			disposed = true;
			early = undefined;
			confirmation = undefined;
			events.onmessage = () => {};
			unschedule(timer);
			force.removeEventListener('click', prepare);
			confirm.removeEventListener('click', confirmForce);
			cancel.removeEventListener('click', dismiss);
			waiting.removeEventListener('click', dismiss);
			dialog.removeEventListener('cancel', onCancel);
			dialog.removeEventListener('close', onClose);
		},
	};
}
