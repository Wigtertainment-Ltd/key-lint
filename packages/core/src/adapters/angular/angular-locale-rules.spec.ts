import { describe, expect, it } from 'vitest';

import { DEFAULT_SCANNER_CONFIG } from '../../config/scanner-defaults.js';
import { ITranslationMatrix, ITranslationMatrixRow } from '../../models/scan-result.model.js';
import { angularScanAdapter } from './angular-scan.adapter.js';
import { IFinding } from '../../models/finding.model.js';

const translationMatrix: ITranslationMatrix = {
	locales: ['de', 'en'],
	totalKeys: 4,
	rows: [
		{
			key: 'APP.EMPTY',
			values: { de: '', en: '' },
			keyPresence: { de: true, en: true }
		},
		{
			key: 'APP.EXTRA',
			values: { de: 'Extra', en: '' },
			keyPresence: { de: true, en: false }
		},
		{
			key: 'APP.MISSING_DE',
			values: { de: '', en: 'English' },
			keyPresence: { de: false, en: true }
		},
		{
			key: 'APP.UNUSED_EXTRA',
			values: { de: 'Unused extra', en: '' },
			keyPresence: { de: true, en: false }
		}
	]
};

describe('angular locale consistency rules', (): void => {
	it('emits missing and extra findings per locale while treating empty values as present', async (): Promise<void> => {
		const findings: IFinding[] = await angularScanAdapter.runRules({
			definedKeys: translationMatrix.rows.map((row: ITranslationMatrixRow): string => row.key),
			usedKeys: [],
			translationMatrix,
			baseLocale: 'en',
			baseLocaleSelectionSource: 'exact-en',
			context: { projectRoot: '/project', config: DEFAULT_SCANNER_CONFIG }
		});

		expect(findings).toContainEqual(expect.objectContaining({
			id: 'missing:APP.MISSING_DE:de',
			status: 'missing-in-language',
			language: 'de',
			severity: 'error'
		}));
		expect(findings).toContainEqual(expect.objectContaining({
			id: 'extra:APP.EXTRA:de',
			status: 'extra-in-language',
			language: 'de',
			severity: 'warning'
		}));
		expect(findings.some((finding: IFinding): boolean => finding.key === 'APP.EMPTY' && finding.status === 'missing-in-language')).toBe(false);
		expect(findings).toContainEqual(expect.objectContaining({ key: 'APP.UNUSED_EXTRA', status: 'unused' }));
		expect(findings).toContainEqual(expect.objectContaining({ key: 'APP.UNUSED_EXTRA', status: 'extra-in-language' }));
	});

	it('emits one finding per locale when a statically used key is absent everywhere', async (): Promise<void> => {
		const findings: IFinding[] = await angularScanAdapter.runRules({
			definedKeys: translationMatrix.rows.map((row: ITranslationMatrixRow): string => row.key),
			usedKeys: [{ key: 'APP.NOWHERE', filePath: '/project/app.ts', isDynamic: false }],
			translationMatrix,
			baseLocale: 'en',
			baseLocaleSelectionSource: 'exact-en',
			context: { projectRoot: '/project', config: DEFAULT_SCANNER_CONFIG }
		});

		const missing: IFinding[] = findings.filter((finding: IFinding): boolean => finding.key === 'APP.NOWHERE');
		expect(missing.map((finding: IFinding): string | undefined => finding.language)).toEqual(['de', 'en']);
		expect(missing.every((finding: IFinding): boolean => finding.status === 'missing-in-language')).toBe(true);
	});
});
