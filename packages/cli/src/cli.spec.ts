import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { parseCliArgs } from './args.js';
import { runCli, ICliIo } from './cli.js';
import { EXIT_OK, EXIT_THRESHOLD_EXCEEDED, EXIT_USAGE_OR_RUNTIME_ERROR } from './exit-codes.js';

const FIXTURE_ROOT = fileURLToPath(
	new URL('../../core/test/fixtures/angular/ngx-translate-json/kitchen-sink', import.meta.url)
);
const MULTI_LOCALE_FIXTURE_ROOT = fileURLToPath(
	new URL('../test/fixtures/multi-locale', import.meta.url)
);
const INVALID_BASE_CONFIG = fileURLToPath(
	new URL('../test/fixtures/multi-locale/invalid-base.config.json', import.meta.url)
);
const INVALID_TRANSLATION_FIXTURE_ROOT = fileURLToPath(
	new URL('../test/fixtures/invalid-translation', import.meta.url)
);

interface ICapturedIo extends ICliIo {
	out: string[];
	err: string[];
	files: Map<string, string>;
}

function createIo(): ICapturedIo {
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

interface IJsonReport {
	schemaVersion: number;
	severityCounts: { error: number; warning: number; info: number };
	metadata: { baseLocale?: string; baseLocaleSelectionSource?: string };
	findings: Array<{ key: string; status: string; severity: string; language: string | null }>;
}

function parseJsonReport(io: ICapturedIo): IJsonReport {
	return JSON.parse(io.out.join('')) as IJsonReport;
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
		expect(report.schemaVersion).toBe(2);
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

	it('counts per-locale findings against thresholds and reports their locales', async () => {
		const failingIo = createIo();
		const failingExitCode = await runCli(
			['scan', MULTI_LOCALE_FIXTURE_ROOT, '--quiet', '--reporter', 'json', '--max-errors', '2'],
			failingIo
		);
		const report = parseJsonReport(failingIo);

		expect(failingExitCode).toBe(EXIT_THRESHOLD_EXCEEDED);
		expect(report.severityCounts.error).toBe(3);
		expect(report.metadata).toMatchObject({ baseLocale: 'en', baseLocaleSelectionSource: 'exact-en' });
		expect(report.findings).toContainEqual(expect.objectContaining({
			key: 'APP.BASE_ONLY',
			status: 'missing-in-language',
			language: 'de'
		}));
		expect(report.findings).toContainEqual(expect.objectContaining({
			key: 'APP.EXTRA',
			status: 'extra-in-language',
			language: 'de'
		}));
		expect(
			report.findings
				.filter((finding) => finding.key === 'APP.NOWHERE')
				.map((finding) => finding.language)
				.sort()
		).toEqual(['de', 'en']);

		const passingIo = createIo();
		const passingExitCode = await runCli(
			['scan', MULTI_LOCALE_FIXTURE_ROOT, '--quiet', '--reporter', 'json', '--max-errors', '3'],
			passingIo
		);
		expect(passingExitCode).toBe(EXIT_OK);

		const ignoredIo = createIo();
		await runCli(
			[
				'scan',
				MULTI_LOCALE_FIXTURE_ROOT,
				'--quiet',
				'--reporter',
				'json',
				'--ignore',
				'APP.NOWHERE',
				'--max-errors',
				'1'
			],
			ignoredIo
		);
		const ignoredReport = parseJsonReport(ignoredIo);
		expect(ignoredReport.severityCounts.error).toBe(1);
		expect(ignoredReport.findings.some((finding) => finding.key === 'APP.NOWHERE')).toBe(false);
	});

	it('fails clearly when configured baseLocale is not discovered', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['scan', MULTI_LOCALE_FIXTURE_ROOT, '--quiet', '--config', INVALID_BASE_CONFIG],
			io
		);

		expect(exitCode).toBe(EXIT_USAGE_OR_RUNTIME_ERROR);
		expect(io.err.join('')).toContain('Configured baseLocale "fr" was not found');
	});

	it('fails without a partial report when a translation file contains invalid JSON', async () => {
		const io = createIo();
		const exitCode = await runCli(
			['scan', INVALID_TRANSLATION_FIXTURE_ROOT, '--quiet', '--reporter', 'json'],
			io
		);

		expect(exitCode).toBe(EXIT_USAGE_OR_RUNTIME_ERROR);
		expect(io.out).toHaveLength(0);
		expect(io.files.size).toBe(0);
		expect(io.err.join('')).toContain('Invalid JSON in translation file');
		expect(io.err.join('')).toContain('/src/assets/i18n/de.json');
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
		// Match the documented reporter-to-file assignment syntax in the validation error.
		expect(() => parseCliArgs(['scan', '.', '--output', 'summary.md'])).toThrowError(/<reporter>=<file>/);
	});

	it('rejects negative thresholds', () => {
		// Match the stable validation phrase requiring a threshold of zero or greater.
		expect(() => parseCliArgs(['scan', '.', '--max-errors=-1'])).toThrowError(/non-negative/);
	});
});
