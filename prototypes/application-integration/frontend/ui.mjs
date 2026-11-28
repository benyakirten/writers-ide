import { bounded, errorText, handshake, payload, record, timed } from './wire.mjs';
import { invoke } from '@tauri-apps/api/core';
import './style.css';

export { invoke };
export function element(tag, text, parent = document.body) {
	const node = document.createElement(tag);
	if (text !== undefined) {
		node.textContent = text;
	}
	parent.append(node);
	return node;
}
export function button(text, action, parent = document.body) {
	const node = element('button', text, parent);
	node.type = 'button';
	node.addEventListener('click', () => {
		void Promise.resolve()
			.then(action)
			.catch((error) => {
				status.textContent = errorText(error);
			});
	});
	return node;
}
export const status = element('p', 'Connecting to native fixture');
status.id = 'status';
status.setAttribute('role', 'status');
export async function start(role) {
	const identity = handshake(await timed(invoke('session_handshake')));
	if (identity.role !== role) {
		throw new Error('Native role does not match this entry');
	}
	// Neither this entry nor URL parameters grant authority. Native validates every request.
	const value = bounded(
		await timed(invoke('bootstrap_status', payload({ version: 1, session: identity.session }))),
	);
	record(value, ['state']);
	if (typeof value.state !== 'string' || value.state.length > 512) {
		throw new Error('Invalid bootstrap state');
	}
	status.textContent = `Native bootstrap: ${value.state}`;
	return identity;
}
export async function report(identity, cases) {
	if (
		cases.length > 32 ||
		cases.some(
			(entry) =>
				typeof entry.name !== 'string' || entry.name.length > 128 || typeof entry.ok !== 'boolean',
		)
	) {
		throw new Error('Invalid fixture report');
	}
	const result = await timed(
		invoke('fixture_report', payload({ version: 1, session: identity.session, cases })),
	);
	if (result !== true) {
		throw new Error('Native report rejected');
	}
}
export function boot(action) {
	void action().catch((error) => {
		status.textContent = errorText(error);
	});
}
