import { IScannerConfig } from "./config.interfaces.js";

export const DEFAULT_SCANNER_CONFIG: IScannerConfig = {
	baseLocale: undefined,
	includeTranslationGlobs: [
		'src/assets/i18n/**/*.json',
		'assets/i18n/**/*.json',
		'i18n/**/*.json',
		'locales/**/*.json',
		'public/locales/**/*.json',
		'src/locales/**/*.json',
		'apps/**/src/assets/i18n/**/*.json',
		'libs/**/src/assets/i18n/**/*.json',
		'packages/**/src/assets/i18n/**/*.json'
	],
	includeSourceGlobs: ['**/*.html', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
	excludeGlobs: [
		'**/node_modules/**',
		'**/dist/**',
		'**/coverage/**',
		'**/.git/**',
		'**/.angular/**',
		'**/.nx/**',
		'**/tmp/**',
		'**/out/**'
	],
	supportedTranslationExtensions: ['.json'],
	translationSources: [{ type: 'filesystem' }],
	ignoreKeys: [],
	guardrails: {
		maxFiles: 25000,
		maxFileSizeBytes: 2 * 1024 * 1024
	}
};
