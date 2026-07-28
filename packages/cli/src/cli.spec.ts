import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseCliArgs } from './args.js';
import { runCli, CliIo } from './cli.js';
import { EXIT_OK, EXIT_THRESHOLD_EXCEEDED, EXIT_USAGE_OR_RUNTIME_ERROR } from './exit-codes.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../test/fixtures/angular-app', import.meta.url));

interface CapturedIo extends CliIo {
	out: string[];
	err: string[];
	files: Map<string, string>;
}

function createIo(): CapturedIo {
	const out: string[] = [];
	const err: string[] = [];
	const files = new Map<string, string>();

	return {
		out,
		err,
		files,
		stdout: (text) => void out.push(text),
		stderr: (text) => void err.push(text),
		writeFile: async (filePath, content) => void files.set(filePath, content)
	};
}

interface JsonReport {
	schemaVersion: number;
	severityCounts: { error: number; warning: number; info: number };
	findings: Array<{ key: string; status: string; severity: string }>;
}

function parseJsonReport(io: CapturedIo): JsonReport {
	return JSON.parse(io.out.join('')) as JsonReport;
}

describe('runCli', () => {
	it('reports missing keys as errors and fails with the default thresholds', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['scan', FIXTURE_ROOT, '--quiet', '--reporter', 'json', '--no-color'],
			io
		);

		const report = parseJsonReport(io);

		expect(exitCode).toBe(EXIT_THRESHOLD_EXCEEDED);
		expect(report.schemaVersion).toBe(1);
		expect(report.severityCounts.error).toBe(1);
		expect(report.findings.some((f) => f.key === 'APP.MISSING' && f.status === 'missing-in-language')).toBe(true);
		expect(report.findings.some((f) => f.key === 'APP.TITLE' && f.status === 'used')).toBe(true);
		expect(report.findings.some((f) => f.key === 'APP.UNUSED' && f.status === 'unused')).toBe(true);
	});

	it('passes when the error threshold allows the finding', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['scan', FIXTURE_ROOT, '--quiet', '--reporter', 'json', '--max-errors', '1'],
			io
		);

		expect(exitCode).toBe(EXIT_OK);
	});

	it('fails when the warning threshold is exceeded', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['scan', FIXTURE_ROOT, '--quiet', '--reporter', 'json', '--max-errors', '1', '--max-warnings', '0'],
			io
		);

		expect(exitCode).toBe(EXIT_THRESHOLD_EXCEEDED);
	});

	it('drops findings matching --ignore', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['scan', FIXTURE_ROOT, '--quiet', '--reporter', 'json', '--ignore', 'APP.MISSING', '--ignore', 'APP.UNUSED'],
			io
		);
		const report = parseJsonReport(io);

		expect(exitCode).toBe(EXIT_OK);
		expect(report.findings.some((f) => f.key === 'APP.MISSING')).toBe(false);
		expect(report.severityCounts.error).toBe(0);
	});

	it('writes a reporter to a file instead of stdout', async () => {
		const io = createIo();
		await runCli(['scan', FIXTURE_ROOT, '--quiet', '--output', 'json=report.json', '--max-errors', '9'], io);

		expect(io.out).toHaveLength(0);
		expect([...io.files.keys()].some((file) => file.endsWith('report.json'))).toBe(true);
	});

	it('exits with the runtime error code for a missing project path', async () => {
		const io = createIo();
		const exitCode = await runCli(['scan', `${FIXTURE_ROOT}-does-not-exist`, '--quiet'], io);

		expect(exitCode).toBe(EXIT_USAGE_OR_RUNTIME_ERROR);
		expect(io.err.join('')).toContain('does not exist');
	});

	it('exits with the usage error code for an unknown reporter', async () => {
		const io = createIo();
		const exitCode = await runCli(['scan', FIXTURE_ROOT, '--reporter', 'xml'], io);

		expect(exitCode).toBe(EXIT_USAGE_OR_RUNTIME_ERROR);
		expect(io.err.join('')).toContain('Unknown reporter');
	});
});

describe('parseCliArgs', () => {
	it('defaults to the text reporter and the current directory', () => {
		const options = parseCliArgs([]);

		expect(options.command).toBe('scan');
		expect(options.projectPath).toBe('.');
		expect(options.reporters).toEqual(['text']);
		expect(options.maxErrors).toBe(0);
		expect(options.maxWarnings).toBe(-1);
	});

	it('registers reporters referenced by --output', () => {
		const options = parseCliArgs(['scan', '.', '--output', 'markdown=summary.md']);

		expect(options.reporters).toEqual(['markdown']);
		expect(options.outputs.get('markdown')).toBe('summary.md');
	});

	it('rejects malformed --output values', () => {
		expect(() => parseCliArgs(['scan', '.', '--output', 'summary.md'])).toThrowError(/<reporter>=<file>/);
	});

	it('rejects negative thresholds', () => {
		expect(() => parseCliArgs(['scan', '.', '--max-errors=-1'])).toThrowError(/non-negative/);
	});
});
