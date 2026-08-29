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
				evidence: [{
					filePath: join(projectRoot, 'src', 'app', 'app.component.html'),
					line: 7,
					column: 4,
					snippet: 'PRIVATE SOURCE SNIPPET'
				}]
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
	it('renders a standalone failed report with every finding and summary metric', () => {
		const projectRoot = resolve('fixtures', 'private-project');
		const output = htmlReporter.format(createResult(projectRoot), createContext(projectRoot));

		expect(output).toContain('<!doctype html>');
		expect(output).toContain('Content-Security-Policy');
		expect(output).toContain('<span class="status">failed</span>');
		expect(output).toContain('Translation keys');
		expect(output).toContain('Total findings');
		expect(output).toContain('Findings (3)');
		expect(output).toContain('<table class="findings-table">');
		expect(output).toContain('<col class="col-key">');
		expect(output).toContain('APP.&lt;unsafe&gt;');
		expect(output).toContain('src/app/app.component.html:7:4');
		expect(output).toContain('external/outside.ts:2');
		expect(output).toContain('keylint.config.json');
		expect(output).toContain('warnings unlimited');
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
		expect(output).toContain('<td colspan="6" class="empty">No findings.</td>');
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
