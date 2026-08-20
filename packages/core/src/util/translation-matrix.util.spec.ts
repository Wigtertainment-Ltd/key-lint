import { describe, expect, it } from 'vitest';

import { ITranslationMatrix } from '../models/scan-result.model.js';
import { resolveBaseLocale } from './translation-matrix.util.js';

function matrix(locales: string[], presence: Record<string, string[]>): ITranslationMatrix {
	const keys = [...new Set(Object.values(presence).flat())].sort();
	return {
		locales,
		totalKeys: keys.length,
		rows: keys.map((key) => ({
			key,
			values: Object.fromEntries(locales.map((locale) => [locale, ''])),
			keyPresence: Object.fromEntries(
				locales.map((locale) => [locale, presence[locale]?.includes(key) ?? false])
			)
		}))
	};
}

describe('resolveBaseLocale', () => {
	it('uses a configured locale case-insensitively', () => {
		const selection = resolveBaseLocale(matrix(['en', 'de'], { en: ['A'], de: ['A'] }), 'DE');

		expect(selection).toEqual({ locale: 'de', source: 'configured' });
	});

	it('prefers exact en over more complete locales', () => {
		const selection = resolveBaseLocale(
			matrix(['de', 'en'], { de: ['A', 'B'], en: ['A'] })
		);

		expect(selection).toEqual({ locale: 'en', source: 'exact-en' });
	});

	it('chooses the most complete English variant and breaks ties alphabetically', () => {
		const selection = resolveBaseLocale(
			matrix(['en-US', 'en-GB', 'de'], {
				'en-US': ['A'],
				'en-GB': ['A', 'B'],
				de: ['A', 'B', 'C']
			})
		);

		expect(selection).toEqual({ locale: 'en-GB', source: 'english-variant' });
	});

	it('chooses the most complete locale and breaks ties alphabetically', () => {
		const selection = resolveBaseLocale(
			matrix(['fr', 'de', 'es'], { fr: ['A'], de: ['A', 'B'], es: ['A', 'B'] })
		);

		expect(selection).toEqual({ locale: 'de', source: 'most-complete' });
	});

	it('fails when a configured locale was not discovered', () => {
		// Match the stable error fragment naming the missing configured locale.
		expect(() => resolveBaseLocale(matrix(['en'], { en: ['A'] }), 'de')).toThrowError(
			/Configured baseLocale "de" was not found/
		);
	});
});
