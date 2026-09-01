import { describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { IFileSystemAdapter, IKeyUsage } from '../scan-adapter.interface.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { angularScanAdapter } from './angular-scan.adapter.js';

const matrix: ITranslationMatrix = {
	locales: ['de', 'en'],
	totalKeys: 1,
	rows: [
		{
			key: 'APP.GREETING',
			values: { de: 'Hallo {{name}}', en: 'Hello {{name}} {{count}}' },
			keyPresence: { de: true, en: true },
			placeholders: { de: ['name'], en: ['count', 'name'] }
		}
	]
};

const context = { projectRoot: '/project', config: DEFAULT_SCANNER_CONFIG };

async function run(usedKeys: IKeyUsage[]): ReturnType<typeof angularScanAdapter.runRules> {
	return angularScanAdapter.runRules({
		definedKeys: ['APP.GREETING'],
		usedKeys,
		translationMatrix: matrix,
		baseLocale: 'en',
		baseLocaleSelectionSource: 'exact-en',
		context
	});
}

describe('Angular placeholder contracts', () => {
	it('stores deduplicated placeholders per locale in the translation matrix', async () => {
		const values: Record<string, string> = {
			'/project/en.json': JSON.stringify({ APP: { GREETING: 'Hello {{ name }} {{count}} {{name}}' } }),
			'/project/de.json': JSON.stringify({ APP: { GREETING: 'Hallo {{name}}' } })
		};
		const fs: IFileSystemAdapter = {
			fileExists: async (path) => path in values,
			readFile: async (path) => values[path],
			listFiles: async () => Object.keys(values)
		};
		const built = await angularScanAdapter.buildTranslationMatrix!(['/project/en.json', '/project/de.json'], fs);
		expect(built.rows[0].placeholders).toEqual({ de: ['name'], en: ['count', 'name'] });
	});

	it('emits locale mismatch and one error for each definitely incomplete usage', async () => {
		const findings = await run([
			{ key: 'APP.GREETING', filePath: '/project/a.ts', line: 1, column: 1, placeholderParameters: { kind: 'absent', names: [] } },
			{ key: 'APP.GREETING', filePath: '/project/b.ts', line: 2, column: 3, placeholderParameters: { kind: 'static', names: ['name'] } }
		]);

		expect(findings.filter((finding) => finding.status === 'placeholder-missing')).toHaveLength(2);
		expect(findings).toContainEqual(
			expect.objectContaining({
				status: 'placeholder-mismatch',
				language: 'de',
				severity: 'error'
			})
		);
	});

	it('warns for unresolved parameters, accepts known required names and ignores extras', async () => {
		const findings = await run([
			{ key: 'APP.GREETING', filePath: '/project/a.ts', placeholderParameters: { kind: 'dynamic', names: ['name'] } },
			{ key: 'APP.GREETING', filePath: '/project/b.ts', placeholderParameters: { kind: 'static', names: ['count', 'extra', 'name'] } }
		]);

		expect(findings.filter((finding) => finding.status === 'placeholder-uncertain')).toHaveLength(1);
		expect(findings.filter((finding) => finding.status === 'placeholder-missing')).toHaveLength(0);
	});

	it('treats unresolved nested parameter paths as uncertain', async () => {
		const nestedMatrix: ITranslationMatrix = {
			locales: ['en'],
			totalKeys: 1,
			rows: [{ key: 'APP.USER', values: { en: '{{user.name}}' }, keyPresence: { en: true }, placeholders: { en: ['user.name'] } }]
		};
		const findings = await angularScanAdapter.runRules({
			definedKeys: ['APP.USER'],
			usedKeys: [{ key: 'APP.USER', filePath: '/project/a.ts', placeholderParameters: { kind: 'static', names: ['user'], dynamicPrefixes: ['user'] } }],
			translationMatrix: nestedMatrix,
			baseLocale: 'en',
			baseLocaleSelectionSource: 'exact-en',
			context
		});
		expect(findings).toContainEqual(expect.objectContaining({ status: 'placeholder-uncertain' }));
	});

	it('extracts placeholder parameters from methods, pipes, directives and structural calls', async () => {
		const templateSource = [
			"{{ 'APP.GREETING' | translate: { name: user.name, count } }}",
			'<p [title]="\'APP.GREETING\' | transloco: { name, count }"></p>',
			'<div translate="APP.GREETING" [translateParams]="{ name, count }"></div>',
			'<ng-container *transloco="let t">{{ t(\'APP.GREETING\', { name, count }) }}</ng-container>'
		].join('\n');
		const fs: IFileSystemAdapter = {
			fileExists: async () => true,
			readFile: async (path) => (path.endsWith('.ts') ? "this.translateService.instant('APP.GREETING', { name, count: total });" : templateSource),
			listFiles: async () => ['/project/app.component.html', '/project/app.component.ts']
		};

		const usages = await angularScanAdapter.extractUsedKeys(context, fs);
		const greetingUsages = usages.filter((usage) => usage.key === 'APP.GREETING' && !usage.isDynamic);
		expect(greetingUsages).toHaveLength(5);
		expect(greetingUsages.map((usage) => usage.matchType)).toEqual(
			expect.arrayContaining([
				'html-pipe-translate-interpolation',
				'html-pipe-translate-binding',
				'html-attribute-translate',
				'html-transloco-structural-call',
				'ts-translate-method'
			])
		);
		expect(greetingUsages.every((usage) => usage.placeholderParameters?.kind === 'static')).toBe(true);
		expect(greetingUsages.every((usage) => usage.placeholderParameters?.names.includes('name'))).toBe(true);
		expect(greetingUsages.every((usage) => usage.placeholderParameters?.names.includes('count'))).toBe(true);
	});
});
