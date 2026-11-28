import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execute, parseReport, requiredStages, verifyOwnership } from './run.mjs';

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
