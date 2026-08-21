import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { NodeFileSystemAdapter } from '../fs/node-file-system.adapter.js';
import { runScan } from './run-scan.js';

interface IFixtureCase {
	name: string;
	fixtureRoot: string;
	expectedFile: string;
}

const FIXTURE_CASES: IFixtureCase[] = [
	{
		name: 'angular ngx-translate kitchen-sink',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/ngx-translate-json/kitchen-sink', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/ngx-translate-json/kitchen-sink/_expected.json', import.meta.url)
		)
	},
	{
		name: 'angular ngx-translate indirect-uncertain',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/ngx-translate-json/indirect-uncertain', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/ngx-translate-json/indirect-uncertain/_expected.json', import.meta.url)
		)
	},
	{
		name: 'angular ngx-translate placeholder contracts',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/ngx-translate-json/placeholders', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/ngx-translate-json/placeholders/_expected.json', import.meta.url)
		)
	},
	{
		name: 'angular transloco json basic',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/transloco-json/basic', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/transloco-json/basic/_expected.json', import.meta.url)
		)
	},
	{
		name: 'angular transloco json pipe support',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/transloco-json/pipe-gap', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/transloco-json/pipe-gap/_expected.json', import.meta.url)
		)
	},
	{
		name: 'angular transloco json structural directive',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/transloco-json/structural-directive', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/transloco-json/structural-directive/_expected.json', import.meta.url)
		)
	},
	{
		name: 'angular i18n xliff basic',
		fixtureRoot: fileURLToPath(
			new URL('../../test/fixtures/angular/angular-i18n-xliff/basic', import.meta.url)
		),
		expectedFile: fileURLToPath(
			new URL('../../test/fixtures/angular/angular-i18n-xliff/basic/_expected.json', import.meta.url)
		)
	}
];

interface IExpectedScan {
	adapterId: string;
	summary: {
		totalKeys: number;
		used: number;
		unused: number;
		dynamicOrUncertain: number;
		indirectUncertain: number;
		missingInLanguage: number;
		extraInLanguage: number;
		placeholderMissing: number;
		placeholderUncertain: number;
		placeholderMismatch: number;
		totalFindings: number;
	};
	findings: Array<{
		key: string;
		status: string;
		severity: string;
	}>;
}

describe('runScan integration fixtures', () => {
	for (const fixtureCase of FIXTURE_CASES) {
		it(`matches the ${fixtureCase.name} golden file`, async () => {
			const expected = JSON.parse(await readFile(fixtureCase.expectedFile, 'utf8')) as IExpectedScan;
			const fs = new NodeFileSystemAdapter();

			const result = await runScan({
				projectRoot: fixtureCase.fixtureRoot,
				fs
			});

			expect(result.adapterId).toBe(expected.adapterId);

			const normalizedFindings = result.findings
				.map((finding) => ({
					key: finding.key,
					status: finding.status,
					severity: finding.severity
				}))
				.sort((a, b) => a.key.localeCompare(b.key) || a.status.localeCompare(b.status));

			const expectedFindings = [...expected.findings].sort(
				(a, b) => a.key.localeCompare(b.key) || a.status.localeCompare(b.status)
			);

			expect(result.summary).toEqual(expected.summary);
			expect(normalizedFindings).toEqual(expectedFindings);
		});
	}
});
