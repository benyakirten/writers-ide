import { defaults, payload } from './wire.mjs';
import { boot, element, invoke, report, start } from './ui.mjs';

boot(async () => {
	const identity = await start('probe');
	element('h1', 'Unauthorized native caller probe');
	const cases = [];
	for (const [command, extra] of [
		['settings_read', {}],
		['settings_save', { requestId: '1', expectedRevision: '0', settings: defaults }],
		['settings_application_status', {}],
		['settings_attachment_read', { epoch: '0'.repeat(32), attachment: '0'.repeat(32) }],
		[
			'settings_save',
			{
				requestId: '1',
				expectedRevision: '0',
				settings: defaults,
				role: 'manager',
				window: 'manager',
			},
		],
	]) {
		let denied = false;
		try {
			await invoke(command, payload({ version: 1, session: identity.session, ...extra }));
		} catch {
			denied = true;
		}
		cases.push({ name: `probe-denied-${command}${extra.role ? '-forged-role' : ''}`, ok: denied });
	}
	element('pre', JSON.stringify(cases, null, 2));
	await report(identity, cases);
});
