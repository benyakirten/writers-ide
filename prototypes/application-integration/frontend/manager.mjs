import { createManagerModel } from './manager-model.mjs';
import { defaults, field, fields } from './wire.mjs';
import { boot, button, element, invoke, report, start, status } from './ui.mjs';

boot(async () => {
	const identity = await start('manager');
	element('h1', 'Resource limits');
	element(
		'p',
		'Save writes the complete configuration. Saved does not mean applied in every workspace.',
	);
	const model = createManagerModel(identity, invoke);
	await model.read();
	const form = element('div');
	const inputs = new Map();
	for (const key of fields) {
		const row = element('div', undefined, form);
		const label = element('label', key, row);
		const input = element('input', undefined, label);
		input.id = key;
		input.type = 'number';
		input.min = '1';
		input.max = String(Number.MAX_SAFE_INTEGER);
		input.step = '1';
		input.value = String(field(model.draft, key));
		const warning = element('span', '', row);
		const update = () => {
			const value = Number(input.value);
			if (key.startsWith('payload.')) {
				model.draft.payload[key.slice(8)] = value;
			} else {
				model.draft[key] = value;
			}
			warning.textContent =
				value > field(defaults, key) ? ' Above default: higher memory or concurrency risk.' : '';
		};
		input.addEventListener('input', update);
		button(
			'Reset',
			() => {
				input.value = String(field(defaults, key));
				update();
			},
			row,
		);
		inputs.set(key, input);
		update();
	}
	const saved = element('pre');
	saved.id = 'saved';
	const applied = element('pre');
	applied.id = 'application-status';
	let save;
	let reconcile;
	const render = () => {
		status.textContent = model.message;
		saved.textContent = `Saved/read snapshot (a later revision may already exist):\n${JSON.stringify(model.current, null, 2)}`;
		applied.textContent = `Native workspace application reports (not attestation):\n${JSON.stringify(model.rows, null, 2)}`;
		save.disabled = model.busy || Boolean(model.pending);
		reconcile.disabled = model.busy || !model.pending;
	};
	save = button('Save full configuration', async () => {
		for (const input of inputs.values()) {
			if (!input.reportValidity()) {
				return;
			}
		}
		const operation = model.save();
		render();
		try {
			await operation;
			await model.status();
		} finally {
			render();
		}
	});
	save.id = 'save';
	reconcile = button('Check exact save result', async () => {
		try {
			await model.reconcile();
		} finally {
			render();
		}
	});
	reconcile.id = 'check-result';
	button('Read saved state and application status', async () => {
		await model.read();
		await model.status();
		render();
	});
	button('Report observations', () =>
		report(identity, [
			{ name: 'manager-saved-state-visible', ok: model.current !== null },
			{ name: 'manager-eight-inputs', ok: inputs.size === 8 },
		]),
	);
	await model.status();
	render();
});
