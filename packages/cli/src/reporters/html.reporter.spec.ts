import { join, resolve } from 'node:path';

import { IProjectScanResult, normalizePath } from '@key-lint/core';
import { describe, expect, it } from 'vitest';

import { htmlReporter } from './html.reporter.js';
import { IReporterContext } from './reporter.interfaces.js';

function createResult(projectRoot: string): IProjectScanResult {
	return {
		projectRoot,
		adapterId: 'angular',
		startedAt: '2026-08-29T08:00:00.000Z',
		finishedAt: '2026-08-29T08:00:01.250Z',
		durationMs: 1250,
		summary: {
			totalKeys: 3,
			used: 1,
			unused: 1,
			dynamicOrUncertain: 0,
			indirectUncertain: 0,
			missingInLanguage: 1,
			extraInLanguage: 0,
			placeholderMissing: 0,
			placeholderUncertain: 0,
			placeholderMismatch: 0,
			totalFindings: 3
		},
		findings: [
			{
				id: 'missing',
				adapterId: 'angular',
				key: 'APP.<unsafe>',
				status: 'missing-in-language',
				severity: 'error',
				message: `Missing <img src=x onerror="alert(1)"> in ${projectRoot}`,
				language: 'de',
				evidence: [
					{
						filePath: join(projectRoot, 'src', 'app', 'app.component.html'),
						line: 7,
						column: 4,
						snippet: 'PRIVATE SOURCE SNIPPET',
						matchType: 'template'
					},
					{
						filePath: join(projectRoot, 'src', 'app', 'second.component.ts'),
						line: 12,
						matchType: '<unsafe-match>'
					}
				],
				placeholderDetails: {
					required: ['name', '<unsafe-placeholder>'],
					provided: ['name'],
					missing: ['<unsafe-placeholder>']
				}
			},
			{
				id: 'unused',
				adapterId: 'angular',
				key: 'APP.UNUSED',
				status: 'unused',
				severity: 'warning',
				message: 'Unused key',
				evidence: [{ filePath: resolve(projectRoot, '..', 'outside.ts'), line: 2 }]
			},
			{
				id: 'used',
				adapterId: 'angular',
				key: 'APP.USED',
				status: 'used',
				severity: 'info',
				message: 'Used key',
				evidence: []
			}
		],
		errors: [],
		translationMatrix: {
			locales: ['de', 'en'],
			rows: [{ key: 'APP.USED', values: { de: 'Geheim', en: 'Secret translation value' } }],
			totalKeys: 3
		},
		metadata: { baseLocale: 'en' }
	};
}

function createContext(projectRoot: string): IReporterContext {
	return {
		configFilePath: join(projectRoot, 'keylint.config.json'),
		warnings: [`${projectRoot}/src/large.ts: skipped <unsafe warning>`],
		color: false,
		thresholds: { maxErrors: 0, maxWarnings: -1 },
		counts: { error: 1, warning: 1, info: 1 }
	};
}

