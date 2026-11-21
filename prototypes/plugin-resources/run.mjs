import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, arch } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const reports = resolve(root, 'reports');
const target = resolve(root, process.env.CARGO_TARGET_DIR ?? 'target');
const marker = 'RESOURCE_PROTOTYPE_RESULT ';

// Every child has a separate process group so deadlines also stop build descendants.
function execute(command, args, timeout, budget, logName) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			detached: true,
			env: { ...process.env, CARGO_NET_OFFLINE: 'true', CARGO_TARGET_DIR: target },
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const chunks = [];
		let bytes = 0;
		let failure;
		function stop(reason) {
			failure ??= reason;
			try {
				process.kill(-child.pid, 'SIGKILL');
			} catch (error) {
				if (error.code !== 'ESRCH') {
					failure = `${reason}; process termination failed: ${error.message}`;
				}
			}
		}
		const timer = setTimeout(() => stop('External deadline exceeded'), timeout);
		function collect(chunk) {
			if (bytes + chunk.length > budget) {
				stop('Output budget exceeded');
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
		child.once('close', async (code, signal) => {
			clearTimeout(timer);
			const output = Buffer.concat(chunks).toString('utf8');
			try {
				await writeFile(resolve(reports, logName), output);
				resolveRun({ code, signal, failure, output });
			} catch (error) {
				reject(error);
			}
		});
	});
}

async function main() {
	if (platform() !== 'darwin') {
		throw new Error('This runner currently supports packaged macOS .app execution only');
	}
	await mkdir(reports, { recursive: true });
	const build = await execute(
		'pnpm',
		['exec', 'tauri', 'build', '--debug', '--bundles', 'app', '--no-sign', '--ci'],
		600000,
		4 * 1024 * 1024,
		'build.log',
	);
	if (build.failure || build.code !== 0) {
		throw new Error(build.failure ?? `Packaged build failed (${build.code})`);
	}
	const executable = resolve(
		target,
		'debug/bundle/macos/Plugin Resource Prototype.app/Contents/MacOS/plugin-resource-prototype',
	);
	const results = [];
	for (const mode of ['normal', 'recovery']) {
		const run = await execute(
			executable,
			mode === 'recovery' ? ['--recovery'] : [],
			40000,
			128 * 1024,
			`${mode}.log`,
		);
		let report;
		let error = run.failure;
		try {
			const lines = run.output.split(/\r?\n/).filter((line) => line.startsWith(marker));
			if (lines.length !== 1 || Buffer.byteLength(lines[0]) > 66000) {
				throw new Error('Expected exactly one bounded native result');
			}
			report = JSON.parse(lines[0].slice(marker.length));
			if (
				report.mode !== mode ||
				report.ok !== true ||
				!Array.isArray(report.cases) ||
				report.cases.length === 0 ||
				!report.cases.every((item) => item.ok === true)
			) {
				throw new Error('Failed or incomplete frontend report');
			}
		} catch (caught) {
			error ??= caught.message;
		}
		results.push({ mode, code: run.code, signal: run.signal, error, report });
	}
	const ok = results.every((result) => result.code === 0 && !result.error);
	await writeFile(
		resolve(reports, 'result.json'),
		JSON.stringify(
			{
				ok,
				timestamp: new Date().toISOString(),
				platform: platform(),
				release: release(),
				arch: arch(),
				results,
			},
			null,
			2,
		) + '\n',
	);
	console.log(
		`Packaged prototype ${ok ? 'passed' : 'failed'}; see prototypes/plugin-resources/reports/result.json`,
	);
	process.exitCode = ok ? 0 : 1;
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
