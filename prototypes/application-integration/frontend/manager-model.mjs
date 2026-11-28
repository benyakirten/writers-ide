import {
	applicationStatus,
	decimal,
	diagnostic,
	handshake,
	limits,
	MAX_I64,
	payload,
	saveResult,
	snapshot,
	timed,
} from './wire.mjs';

export function createManagerModel(identity, invoke, timeout = timed) {
	let next = BigInt(identity.nextSaveSequence);
	let current = null;
	let draft = null;
	let pending = null;
	let message = 'No saved state loaded';
	let rows = [];
	let busy = false;
	const dto = (extra = {}) => ({ version: 1, session: identity.session, ...extra });
	async function read() {
		current = snapshot(await timeout(invoke('settings_read', payload(dto()))));
		if (!draft) {
			draft = structuredClone(current.settings);
		}
		return current;
	}
	async function synchronizeSequence() {
		const value = handshake(await timeout(invoke('session_handshake')));
		if (value.session !== identity.session || value.role !== 'manager') {
			throw new Error('Manager lifetime changed; reload required');
		}
		next = BigInt(value.nextSaveSequence);
	}
	function finish(result) {
		if (result.kind === 'pending') {
			message = 'Save is still pending. No write was retried.';
			return;
		}
		if (result.kind === 'saved') {
			current = snapshot(result.snapshot);
			message = `Saved revision ${current.revision}. Workspace application is separate.`;
		} else {
			if (result.current) {
				current = snapshot(result.current);
			}
			message = `Conflict: ${result.error.message}. Draft retained. Review the current saved state before saving again.`;
		}
		next = BigInt(pending.requestId) + 1n;
		pending = null;
	}
	return {
		get current() {
			return current;
		},
		get draft() {
			return draft;
		},
		set draft(value) {
			draft = value;
		},
		get message() {
			return message;
		},
		get pending() {
			return pending;
		},
		get busy() {
			return busy;
		},
		get rows() {
			return rows;
		},
		read,
		async status() {
			rows = applicationStatus(
				await timeout(invoke('settings_application_status', payload(dto()))),
			);
		},
		async save() {
			if (busy || pending || !current || next > MAX_I64) {
				throw new Error('Save unavailable; reconcile any unconfirmed request first');
			}
			const settings = limits(draft);
			const requestId = decimal(String(next), true);
			pending = { requestId, expectedRevision: current.revision, settings };
			busy = true;
			try {
				finish(
					saveResult(await timeout(invoke('settings_save', payload(dto(pending)))), requestId),
				);
			} catch (error) {
				if (error?.code === 'transport-timeout') {
					message =
						'Save result unconfirmed: transport timeout. It may have committed. Use Check result; do not retry the write.';
				} else {
					try {
						const native = diagnostic(error);
						message = `Native save error (${native.code}): ${native.message}. This is not a transport timeout. Check the exact result; no automatic retry.`;
						if (native.code === 'busy') {
							await synchronizeSequence();
							if (next === BigInt(pending.requestId)) {
								pending = null;
								message =
									'Native save admission was busy. The handshake confirms this request sequence is still unused. Draft retained; Save is available for an explicit new attempt.';
							}
						}
					} catch {
						message =
							'Save result unconfirmed: invalid response or unavailable transport. Check the exact result; no automatic retry.';
					}
				}
			} finally {
				busy = false;
			}
		},
		async reconcile() {
			if (!pending || busy) {
				return;
			}
			busy = true;
			try {
				finish(
					saveResult(
						await timeout(
							invoke('settings_result', payload(dto({ requestId: pending.requestId }))),
						),
						pending.requestId,
					),
				);
			} catch (error) {
				if (error?.code === 'result-expired') {
					await read();
					await synchronizeSequence();
					pending = null;
					message =
						'Exact result expired. Current saved state was read. It does not prove whether the earlier request committed. Draft retained.';
				} else {
					throw error;
				}
			} finally {
				busy = false;
			}
		},
	};
}
