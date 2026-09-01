import { describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from './scanner-defaults.js';
import { mergeScannerConfig, parseScannerConfigOverrides } from './scanner-config.js';

describe('scanner baseLocale config', () => {
	it('parses, trims, and merges baseLocale', () => {
		const overrides = parseScannerConfigOverrides({ baseLocale: ' en-GB ' });
		const config = mergeScannerConfig(DEFAULT_SCANNER_CONFIG, overrides);

		expect(config.baseLocale).toBe('en-GB');
	});

	it('rejects empty and non-string baseLocale values', () => {
		// Match the stable validation phrase shared by both invalid base-locale inputs.
		expect(() => parseScannerConfigOverrides({ baseLocale: '   ' })).toThrowError(/non-empty string/);
		// Match the same stable phrase without coupling the test to the full error message.
		expect(() => parseScannerConfigOverrides({ baseLocale: 42 })).toThrowError(/non-empty string/);
	});
});

describe('translationSources config', () => {
	it('defaults to one implicit filesystem source', () => {
		expect(DEFAULT_SCANNER_CONFIG.translationSources).toEqual([{ type: 'filesystem' }]);
	});

	it('validates auto-http sources without requiring values that may be detected', () => {
		const overrides = parseScannerConfigOverrides({
			translationSources: [{
				type: 'auto-http',
				origin: 'https://app.example.com',
				locales: ['de', 'en'],
				headersFromEnv: { Authorization: 'KEYLINT_TRANSLATION_AUTH' }
			}]
		});

		expect(overrides.translationSources).toEqual([{
			type: 'auto-http',
			origin: 'https://app.example.com',
			locales: ['de', 'en'],
			headersFromEnv: { Authorization: 'KEYLINT_TRANSLATION_AUTH' }
		}]);
		expect(() => parseScannerConfigOverrides({
			translationSources: [{ type: 'auto-http', origin: 'https://example.com/path' }]
		})).toThrowError(/without credentials, path, query, or fragment/);
		expect(() => parseScannerConfigOverrides({
			translationSources: [{ type: 'auto-http', locales: [] }]
		})).toThrowError(/at least one valid/);
	});

	it('parses ordered filesystem sources and trims identifiers', () => {
		const overrides = parseScannerConfigOverrides({
			translationSources: [
				{ type: 'filesystem', id: ' base ', includeGlobs: [' src/base/**/*.json '] },
				{ type: 'filesystem', id: 'feature' }
			]
		});

		expect(overrides.translationSources).toEqual([
			{ type: 'filesystem', id: 'base', includeGlobs: ['src/base/**/*.json'] },
			{ type: 'filesystem', id: 'feature' }
		]);
	});

	it('rejects empty, unsupported, duplicate, and misspelled sources', () => {
		expect(() => parseScannerConfigOverrides({ translationSources: [] })).toThrowError(/non-empty array/);
		expect(() => parseScannerConfigOverrides({
			translationSources: [{ type: 'ftp' }]
		})).toThrowError(/must be "filesystem", "http", or "auto-http"/);
		expect(() => parseScannerConfigOverrides({
			translationSources: [
				{ type: 'filesystem', id: 'same' },
				{ type: 'filesystem', id: 'same' }
			]
		})).toThrowError(/Duplicate translation source id/);
		expect(() => parseScannerConfigOverrides({
			translationSources: [{ type: 'filesystem', typo: true }]
		})).toThrowError(/Unknown translation source key/);
		expect(() => parseScannerConfigOverrides({
			translationSources: [{ type: 'filesystem', includeGlobs: [] }]
		})).toThrowError(/at least one non-empty glob/);
	});

	it('parses validated HTTP sources without accepting direct header values', () => {
		const overrides = parseScannerConfigOverrides({
			translationSources: [{
				type: 'http',
				id: ' feature-api ',
				urlTemplate: 'https://api.example.com/i18n/{locale}.json',
				locales: ['de', 'en-US'],
				headersFromEnv: { Authorization: ' KEYLINT_TRANSLATION_AUTH ' }
			}]
		});

		expect(overrides.translationSources).toEqual([{
			type: 'http',
			id: 'feature-api',
			urlTemplate: 'https://api.example.com/i18n/{locale}.json',
			locales: ['de', 'en-US'],
			headersFromEnv: { Authorization: 'KEYLINT_TRANSLATION_AUTH' }
		}]);
		expect(() => parseScannerConfigOverrides({
			translationSources: [{
				type: 'http', id: 'api', urlTemplate: 'https://example.com/{locale}.json',
				locales: ['en'], headers: { Authorization: 'secret' }
			}]
		})).toThrowError(/Unknown HTTP translation source key "headers"/);
	});

	it('rejects unsafe or ambiguous HTTP source configuration', () => {
		const source = (overrides: Record<string, unknown>): Record<string, unknown> => ({
			type: 'http',
			id: 'api',
			urlTemplate: 'https://example.com/{locale}.json',
			locales: ['en'],
			...overrides
		});

		expect(() => parseScannerConfigOverrides({ translationSources: [source({ id: '' })] }))
			.toThrowError(/non-empty string/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ urlTemplate: 'file:///tmp/{locale}.json' })] }))
			.toThrowError(/HTTP or HTTPS/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ urlTemplate: 'https://user:pass@example.com/{locale}.json' })] }))
			.toThrowError(/must not contain URL credentials/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ urlTemplate: 'https://example.com/static.json' })] }))
			.toThrowError(/exactly one/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ locales: [] })] }))
			.toThrowError(/at least one/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ locales: ['en', 'en'] })] }))
			.toThrowError(/duplicates/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ headersFromEnv: { 'Bad Header': 'TOKEN' } })] }))
			.toThrowError(/Invalid HTTP header name/);
		expect(() => parseScannerConfigOverrides({ translationSources: [source({ headersFromEnv: { Authorization: '' } })] }))
			.toThrowError(/non-empty string/);
	});

	it('requires unique identifiers across filesystem and HTTP sources', () => {
		expect(() => parseScannerConfigOverrides({
			translationSources: [
				{ type: 'filesystem', id: 'shared' },
				{ type: 'http', id: 'shared', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'] }
			]
		})).toThrowError(/Duplicate translation source id/);
	});
});
