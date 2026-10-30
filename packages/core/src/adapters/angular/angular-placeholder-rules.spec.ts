import { describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { IFileSystemAdapter, IKeyUsage } from '../scan-adapter.interface.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { angularScanAdapter } from './angular-scan.adapter.js';
import { IScannerConfig } from '../../config/config.interfaces.js';
import { IFinding } from '../../models/finding.model.js';

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

const context: { projectRoot: string; config: IScannerConfig; } = { projectRoot: '/project', config: DEFAULT_SCANNER_CONFIG };

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

describe('Angular placeholder contracts', (): void => {
	it('stores deduplicated placeholders per locale in the translation matrix', async (): Promise<void> => {
		const values: Record<string, string> = {
			'/project/en.json': JSON.stringify({ APP: { GREETING: 'Hello {{ name }} {{count}} {{name}}' } }),
			'/project/de.json': JSON.stringify({ APP: { GREETING: 'Hallo {{name}}' } })
		};
		const fs: IFileSystemAdapter = {
			fileExists: (path: string): Promise<boolean> => Promise.resolve(path in values),
			readFile: (path: string): Promise<string> => Promise.resolve(values[path]),
			listFiles: (): Promise<string[]> => Promise.resolve(Object.keys(values))
		};
		const built: ITranslationMatrix = await angularScanAdapter.buildTranslationMatrix!(['/project/en.json', '/project/de.json'], fs);
		expect(built.rows[0].placeholders).toEqual({ de: ['name'], en: ['count', 'name'] });
	});

	it('emits locale mismatch and one error for each definitely incomplete usage', async (): Promise<void> => {
		const findings: IFinding[] = await run([
			{ key: 'APP.GREETING', filePath: '/project/a.ts', line: 1, column: 1, placeholderParameters: { kind: 'absent', names: [] } },
			{ key: 'APP.GREETING', filePath: '/project/b.ts', line: 2, column: 3, placeholderParameters: { kind: 'static', names: ['name'] } }
		]);

		expect(findings.filter((finding: IFinding): boolean => finding.status === 'placeholder-missing')).toHaveLength(2);
		expect(findings).toContainEqual(
			expect.objectContaining({
				status: 'placeholder-mismatch',
				language: 'de',
				severity: 'error'
			})
		);
	});

	it('warns for unresolved parameters, accepts known required names and ignores extras', async (): Promise<void> => {
		const findings: IFinding[] = await run([
			{ key: 'APP.GREETING', filePath: '/project/a.ts', placeholderParameters: { kind: 'dynamic', names: ['name'] } },
			{ key: 'APP.GREETING', filePath: '/project/b.ts', placeholderParameters: { kind: 'static', names: ['count', 'extra', 'name'] } }
		]);

		expect(findings.filter((finding: IFinding): boolean => finding.status === 'placeholder-uncertain')).toHaveLength(1);
		expect(findings.filter((finding: IFinding): boolean => finding.status === 'placeholder-missing')).toHaveLength(0);
	});

	it('treats unresolved nested parameter paths as uncertain', async (): Promise<void> => {
		const nestedMatrix: ITranslationMatrix = {
			locales: ['en'],
			totalKeys: 1,
			rows: [{ key: 'APP.USER', values: { en: '{{user.name}}' }, keyPresence: { en: true }, placeholders: { en: ['user.name'] } }]
		};
		const findings: IFinding[] = await angularScanAdapter.runRules({
			definedKeys: ['APP.USER'],
			usedKeys: [{ key: 'APP.USER', filePath: '/project/a.ts', placeholderParameters: { kind: 'static', names: ['user'], dynamicPrefixes: ['user'] } }],
			translationMatrix: nestedMatrix,
			baseLocale: 'en',
			baseLocaleSelectionSource: 'exact-en',
			context
		});
		expect(findings).toContainEqual(expect.objectContaining({ status: 'placeholder-uncertain' }));
	});

	it('extracts placeholder parameters from methods, pipes, directives and structural calls', async (): Promise<void> => {
		const templateSource: string = [
			"{{ 'APP.GREETING' | translate: { name: user.name, count } }}",
			'<p [title]="\'APP.GREETING\' | transloco: { name, count }"></p>',
			'<div translate="APP.GREETING" [translateParams]="{ name, count }"></div>',
			'<ng-container *transloco="let t">{{ t(\'APP.GREETING\', { name, count }) }}</ng-container>'
		].join('\n');
		const fs: IFileSystemAdapter = {
			fileExists: (): Promise<boolean> => Promise.resolve(true),
			readFile: (path: string): Promise<string> => Promise.resolve(path.endsWith('.ts') ? "this.translateService.instant('APP.GREETING', { name, count: total });" : templateSource),
			listFiles: (): Promise<string[]> => Promise.resolve(['/project/app.component.html', '/project/app.component.ts'])
		};

		const usages: IKeyUsage[] = await angularScanAdapter.extractUsedKeys(context, fs);
		const greetingUsages: IKeyUsage[] = usages.filter((usage: IKeyUsage): boolean => usage.key === 'APP.GREETING' && !usage.isDynamic);
		expect(greetingUsages).toHaveLength(5);
		expect(greetingUsages.map((usage: IKeyUsage): string | undefined => usage.matchType)).toEqual(
			expect.arrayContaining([
				'html-pipe-translate-interpolation',
				'html-pipe-translate-binding',
				'html-attribute-translate',
				'html-transloco-structural-call',
				'ts-translate-method'
			])
		);
		expect(greetingUsages.every((usage: IKeyUsage): boolean => usage.placeholderParameters?.kind === 'static')).toBe(true);
		expect(greetingUsages.every((usage: IKeyUsage): boolean | undefined => usage.placeholderParameters?.names.includes('name'))).toBe(true);
		expect(greetingUsages.every((usage: IKeyUsage): boolean | undefined => usage.placeholderParameters?.names.includes('count'))).toBe(true);
	});
});
