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
		expect(() => parseScannerConfigOverrides({ baseLocale: '   ' })).toThrowError(/non-empty string/);
		expect(() => parseScannerConfigOverrides({ baseLocale: 42 })).toThrowError(/non-empty string/);
	});
});
