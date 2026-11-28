import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	execute,
	parseReport,
	parseShutdownReport,
	requiredStages,
	verifyOwnership,
} from './run.mjs';

const runId = 'a'.repeat(32);
const marker = 'APPLICATION_INTEGRATION_RESULT ';
function report(policy = 'strict-baseline') {
	return {
		version: 1,
		runId,
		ok: true,
		cleanupComplete: true,
		nativeStages: [
			...requiredStages,
			policy === 'strict-baseline'
				? 'packaged-strict-csp-blocks-resource-connectivity'
				: 'packaged-actual-requester-inert-resource-access',
		].map((name) => ({ name, ok: true })),
		fixture: {
			resourcePolicy: policy,
			publicationAttempted: false,
			preseededSchema: 2,
			nativeSourceSha256: 'b'.repeat(64),
			frontendDistSha256: 'c'.repeat(64),
			replacement: {
				ok: true,
				frontendReattached: true,
				cleanupComplete: true,
				previous: { epoch: 'old' },
				current: { epoch: 'new', revision: '0' },
			},
			resourceRequestStatuses: { 'workspace-a': 200, 'workspace-b': 200, manager: 403, probe: 403 },
		},
	};
}
function parse(value, policy = 'strict-baseline') {
	return parseReport(marker + JSON.stringify(value), runId, policy);
}
test('accepts only complete native campaigns, not frontend case aggregates', () => {
	assert.equal(parse(report()).ok, true);
	assert.equal(parse(report('requester-denial'), 'requester-denial').ok, true);
	const value = report();
	value.nativeStages.pop();
	assert.throws(() => parse(value), /policy-specific/);
	assert.throws(() => parse({ ok: true, cases: [{ ok: true }] }), /incomplete/);
});
test('rejects failed native stages, missing cleanup, publication and wrong run attribution', () => {
	for (const mutate of [
		(value) => {
			value.nativeStages[0].ok = false;
		},
		(value) => {
			value.cleanupComplete = false;
		},
		(value) => {
			value.fixture.publicationAttempted = true;
		},
		(value) => {
			value.runId = 'd'.repeat(32);
		},
		(value) => {
			value.fixture.nativeSourceSha256 = '';
		},
	]) {
		const value = report();
		mutate(value);
		assert.throws(() => parse(value));
	}
});
test('requires every current stage and lower-revision frontend replacement', () => {
	for (const name of requiredStages) {
		const value = report();
		value.nativeStages = value.nativeStages.filter((stage) => stage.name !== name);
		assert.throws(() => parse(value), /Required native stage/);
	}
	const value = report();
	value.fixture.replacement.frontendReattached = false;
	assert.throws(() => parse(value), /replacement/);
});
test('denial policy requires an allowed workspace positive control and manager/probe denial', () => {
	const value = report('requester-denial');
	value.fixture.resourceRequestStatuses['workspace-a'] = 403;
	assert.throws(() => parse(value, 'requester-denial'), /positive-control/);
});
test('rejects multiple, malformed or oversized completion reports', () => {
	const line = marker + JSON.stringify(report());
	assert.throws(() => parseReport(line + '\n' + line, runId, 'strict-baseline'), /one bounded/);
	assert.throws(() => parseReport(marker + '{', runId, 'strict-baseline'));
	assert.throws(
		() => parseReport(marker + ' '.repeat(128 * 1024), runId, 'strict-baseline'),
		/bounded/,
	);
});
const shutdownScenarios = ['slow', 'failure', 'active-save', 'force'];
function shutdownReport(scenario) {
	const forced = scenario === 'force';
	return {
		version: 1,
		runId,
		shutdownScenario: scenario,
		ok: !forced,
		cleanupComplete: !forced,
		shutdown: {
			version: 1,
			phase: forced ? 'forced' : 'complete',
			failure: scenario === 'failure' ? 'Simulated native finalization failure' : null,
		},
		fixture: {
			nativeSourceSha256: 'b'.repeat(64),
			frontendDistSha256: 'c'.repeat(64),
			publicationAttempted: false,
		},
		nativeStages: [
			'shutdown-window-connected',
			'shutdown-default-keep-waiting',
			'shutdown-peer-authority-denied',
			'shutdown-confirmation-cancelled',
			'shutdown-no-automatic-force',
			'shutdown-close-prevented',
			'shutdown-settings-authority-denied',
			'shutdown-exact-force-warning',
			'shutdown-reload-new-lifetime',
			'shutdown-reload-channel-connected',
			'shutdown-reload-default-keep-waiting',
			'shutdown-reload-stale-confirmation-denied',
			...(forced
				? ['shutdown-force-confirmed']
				: [
						'shutdown-cleanup-awaited',
						'shutdown-status-scheduler-awaited',
						'native-watchdog-not-expired',
					]),
			...(scenario === 'failure'
				? ['shutdown-failure-immediate', 'shutdown-original-failure-preserved']
				: []),
			...(scenario === 'active-save'
				? ['shutdown-active-save-admitted', 'shutdown-active-save-drained']
				: []),
		].map((name) => ({ name, ok: true })),
	};
}
function parseShutdown(value, scenario = value.shutdownScenario) {
	return parseShutdownReport(marker + JSON.stringify(value), runId, scenario);
}
test('shutdown campaigns distinguish clean completion from expected forced failure', () => {
	for (const scenario of shutdownScenarios) {
		const value = shutdownReport(scenario);
		assert.deepEqual(parseShutdown(value), value);
		assert.equal(parseShutdown(value).ok, scenario !== 'force');
		assert.throws(() => parse(value));
	}
	assert.throws(() => parseShutdown(report(), 'slow'));
	assert.throws(() => parseShutdown(shutdownReport('unknown')));
});
test('shutdown campaigns require every common and scenario-specific successful stage', () => {
	for (const scenario of shutdownScenarios) {
		for (const { name } of shutdownReport(scenario).nativeStages) {
			const missing = shutdownReport(scenario);
			missing.nativeStages = missing.nativeStages.filter((stage) => stage.name !== name);
			assert.throws(() => parseShutdown(missing), /Required native shutdown stage/);
			const failed = shutdownReport(scenario);
			failed.nativeStages.find((stage) => stage.name === name).ok = false;
			assert.throws(() => parseShutdown(failed), /incomplete/);
		}
	}
});
test('shutdown campaigns reject wrong outcomes, attribution and malformed stage lists', () => {
	for (const scenario of shutdownScenarios) {
		for (const mutate of [
			(value) => {
				value.version = 2;
			},
			(value) => {
				value.runId = 'd'.repeat(32);
			},
			(value) => {
				value.shutdownScenario = 'other';
			},
			(value) => {
				value.ok = !value.ok;
			},
			(value) => {
				value.cleanupComplete = !value.cleanupComplete;
			},
			(value) => {
				value.shutdown.version = 2;
			},
			(value) => {
				value.shutdown.phase = 'failed';
			},
			(value) => {
				value.shutdown.failure = 'different failure';
			},
			(value) => {
				delete value.shutdown;
			},
			(value) => {
				value.fixture.publicationAttempted = true;
			},
			(value) => {
				delete value.fixture.publicationAttempted;
			},
			(value) => {
				value.fixture.nativeSourceSha256 = '';
			},
			(value) => {
				value.fixture.frontendDistSha256 = 'g'.repeat(64);
			},
			(value) => {
				value.nativeStages = undefined;
			},
			(value) => {
				value.nativeStages.push(null);
			},
			(value) => {
				value.nativeStages.push({ name: 1, ok: true });
			},
			(value) => {
				value.nativeStages.push({ name: 'not-boolean', ok: 1 });
			},
			(value) => {
				value.nativeStages = Array(129).fill({ name: 'extra', ok: true });
			},
		]) {
			const value = shutdownReport(scenario);
			mutate(value);
			assert.throws(() => parseShutdown(value, scenario));
		}
	}
	const failure = shutdownReport('failure');
	failure.shutdown.failure = null;
	assert.throws(() => parseShutdown(failure));
});
test('shutdown reports must be single, bounded and valid JSON', () => {
	const line = marker + JSON.stringify(shutdownReport('slow'));
	for (const output of ['', marker + '{', line + '\n' + line, marker + ' '.repeat(128 * 1024)]) {
		assert.throws(() => parseShutdownReport(output, runId, 'slow'));
	}
	assert.throws(() => parseShutdown(null, 'slow'));
});
test('ownership verification refuses wrong markers and linked cleanup parents', async () => {
	const temporary = await mkdtemp(path.join(tmpdir(), 'application-runner-test-'));
	const parent = await realpath(temporary);
	const linked = parent + '-link';
	try {
		const filename = path.join(parent, '.application-integration-owner.json');
		await assert.rejects(verifyOwnership(parent, runId));
		await writeFile(filename, JSON.stringify({ schema: 1, runId }));
		await verifyOwnership(parent, runId);
		await assert.rejects(verifyOwnership(parent, 'b'.repeat(32)), /mismatch/);
		await symlink(parent, linked, 'dir');
		await assert.rejects(verifyOwnership(linked, runId), /canonical/);
	} finally {
		await rm(linked, { force: true });
		await rm(parent, { force: true, recursive: true });
	}
});
test('child execution rejects unsuccessful processes and oversized output', async () => {
	const cwd = path.dirname(new URL(import.meta.url).pathname);
	await assert.rejects(
		execute(process.execPath, ['-e', 'process.exitCode=3'], { cwd, env: process.env }),
		/code=3/,
	);
	await assert.rejects(
		execute(process.execPath, ['-e', 'console.log("x".repeat(2048))'], {
			cwd,
			env: process.env,
			budget: 128,
		}),
		/budget/,
	);
});
test('exit code 2 requires explicit expectation and does not permit signals or watchdog failures', async () => {
	const cwd = path.dirname(new URL(import.meta.url).pathname);
	const options = { cwd, env: process.env, expectedCode: 2 };
	await assert.rejects(
		execute(process.execPath, ['-e', 'process.exitCode=2'], { cwd, env: process.env }),
		/code=2/,
	);
	assert.equal(await execute(process.execPath, ['-e', 'process.exitCode=2'], options), '');
	await assert.rejects(execute(process.execPath, ['-e', 'process.exitCode=0'], options), /code=0/);
	await assert.rejects(
		execute(process.execPath, ['-e', 'process.kill(process.pid, "SIGTERM")'], options),
		/signal=SIGTERM/,
	);
	await assert.rejects(
		execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { ...options, timeout: 100 }),
		/deadline/,
	);
	await assert.rejects(
		execute(process.execPath, ['-e', 'console.log("x".repeat(2048)); process.exitCode=2'], {
			...options,
			budget: 128,
		}),
		/budget/,
	);
});
test('child deadlines terminate a stalled process instead of reporting success', async () => {
	const cwd = path.dirname(new URL(import.meta.url).pathname);
	await assert.rejects(
		execute(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
			cwd,
			env: process.env,
			timeout: 100,
		}),
		/deadline/,
	);
});
