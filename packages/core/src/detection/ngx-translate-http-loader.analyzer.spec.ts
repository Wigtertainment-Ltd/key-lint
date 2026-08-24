import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { analyzeNgxTranslateHttpLoaders } from './ngx-translate-http-loader.analyzer.js';

const fixtureRoot = new URL('../../test/fixtures/detection/ngx-translate-http-loader/', import.meta.url);

function fixture(name: string): { filePath: string; content: string } {
	return {
		filePath: `src/app/${name}`,
		content: readFileSync(new URL(name, fixtureRoot), 'utf8')
	};
}

describe('analyzeNgxTranslateHttpLoaders', () => {
	it('detects modern default and explicit literal loader configuration', () => {
		const result = analyzeNgxTranslateHttpLoaders([
			fixture('modern-default.ts'),
			fixture('modern-explicit.ts')
		]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates.map((candidate) => candidate.resources[0])).toEqual([
			{ urlTemplate: '/assets/i18n/{locale}.json', urlKind: 'relative', requiresOrigin: true },
			{ urlTemplate: 'https://cdn.example.com/i18n/{locale}.translations.json', urlKind: 'absolute', requiresOrigin: false }
		]);
		expect(result.candidates.map((candidate) => candidate.api)).toEqual([
			'provideTranslateHttpLoader',
			'provideTranslateHttpLoader'
		]);
	});

	it('preserves ordered string and object resource templates', () => {
		const result = analyzeNgxTranslateHttpLoaders([fixture('multi-resources.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0].resources).toEqual([
			{ urlTemplate: '/assets/shared/{locale}.json', urlKind: 'relative', requiresOrigin: true },
			{ urlTemplate: 'https://cdn.example.com/features/{locale}.lang.json', urlKind: 'absolute', requiresOrigin: false },
			{ urlTemplate: '/assets/overrides/{locale}.json', urlKind: 'relative', requiresOrigin: true }
		]);
	});

	it('detects aliased legacy factories with literal constructor arguments', () => {
		const result = analyzeNgxTranslateHttpLoaders([
			fixture('legacy-factory.ts'),
			fixture('legacy-default.ts')
		]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates).toHaveLength(2);
		expect(result.candidates[0]).toMatchObject({
			framework: 'ngx-translate',
			loader: 'http',
			api: 'TranslateHttpLoader',
			confidence: 'deterministic',
			resources: [{ urlTemplate: '/legacy/i18n/{locale}.lang.json', urlKind: 'relative', requiresOrigin: true }]
		});
		expect(result.candidates[1].resources).toEqual([
			{ urlTemplate: '/assets/i18n/{locale}.json', urlKind: 'relative', requiresOrigin: true }
		]);
	});

	it('resolves the nearest unambiguous lexical alias', () => {
		const result = analyzeNgxTranslateHttpLoaders([fixture('scoped-aliases.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates[0].resources[0].urlTemplate).toBe('/inside/{locale}.json');
	});

	it('resolves supported aliases and direct literal locale arrays', () => {
		const result = analyzeNgxTranslateHttpLoaders([fixture('aliases-locales.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates[0].locales).toEqual(['en', 'de', 'fr', 'it']);
		expect(result.candidates[0].resources[0].urlTemplate).toBe('/locale/{locale}.json');
	});

	it('requires imports from ngx-translate instead of matching symbol names', () => {
		const result = analyzeNgxTranslateHttpLoaders([fixture('unrelated-symbols.ts')]);

		expect(result).toEqual({ candidates: [], diagnostics: [] });
	});

	it('returns actionable diagnostics and no guessed endpoint for dynamic constructs', () => {
		const result = analyzeNgxTranslateHttpLoaders([fixture('dynamic-patterns.ts')]);

		expect(result.candidates).toEqual([]);
		expect(new Set(result.diagnostics.map((diagnostic) => diagnostic.code))).toEqual(new Set([
			'ngx-http-dynamic-environment',
			'ngx-http-conditional-url',
			'ngx-http-ambiguous-merge',
			'ngx-http-unsupported-transformation',
			'ngx-http-unsupported-factory'
		]));
		expect(result.diagnostics).toHaveLength(6);
		expect(result.diagnostics.every((diagnostic) => diagnostic.location.filePath === 'src/app/dynamic-patterns.ts')).toBe(true);
		expect(JSON.stringify(result)).not.toContain('/prod/');
		expect(JSON.stringify(result)).not.toContain('/first/');
	});

	it('keeps candidate source locations and input ordering stable', () => {
		const result = analyzeNgxTranslateHttpLoaders([
			fixture('modern-explicit.ts'),
			fixture('modern-default.ts')
		]);

		expect(result.candidates.map((candidate) => candidate.location)).toEqual([
			{ filePath: 'src/app/modern-explicit.ts', line: 6, column: 23, endLine: 6, endColumn: 69 },
			{ filePath: 'src/app/modern-default.ts', line: 3, column: 23, endLine: 3, endColumn: 51 }
		]);
	});

	it('parses source text without importing or executing the project module', () => {
		expect(() => analyzeNgxTranslateHttpLoaders([fixture('no-execution.ts')])).not.toThrow();
		const result = analyzeNgxTranslateHttpLoaders([fixture('no-execution.ts')]);
		expect(result.candidates[0].resources[0].urlTemplate).toBe('/safe-static-analysis/{locale}.json');
	});
});
