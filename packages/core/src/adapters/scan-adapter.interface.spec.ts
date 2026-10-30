import { describe, expect, it } from 'vitest';

import { IScanAdapter } from './scan-adapter.interface.js';

describe('scan adapter compatibility', (): void => {
	it('accepts a legacy path-based adapter without resource-aware methods', (): void => {
		const adapter: IScanAdapter = {
			id: 'legacy-test',
			framework: 'test',
			capabilities: {
				templateParsing: false,
				typescriptParsing: false,
				translationFormats: ['json']
			},
			detect: (): Promise<{ supported: true; confidence: number; }> => Promise.resolve({ supported: true, confidence: 1 }),
			collectTranslationFiles: (): Promise<never[]> => Promise.resolve([]),
			extractDefinedKeys: (): Promise<never[]> => Promise.resolve([]),
			extractUsedKeys: (): Promise<never[]> => Promise.resolve([]),
			runRules: (): Promise<never[]> => Promise.resolve([])
		};

		expect('collectTranslationResources' in adapter).toBe(false);
		expect('extractDefinedKeysFromResources' in adapter).toBe(false);
	});
});
