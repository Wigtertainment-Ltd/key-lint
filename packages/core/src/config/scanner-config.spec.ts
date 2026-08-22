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
			translationSources: [{ type: 'http' }]
		})).toThrowError(/must be "filesystem"/);
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
});
