import { describe, expect, it } from 'vitest';

import { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import { DEFAULT_SCANNER_CONFIG } from '../config/scanner-defaults.js';
import {
	analyzeProjectTranslationLoaders, AutoHttpResolutionError, expandAutoHttpTranslationSources, IAutoHttpProjectAnalysis, redactAutoHttpUrlTemplate
} from './auto-http-translation-source.js';

function memoryFs(files: Record<string, string>): IFileSystemAdapter {
	return {
		fileExists: async (filePath) => filePath in files,
		readFile: async (filePath) => files[filePath],
		listFiles: async () => Object.keys(files)
	};
}

describe('auto-http translation source integration', () => {
	it('runs both static detectors without executing project code', async () => {
		const files = {
			'/project/ngx.ts': `
				import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
				const AVAILABLE_LANGS = ['en'];
				provideTranslateHttpLoader({ prefix: '/ngx/' });
				throw new Error('never execute');`,
			'/project/transloco.ts': `
				import { HttpClient } from '@angular/common/http';
				import { provideTransloco } from '@jsverse/transloco';
				class Loader {
					constructor(private http: HttpClient) {}
					getTranslation(lang: string) { return this.http.get(\`https://cdn.example/\${lang}.json\`); }
				}
				provideTransloco({ availableLangs: ['de'], loader: Loader });`
		};

		const result = await analyzeProjectTranslationLoaders('/project', memoryFs(files), DEFAULT_SCANNER_CONFIG);

		expect(result.candidates.map((candidate) => candidate.framework)).toEqual(['ngx-translate', 'transloco']);
		expect(result.candidates.map((candidate) => candidate.locales)).toEqual([['en'], ['en', 'de']]);
		expect(result.diagnostics).toEqual([]);
	});

	it('expands resources at the configured position and preserves detected order', () => {
		const analysis: IAutoHttpProjectAnalysis = {
			sourceFiles: [],
			diagnostics: [],
			candidates: [{
				framework: 'ngx-translate', loader: 'http', api: 'provideTranslateHttpLoader', confidence: 'deterministic',
				locales: ['en'],
				resources: [
					{ urlTemplate: '/common/{locale}.json', urlKind: 'relative', requiresOrigin: true },
					{ urlTemplate: 'https://cdn.example/app/{locale}.json', urlKind: 'absolute', requiresOrigin: false }
				],
				location: { filePath: 'src/app.config.ts', line: 4, column: 2, endLine: 4, endColumn: 20 }
			}]
		};

		const result = expandAutoHttpTranslationSources([
			{ type: 'filesystem', id: 'base' },
			{ type: 'auto-http', id: 'detected', origin: 'https://app.example', locales: ['de', 'fr'], headersFromEnv: { Authorization: 'KEYLINT_AUTH' } },
			{ type: 'filesystem', id: 'overrides' }
		], analysis);

		expect(result.translationSources).toEqual([
			{ type: 'filesystem', id: 'base' },
			{ type: 'http', id: 'detected-1', urlTemplate: 'https://app.example/common/{locale}.json', locales: ['de', 'fr'], headersFromEnv: { Authorization: 'KEYLINT_AUTH' } },
			{ type: 'http', id: 'detected-2', urlTemplate: 'https://cdn.example/app/{locale}.json', locales: ['de', 'fr'], headersFromEnv: { Authorization: 'KEYLINT_AUTH' } },
			{ type: 'filesystem', id: 'overrides' }
		]);
	});

	it('refuses zero, multiple, missing-origin, and missing-locale candidates before scanning', () => {
		const source = [{ type: 'auto-http' as const }];
		const candidate = {
			framework: 'transloco' as const, loader: 'http' as const, api: 'TranslocoLoader' as const, confidence: 'deterministic' as const,
			locales: ['en'], resources: [{ urlTemplate: '/i18n/{locale}.json', urlKind: 'relative' as const, requiresOrigin: true }],
			location: { filePath: 'loader.ts', line: 1, column: 1, endLine: 1, endColumn: 2 }
		};
		const empty: IAutoHttpProjectAnalysis = { candidates: [], diagnostics: [], sourceFiles: [] };
		expect(() => expandAutoHttpTranslationSources(source, empty)).toThrowError(AutoHttpResolutionError);
		const multiple = { ...empty, candidates: [candidate, { ...candidate, framework: 'ngx-translate' as const }] };
		expect(() => expandAutoHttpTranslationSources(source, multiple)).toThrowError(/Multiple compatible/);
		expect(() => expandAutoHttpTranslationSources(source, { ...empty, candidates: [candidate] })).toThrowError(/requires an origin/);
		const noLocales = { ...candidate, locales: [], resources: [{ ...candidate.resources[0], requiresOrigin: false, urlKind: 'absolute' as const, urlTemplate: 'https://example/{locale}.json' }] };
		expect(() => expandAutoHttpTranslationSources(source, { ...empty, candidates: [noLocales] })).toThrowError(/no static locales/);
	});

	it('redacts query values from candidate and endpoint summaries', () => {
		const displayed = redactAutoHttpUrlTemplate('https://example.com/{locale}.json?api_key=secret#fragment');

		expect(displayed).toContain('?[redacted]');
		expect(displayed).not.toContain('secret');
		expect(displayed).not.toContain('fragment');
	});
});
