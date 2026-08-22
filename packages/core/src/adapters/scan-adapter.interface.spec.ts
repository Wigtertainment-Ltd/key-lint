import { describe, expect, it } from 'vitest';

import { IScanAdapter } from './scan-adapter.interface.js';

describe('scan adapter compatibility', () => {
	it('accepts a legacy path-based adapter without resource-aware methods', () => {
		const adapter: IScanAdapter = {
			id: 'legacy-test',
			framework: 'test',
			capabilities: {
				templateParsing: false,
				typescriptParsing: false,
				translationFormats: ['json']
			},
			detect: async () => ({ supported: true, confidence: 1 }),
			collectTranslationFiles: async () => [],
			extractDefinedKeys: async () => [],
			extractUsedKeys: async () => [],
			runRules: async () => []
		};

		expect(adapter.collectTranslationResources).toBeUndefined();
		expect(adapter.extractDefinedKeysFromResources).toBeUndefined();
	});
});
