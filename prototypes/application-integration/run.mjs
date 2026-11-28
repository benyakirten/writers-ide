import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, rm, writeFile, lstat } from 'node:fs/promises';
import { platform, release, arch } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const resultMarker = 'APPLICATION_INTEGRATION_RESULT ';
const ownerMarker = '.application-integration-owner.json';
export const requiredStages = Object.freeze([
	'strict-schema2-owned-startup',
	'native-inert-resource-requester-policy',
	'second-process-ownership-refusal',
	'two-native-initial-acknowledgments',
	'packaged-workspace-management-invokes-denied',
	'native-admitted-save-confirmed',
	'native-identical-duplicate-not-replayed',
	'native-duplicate-payload-mismatch-denied',
	'real-stale-revision-conflict',
	'real-noop-preserves-revision',
	'two-native-saved-revision-acknowledgments',
	'controlled-cancellation-retention-observations',
	'native-frozen-workspace-lease-expires',
	'frozen-synchronous-gate-observation',
	'explicit-reattach-fresh-native-identity',
	'probe-raw-invoke-observations',
	'packaged-popup-native-denial',
	'packaged-navigation-revokes-before-denial',
	'packaged-reload-revokes-document-session',
	'packaged-reload-acknowledged-attachment-baseline',
	'packaged-explicit-detach-before-reattach',
	'packaged-label-reuse-new-lifetime',
	'packaged-delayed-old-document-ack-denied',
	'campaign-not-interrupted',
	'attachment-scheduler-joined',
	'settings-and-attachments-awaited',
	'registry-shutdown-awaited',
	'inert-resources-released',
	'real-sqlite-clean-reopen-persistence',
	'reopened-registry-shutdown-awaited',
	'native-watchdog-not-expired',
	'packaged-primary-manager-saved-settings-visible',
	'packaged-replacement-old-windows-destroyed',
	'packaged-replacement-router-swapped',
	'packaged-replacement-new-document-lifetimes',
	'packaged-replacement-captured-old-host-closed',
	'packaged-replacement-workspace-initial-acks',
	'packaged-replacement-real-frontend-hosts-ready',
	'packaged-replacement-delayed-old-requests-denied',
	'packaged-replacement-manager-zero-settings-visible',
	'replacement-attachment-scheduler-joined',
	'packaged-cross-service-explicit-reattachment',
]);

export function parseReport(output, runId, policy) {
	const lines = output.split(/\r?\n/).filter((line) => line.startsWith(resultMarker));
	if (lines.length !== 1 || Buffer.byteLength(lines[0]) > 128 * 1024) {
		throw new Error('Expected one bounded native completion report');
	}
	const report = JSON.parse(lines[0].slice(resultMarker.length));
	if (
		report.version !== 1 ||
		report.runId !== runId ||
		report.ok !== true ||
		report.cleanupComplete !== true ||
		report.fixture?.resourcePolicy !== policy ||
		report.fixture?.publicationAttempted !== false ||
		report.fixture?.preseededSchema !== 2 ||
		!Array.isArray(report.nativeStages) ||
		report.nativeStages.length > 128 ||
		!report.nativeStages.every((stage) => typeof stage.name === 'string' && stage.ok === true)
	) {
		throw new Error('Native campaign failed or completion evidence is incomplete');
	}
	const stages = new Set(report.nativeStages.map((stage) => stage.name));
	for (const name of requiredStages) {
		if (!stages.has(name)) {
			throw new Error(`Required native stage missing: ${name}`);
		}
	}
	const resourceStage =
		policy === 'strict-baseline'
			? 'packaged-strict-csp-blocks-resource-connectivity'
			: 'packaged-actual-requester-inert-resource-access';
	if (!stages.has(resourceStage)) {
		throw new Error('Missing policy-specific packaged resource check');
	}
	for (const key of ['nativeSourceSha256', 'frontendDistSha256']) {
		if (!/^[a-f0-9]{64}$/.test(report.fixture[key] ?? '')) {
			throw new Error('Missing source/build attribution');
		}
	}
	const replacement = report.fixture.replacement;
	if (
		replacement?.ok !== true ||
		replacement.frontendReattached !== true ||
		replacement.cleanupComplete !== true ||
		replacement.current?.revision !== '0' ||
		replacement.previous?.epoch === replacement.current?.epoch
	) {
		throw new Error('Missing fresh-service packaged replacement evidence');
	}
	if (policy === 'requester-denial') {
		const statuses = report.fixture.resourceRequestStatuses;
		if (
			statuses?.['workspace-a'] !== 200 ||
			statuses?.['workspace-b'] !== 200 ||
			statuses?.manager !== 403 ||
			statuses?.probe !== 403
		) {
			throw new Error('Missing positive-control and denied-resource observations');
		}
	}
	return report;
}

export async function execute(
	command,
	args,
	{ cwd, env, timeout = 120_000, budget = 256 * 1024, log },
) {
	const output = await new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			env,
			detached: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const chunks = [];
		let bytes = 0;
		let failure;
		function stop(reason) {
			failure ??= reason;
			if (child.pid) {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch (error) {
					if (error.code !== 'ESRCH') {
						failure += `; termination failed: ${error.message}`;
					}
				}
			}
		}
		const timer = setTimeout(() => stop('Child deadline exceeded'), timeout);
		function collect(chunk) {
			if (bytes + chunk.length > budget) {
				stop('Child output budget exceeded');
				return;
			}
			bytes += chunk.length;
			chunks.push(chunk);
			process.stdout.write(chunk);
		}
		child.stdout.on('data', collect);
		child.stderr.on('data', collect);
		child.once('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, failure, output: Buffer.concat(chunks).toString('utf8') });
		});
	});
	if (log) {
		await writeFile(log, output.output, { flag: 'wx' });
	}
	if (output.failure || output.code !== 0 || output.signal !== null) {
		throw new Error(output.failure ?? `Child failed: code=${output.code}, signal=${output.signal}`);
	}
	return output.output;
}

