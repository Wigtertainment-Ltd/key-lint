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

/**
 * Checks key presence using explicit metadata when available, including empty translations.
 * Otherwise falls back to checking whether the locale's string value is non-empty.
 *
 * @param row - Translation matrix row to inspect.
 * @param locale - Locale identifier used as the map key.
 * @returns Whether the key is present according to metadata or the legacy value fallback.
 */
export function hasTranslationKey(row: ITranslationMatrixRow, locale: string): boolean {
	if (row.keyPresence && locale in row.keyPresence) {
		return Boolean(row.keyPresence[locale]);
	}

	return (row.values[locale] ?? '').length > 0;
}

/**
 * Counts matrix rows whose key is present in a locale.
 *
 * @param matrix - Translation matrix to inspect.
 * @param locale - Locale whose key coverage is counted.
 * @returns The number of present keys, using the matrix's presence metadata when available.
 */
function localeKeyCount(matrix: ITranslationMatrix, locale: string): number {
	return matrix.rows.filter((row) => hasTranslationKey(row, locale)).length;
}

/**
 * Selects the candidate with the most present keys without mutating the candidate list.
 * Equal coverage is resolved using the locale identifiers' `localeCompare` order.
 *
 * @param matrix - Translation matrix supplying key-presence information.
 * @param candidates - Non-empty list of locale identifiers to rank.
 * @returns The highest-coverage candidate, with locale ordering as the tie-breaker.
 */
function mostCompleteLocale(matrix: ITranslationMatrix, candidates: string[]): string {
	return [...candidates].sort((left, right) => {
		const countDifference = localeKeyCount(matrix, right) - localeKeyCount(matrix, left);
		return countDifference || left.localeCompare(right);
	})[0];
}

/**
 * Selects a reference locale and records how the selection was made.
 * Prefers a case-insensitive configured match, then exact `en`, an English variant,
 * and finally the locale with the most keys. Coverage ties use locale identifier ordering.
 *
 * @param matrix - Discovered locales and their translation-key coverage.
 * @param configuredLocale - Optional reference locale, trimmed before case-insensitive lookup.
 * @returns The selected locale and provenance, or only source `none` when no locales exist.
 * @throws {ScannerConfigError} When a supplied reference locale is absent from the matrix.
 */
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
