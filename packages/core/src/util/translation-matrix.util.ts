import { ScannerConfigError } from '../config/config.interfaces.js';
import { ITranslationMatrix, ITranslationMatrixRow } from '../models/scan-result.model.js';

export type BaseLocaleSelectionSource =
	| 'configured'
	| 'exact-en'
	| 'english-variant'
	| 'most-complete'
	| 'none';

export interface IBaseLocaleSelection {
	locale?: string;
	source: BaseLocaleSelectionSource;
}

export function hasTranslationKey(row: ITranslationMatrixRow, locale: string): boolean {
	if (row.keyPresence && locale in row.keyPresence) {
		return Boolean(row.keyPresence[locale]);
	}

	return (row.values[locale] ?? '').length > 0;
}

function localeKeyCount(matrix: ITranslationMatrix, locale: string): number {
	return matrix.rows.filter((row) => hasTranslationKey(row, locale)).length;
}

function mostCompleteLocale(matrix: ITranslationMatrix, candidates: string[]): string {
	return [...candidates].sort((left, right) => {
		const countDifference = localeKeyCount(matrix, right) - localeKeyCount(matrix, left);
		return countDifference || left.localeCompare(right);
	})[0];
}

export function resolveBaseLocale(
	matrix: ITranslationMatrix,
	configuredLocale?: string
): IBaseLocaleSelection {
	if (configuredLocale !== undefined) {
		const normalizedConfigured = configuredLocale.trim();
		const configuredMatch = matrix.locales.find(
			(locale) => locale.toLowerCase() === normalizedConfigured.toLowerCase()
		);
		if (!configuredMatch) {
			throw new ScannerConfigError(
				`Configured baseLocale "${configuredLocale}" was not found. Discovered locales: ${matrix.locales.join(', ') || 'none'}.`
			);
		}

		return { locale: configuredMatch, source: 'configured' };
	}

	if (matrix.locales.length === 0) {
		return { source: 'none' };
	}

	const exactEnglish = matrix.locales.find((locale) => locale.toLowerCase() === 'en');
	if (exactEnglish) {
		return { locale: exactEnglish, source: 'exact-en' };
	}

	// Match locale identifiers that begin with "en-" or "en_", case-insensitively.
	const englishVariants = matrix.locales.filter((locale) => /^en[-_]/i.test(locale));
	if (englishVariants.length > 0) {
		return { locale: mostCompleteLocale(matrix, englishVariants), source: 'english-variant' };
	}

	return { locale: mostCompleteLocale(matrix, matrix.locales), source: 'most-complete' };
}
