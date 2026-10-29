import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { NodeFileSystemAdapter } from '../fs/node-file-system.adapter.js';
import { normalizePath } from '../util/path.util.js';
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
	},
	{
		name: 'react react-i18next json basic',
		fixtureRoot: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/basic', import.meta.url)),
		expectedFile: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/basic/_expected.json', import.meta.url))
	},
	{
		name: 'react react-i18next namespaces and keyPrefix',
		fixtureRoot: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/namespaces', import.meta.url)),
		expectedFile: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/namespaces/_expected.json', import.meta.url))
	},
	{
		name: 'react react-i18next configured default namespace',
		fixtureRoot: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/default-namespace', import.meta.url)),
		expectedFile: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/default-namespace/_expected.json', import.meta.url))
	},
	{
		name: 'react react-i18next Trans and placeholder contracts',
		fixtureRoot: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/trans-placeholders', import.meta.url)),
		expectedFile: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/trans-placeholders/_expected.json', import.meta.url))
	},
	{
		name: 'react react-i18next plural forms and dynamic keys',
		fixtureRoot: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/plurals-dynamic', import.meta.url)),
		expectedFile: fileURLToPath(new URL('../../test/fixtures/react/react-i18next-json/plurals-dynamic/_expected.json', import.meta.url))
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
	findings: {
		key: string;
		status: string;
		severity: string;
	}[];
}

describe('runScan integration fixtures', () => {
	for (const fixtureCase of FIXTURE_CASES) {
		it(`matches the ${fixtureCase.name} golden file`, async () => {
			const expected = JSON.parse(await readFile(fixtureCase.expectedFile, 'utf8')) as IExpectedScan;
			const fs = new NodeFileSystemAdapter();
			const fixtureRoot = normalizePath(fixtureCase.fixtureRoot);
			const fileExists = fs.fileExists.bind(fs);

			// Keep ancestor detection from selecting the enclosing KeyLint repository.
			vi.spyOn(fs, 'fileExists').mockImplementation((filePath): Promise<boolean> => {
				const normalizedPath = normalizePath(filePath);
				return normalizedPath === fixtureRoot || normalizedPath.startsWith(`${fixtureRoot}/`) ? fileExists(filePath) : Promise.resolve(false);
			});

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
			expect(result.metadata).toMatchObject({
				translationSourceCount: 1,
				localTranslationSourceCount: 1,
				remoteTranslationSourceCount: 0,
				remoteRequestCount: 0,
				detectedLoaderTypes: [],
				translationReadOnly: false
			});
		});
	}
});
