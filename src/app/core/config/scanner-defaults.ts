export interface ScannerGuardrails {
	maxFiles: number;
	maxFileSizeBytes: number;
}

export interface ScannerConfig {
	includeTranslationGlobs: string[];
	includeSourceGlobs: string[];
	excludeGlobs: string[];
	supportedTranslationExtensions: string[];
	guardrails: ScannerGuardrails;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
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
	guardrails: {
		maxFiles: 25000,
		maxFileSizeBytes: 2 * 1024 * 1024
	}
};
