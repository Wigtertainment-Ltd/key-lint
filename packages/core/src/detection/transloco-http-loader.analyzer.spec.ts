import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { analyzeTranslocoHttpLoaders } from './transloco-http-loader.analyzer.js';
import { ITranslationLoaderAnalysisResult, ILoaderDetectionDiagnostic } from '../detection.js';

const fixtureRoot: URL = new URL('../../test/fixtures/detection/transloco-http-loader/', import.meta.url);

function fixture(name: string): { filePath: string; content: string } {
	return {
		filePath: `src/app/${name}`,
		content: readFileSync(new URL(name, fixtureRoot), 'utf8')
	};
}

describe('analyzeTranslocoHttpLoaders', (): void => {
	it('resolves an aliased modern provider and an imported loader class', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('app.config.ts'), fixture('transloco-loader.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]).toMatchObject({
			framework: 'transloco',
			loader: 'http',
			api: 'TranslocoLoader',
			confidence: 'deterministic',
			locales: ['en', 'de'],
			resources: [{
				urlTemplate: 'https://cdn.example.com/i18n/{locale}.json',
				urlKind: 'absolute',
				requiresOrigin: false
			}]
		});
		expect(result.candidates[0].location).toEqual({
			filePath: 'src/app/transloco-loader.ts', line: 7, column: 2, endLine: 9, endColumn: 3
		});
	});

	it('supports inject(HttpClient), constants, concatenation and relative URLs', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('inject-loader.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates[0].resources).toEqual([
			{ urlTemplate: '/assets/i18n/{locale}.json', urlKind: 'relative', requiresOrigin: true }
		]);
	});

	it('supports the legacy package and TRANSLOCO_LOADER provider', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('legacy-provider.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates[0].resources[0].urlTemplate).toBe('/legacy/{locale}.lang.json');
	});

	it('preserves explicitly declared request and object-spread merge order', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('multi-request.ts')]);

		expect(result.diagnostics).toEqual([]);
		expect(result.candidates[0].resources).toEqual([
			{ urlTemplate: '/common/{locale}.json', urlKind: 'relative', requiresOrigin: true },
			{ urlTemplate: 'https://cdn.example.com/app/{locale}.json', urlKind: 'absolute', requiresOrigin: false }
		]);
	});

	it('diagnoses runtime-dependent URLs without guessing endpoints', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('dynamic.ts')]);

		expect(result.candidates).toEqual([]);
		expect(new Set(result.diagnostics.map((diagnostic: ILoaderDetectionDiagnostic): ILoaderDetectionDiagnostic['code'] => diagnostic.code))).toEqual(new Set([
			'transloco-http-dynamic-environment',
			'transloco-http-conditional-url'
		]));
		expect(JSON.stringify(result)).not.toContain('/de/');
	});

	it('rejects multiple HTTP requests when order and merge behavior are not explicit', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('ambiguous-merge.ts')]);

		expect(result.candidates).toEqual([]);
		expect(result.diagnostics.map((diagnostic: ILoaderDetectionDiagnostic): ILoaderDetectionDiagnostic['code'] => diagnostic.code)).toEqual(['transloco-http-ambiguous-merge']);
	});

	it('diagnoses scopes and interceptors and suppresses unsafe candidates', (): void => {
		const result: ITranslationLoaderAnalysisResult = analyzeTranslocoHttpLoaders([fixture('guards.ts')]);

		expect(result.candidates).toEqual([]);
		expect(new Set(result.diagnostics.map((diagnostic: ILoaderDetectionDiagnostic): ILoaderDetectionDiagnostic['code'] => diagnostic.code))).toEqual(new Set([
			'transloco-http-unsupported-scope',
			'transloco-http-interceptor'
		]));
		expect(result.diagnostics).toHaveLength(4);
	});

	it('requires symbols from supported framework and Angular modules', (): void => {
		expect(analyzeTranslocoHttpLoaders([fixture('unrelated.ts')])).toEqual({ candidates: [], diagnostics: [] });
	});

	it('parses source without importing or executing project modules', (): void => {
		expect((): ITranslationLoaderAnalysisResult => analyzeTranslocoHttpLoaders([fixture('no-execution.ts')])).not.toThrow();
		expect(analyzeTranslocoHttpLoaders([fixture('no-execution.ts')]).candidates[0].resources[0].urlTemplate)
			.toBe('/safe/{locale}.json');
	});
});
