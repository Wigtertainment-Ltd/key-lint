export interface IScannerGuardrails {
	maxFiles: number;
	maxFileSizeBytes: number;
}

export interface IScannerConfig {
	/** Canonical locale used for cross-locale consistency checks. Auto-detected when omitted. */
	baseLocale?: string;
	includeTranslationGlobs: string[];
	includeSourceGlobs: string[];
	excludeGlobs: string[];
	supportedTranslationExtensions: string[];
	/** Glob patterns matched against translation keys; matching findings are dropped. */
	ignoreKeys: string[];
	guardrails: IScannerGuardrails;
}

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
		maxFiles: 10,
		maxFileSizeBytes: 2 * 1024 * 1024
	}
};
