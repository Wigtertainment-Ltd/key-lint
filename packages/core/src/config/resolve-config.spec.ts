import { describe, expect, it } from 'vitest';

import { resolveScannerConfigSources } from './resolve-config.js';

describe('resolveScannerConfigSources', () => {
	it('applies defaults, package config, config file, and overrides in order', () => {
		const resolved = resolveScannerConfigSources({
			packageJson: {
				keylint: {
					baseLocale: 'de',
					ignoreKeys: ['PACKAGE.**'],
					includeSourceGlobs: ['package/**/*.ts']
				}
			},
			configFile: {
				baseLocale: 'en',
				ignoreKeys: ['FILE.**']
			},
			overrides: {
				ignoreKeys: ['CLI.**']
			}
		});

		expect(resolved.config.baseLocale).toBe('en');
		expect(resolved.config.ignoreKeys).toEqual(['CLI.**']);
		expect(resolved.config.includeSourceGlobs).toEqual(['package/**/*.ts']);
		expect(resolved.packageJsonConfigApplied).toBe(true);
		expect(resolved.configFileApplied).toBe(true);
	});

	it('ignores package.json without a keylint section', () => {
		const resolved = resolveScannerConfigSources({ packageJson: { private: true } });

		expect(resolved.packageJsonConfigApplied).toBe(false);
		expect(resolved.configFileApplied).toBe(false);
		expect(resolved.config.includeSourceGlobs).toContain('**/*.ts');
	});

	it('validates embedded and file configuration through the shared parser', () => {
		expect(() => resolveScannerConfigSources({
			packageJson: { keylint: { unknownOption: true } }
		})).toThrowError(/Unknown configuration key/);
		expect(() => resolveScannerConfigSources({ configFile: { baseLocale: '' } })).toThrowError(
			/non-empty string/
		);
	});

	it('tracks the winning source for each guardrail value', () => {
		const resolved = resolveScannerConfigSources({
			packageJson: { keylint: { guardrails: { maxFiles: 500 } } },
			configFile: { guardrails: { maxFileSizeBytes: 4096 } },
			overrides: { guardrails: { maxFiles: 25 } }
		});

		expect(resolved.config.guardrails).toEqual({
			maxFiles: 25,
			maxFileSizeBytes: 4096
		});
		expect(resolved.guardrailSources).toEqual({
			maxFiles: 'override',
			maxFileSizeBytes: 'config-file'
		});
	});
});
