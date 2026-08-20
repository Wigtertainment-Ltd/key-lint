import { IScannerConfig } from "./config.interfaces.js";

export const DEFAULT_SCANNER_CONFIG: IScannerConfig = {
	baseLocale: undefined,
	includeTranslationGlobs: [
		'src/assets/i18n/**/*.json',
		'assets/i18n/**/*.json',
		'i18n/**/*.json',
		'locales/**/*.json',
		'apps/**/src/assets/i18n/**/*.json',
		'libs/**/src/assets/i18n/**/*.json',
		'packages/**/src/assets/i18n/**/*.json'
	],
	includeSourceGlobs: ['**/*.html', '**/*.ts'],
	excludeGlobs: [
		'**/node_modules/**',
		'**/dist/**',
		'**/coverage/**',
		'**/.git/**',
		'**/.nx/**',
		'**/tmp/**',
		'**/out/**'
	],
	supportedTranslationExtensions: ['.json'],
	ignoreKeys: [],
	guardrails: {
		maxFiles: 25000,
		maxFileSizeBytes: 2 * 1024 * 1024
	}
};