export async function verifyOwnership(parent, runId) {
	if (!/^[a-f0-9]{32}$/.test(runId)) {
		throw new Error('Invalid cleanup run ID');
	}
	const metadata = await lstat(parent);
	if (!metadata.isDirectory() || metadata.isSymbolicLink() || (await realpath(parent)) !== parent) {
		throw new Error('Cleanup parent is not a canonical owned directory');
	}
	const marker = path.join(parent, ownerMarker);
	const stat = await lstat(marker);
	if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256) {
		throw new Error('Invalid cleanup ownership marker');
	}
	const value = JSON.parse(await readFile(marker, 'utf8'));
	if (
		Object.keys(value).sort().join(',') !== 'runId,schema' ||
		value.schema !== 1 ||
		value.runId !== runId
	) {
		throw new Error('Cleanup ownership marker mismatch');
	}
}

async function main() {
	if (process.argv.length !== 2 || platform() !== 'darwin') {
		throw new Error(
			'Run without arguments on macOS; other packaged platforms are not validated by this runner',
		);
	}
	const target = path.join(root, 'src-tauri/target');
	const invocation = randomBytes(16).toString('hex');
	const reports = path.join(root, 'reports', invocation);
	await mkdir(reports, { recursive: true });
	const env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_NET_OFFLINE: 'true' };
	const result = {
		schema: 'writers-ide.application-integration-run/1',
		ok: false,
		invocation,
		platform: platform(),
		release: release(),
		arch: arch(),
		runs: [],
	};
	try {
		await execute(
			'pnpm',
			['exec', 'tauri', 'build', '--debug', '--bundles', 'app', '--no-sign', '--ci'],
			{
				cwd: root,
				env,
				timeout: 600_000,
				budget: 4 * 1024 * 1024,
				log: path.join(reports, 'build.log'),
			},
		);
		await execute('cargo', ['build', '--locked', '--bin', 'seed'], {
			cwd: path.join(root, 'src-tauri'),
			env,
			timeout: 120_000,
			budget: 1024 * 1024,
			log: path.join(reports, 'seed-build.log'),
		});
		const executable = path.join(
			target,
			'debug/bundle/macos/Application Integration Fixture.app/Contents/MacOS/application-integration-fixture',
		);
		result.executableSha256 = createHash('sha256')
			.update(await readFile(executable))
			.digest('hex');
		result.seedSha256 = createHash('sha256')
			.update(await readFile(path.join(target, 'debug/seed')))
			.digest('hex');
		for (const policy of ['strict-baseline', 'requester-denial']) {
			const runId = randomBytes(16).toString('hex');
			const runDirectory = path.join(reports, policy);
			await mkdir(path.join(runDirectory, 'scratch'), { recursive: true });
			const parent = await realpath(path.join(runDirectory, 'scratch'));
			await writeFile(path.join(parent, ownerMarker), JSON.stringify({ schema: 1, runId }), {
				flag: 'wx',
			});
			const run = { runId, policy, ok: false, scratchRetained: true };
			result.runs.push(run);
			try {
				const args = ['--parent', parent, '--run-id', runId];
				const seedOutput = await execute(path.join(target, 'debug/seed'), args, {
					cwd: root,
					env,
					log: path.join(runDirectory, 'seed.log'),
				});
				const seedLine = seedOutput
					.trim()
					.split(/\r?\n/)
					.filter((line) => line.startsWith('APPLICATION_INTEGRATION_SEED '));
				if (seedLine.length !== 1) {
					throw new Error('Missing seed completion');
				}
				const seed = JSON.parse(seedLine[0].slice('APPLICATION_INTEGRATION_SEED '.length));
				if (
					seed.runId !== runId ||
					seed.schema !== 2 ||
					seed.closed !== true ||
					seed.preseeded !== true ||
					seed.publicationAttempted !== false
				) {
					throw new Error('Invalid preseeded-input evidence');
				}
				const output = await execute(
					executable,
					policy === 'requester-denial' ? [...args, '--resource-denial-policy'] : args,
					{
						cwd: root,
						env,
						timeout: 120_000,
						log: path.join(runDirectory, 'packaged.log'),
					},
				);
				run.report = parseReport(output, runId, policy);
				const nativeEvidence = JSON.parse(
					await readFile(path.join(parent, 'native-result.json'), 'utf8'),
				);
				if (JSON.stringify(nativeEvidence) !== JSON.stringify(run.report)) {
					throw new Error('Native retained report differs from stdout report');
				}
				await writeFile(
					path.join(runDirectory, 'native-result.json'),
					JSON.stringify(nativeEvidence, null, 2) + '\n',
					{ flag: 'wx' },
				);
				await verifyOwnership(parent, runId);
				await rm(parent, { recursive: true });
				run.scratchRetained = false;
				run.ok = true;
			} catch (error) {
				run.error = error.message;
			}
		}
		result.ok = result.runs.length === 2 && result.runs.every((run) => run.ok);
	} catch (error) {
		result.error = error.message;
	} finally {
		await writeFile(path.join(reports, 'result.json'), JSON.stringify(result, null, 2) + '\n', {
			flag: 'wx',
		});
		console.log(
			`Packaged fixture ${result.ok ? 'passed' : 'failed'}: ${path.join(reports, 'result.json')}`,
		);
		process.exitCode = result.ok ? 0 : 1;
	}
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => {
		console.error(error.message);
		process.exitCode = 1;
	});
}