describe('htmlReporter', () => {
	it('renders a standalone stakeholder dashboard with every finding and summary metric', () => {
		const projectRoot = resolve('fixtures', 'private-project');
		const output = htmlReporter.format(createResult(projectRoot), createContext(projectRoot));

		expect(output).toContain('<!doctype html>');
		expect(output).toContain('Content-Security-Policy');
		expect(output).toMatch(/script-src 'sha256-[A-Za-z0-9+/]+=*'/);
		expect(output).not.toContain("script-src 'unsafe-inline'");
		expect(output).toContain('<span class="status">failed</span>');
		expect(output).toContain('Translation keys');
		expect(output).toContain('Total findings');
		expect(output).toContain('<dl class="metrics">');
		expect(output).toContain('metric--error');
		expect(output).toContain('Findings (3)');
		expect(output).toContain('<table class="findings-table" data-default-severity="error">');
		expect(output).toContain('<col class="col-key">');
		expect(output).toContain('APP.&lt;unsafe&gt;');
		expect(output).toContain('src/app/app.component.html:7:4');
		expect(output).toContain('external/outside.ts:2');
		expect(output).toContain('keylint.config.json');
		expect(output).toContain('warnings unlimited');
	});

	it('introduces the report and explains every finding status', () => {
		const projectRoot = resolve('fixtures', 'guide-project');
		const output = htmlReporter.format(createResult(projectRoot), createContext(projectRoot));

		expect(output).toContain('<h2 id="introduction-heading">About this report</h2>');
		expect(output).toContain('Start with errors that require action');
		expect(output).toContain('The scan exceeded at least one configured error or warning threshold.');
		expect(output).toContain('<h2 id="status-guide-heading">Status guide</h2>');
		for (const status of [
			'used',
			'unused',
			'dynamic-uncertain',
			'indirect-uncertain',
			'missing-in-language',
			'extra-in-language',
			'placeholder-missing',
			'placeholder-uncertain',
			'placeholder-mismatch'
		]) {
			expect(output).toContain(`<code>${status}</code>`);
		}
		expect(output).toContain('Check dynamic usage before removing it.');
	});

	it('adds local filtering, full-text search, sorting, result counts, and reset controls', () => {
		const projectRoot = resolve('fixtures', 'dashboard-project');
		const output = htmlReporter.format(createResult(projectRoot), createContext(projectRoot));

		expect(output).toContain('id="finding-search"');
		expect(output).toContain('id="severity-filter"');
		expect(output).toContain('id="status-filter"');
		expect(output).toContain('id="locale-filter"');
		expect(output).toContain('id="reset-filters"');
		expect(output).toContain('Showing 3 of 3 findings');
		expect(output).toContain('data-sort="severity"');
		expect(output).toContain('data-sort="location"');
		expect(output).toContain('data-severity="error"');
		expect(output).toContain('data-status="missing-in-language"');
		expect(output).toContain('data-locale="de"');
		expect(output).toContain('<option value="__none__">No locale</option>');
		expect(output).toContain("row.textContent.toLocaleLowerCase().includes(query)");
		expect(output).toContain('<noscript>');
	});

	it('renders every evidence location and structured placeholder detail safely', () => {
		const projectRoot = resolve('fixtures', 'details-project');
		const output = htmlReporter.format(createResult(projectRoot), createContext(projectRoot));

		expect(output).toContain('<details><summary>View details</summary>');
		expect(output).toContain('src/app/app.component.html:7:4');
		expect(output).toContain('src/app/second.component.ts:12');
		expect(output).toContain('(template)');
		expect(output).toContain('(&lt;unsafe-match&gt;)');
		expect(output).toContain('<strong>Placeholders</strong>');
		expect(output).toContain('<dt>Required</dt>');
		expect(output).toContain('&lt;unsafe-placeholder&gt;');
	});

	it('does not expose absolute roots, snippets, translation values, or executable markup', () => {
		const projectRoot = resolve('fixtures', 'private-project');
		const output = htmlReporter.format(createResult(projectRoot), createContext(projectRoot));

		expect(output).not.toContain(projectRoot);
		expect(output).not.toContain(normalizePath(projectRoot));
		expect(output).not.toContain('PRIVATE SOURCE SNIPPET');
		expect(output).not.toContain('Secret translation value');
		expect(output).not.toContain('<img src=x');
		expect(output).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
		expect(output).toContain('&lt;unsafe warning&gt;');
	});

	it('renders passed status and an empty findings state', () => {
		const projectRoot = resolve('fixtures', 'clean-project');
		const result = createResult(projectRoot);
		result.findings = [];
		result.summary = { ...result.summary, totalFindings: 0 };
		const context = createContext(projectRoot);
		context.counts = { error: 0, warning: 0, info: 0 };

		const output = htmlReporter.format(result, context);

		expect(output).toContain('<span class="status">passed</span>');
		expect(output).toContain('The scan stayed within the configured error and warning thresholds.');
		expect(output).toContain('<td colspan="7" class="empty">No findings.</td>');
		expect(output).toContain('data-default-severity="all"');
	});

	it('defaults to warnings when a report contains no errors', () => {
		const projectRoot = resolve('fixtures', 'warning-only-project');
		const result = createResult(projectRoot);
		result.findings = result.findings.filter((finding) => finding.severity !== 'error');
		const context = createContext(projectRoot);
		context.counts = { error: 0, warning: 1, info: 1 };

		const output = htmlReporter.format(result, context);

		expect(output).toContain('data-default-severity="warning"');
	});

	it('fails when the warning threshold is exceeded even if errors are allowed', () => {
		const projectRoot = resolve('fixtures', 'warning-project');
		const context = createContext(projectRoot);
		context.thresholds = { maxErrors: 10, maxWarnings: 0 };

		const output = htmlReporter.format(createResult(projectRoot), context);

		expect(output).toContain('<span class="status">failed</span>');
		expect(output).toContain('warnings 0');
	});

	it('redacts credential values before HTML escaping changes them', () => {
		const projectRoot = resolve('fixtures', 'remote-project');
		const secret = 'Bearer <private>&"value"';
		const result = createResult(projectRoot);
		result.findings[0] = { ...result.findings[0], message: `Request used ${secret}` };
		const context = createContext(projectRoot);
		context.sensitiveValues = [secret];

		const output = htmlReporter.format(result, context);

		expect(output).toContain('[redacted]');
		expect(output).not.toContain(secret);
		expect(output).not.toContain('&lt;private&gt;');
	});
});
