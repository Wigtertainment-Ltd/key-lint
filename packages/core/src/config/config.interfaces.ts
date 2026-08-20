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

export interface IScannerConfigOverrides {
	baseLocale?: string;
	includeTranslationGlobs?: string[];
	includeSourceGlobs?: string[];
	excludeGlobs?: string[];
	supportedTranslationExtensions?: string[];
	ignoreKeys?: string[];
	guardrails?: Partial<IScannerGuardrails>;
}

export class ScannerConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ScannerConfigError';
	}
}

export interface ILoadScannerConfigOptions {
	/** Directory the implicit config lookup starts from. */
	projectRoot: string;
	/** Explicit config file path. When set, a missing file is an error. */
	configPath?: string;
	/** Highest precedence overrides, typically parsed from CLI flags. */
	overrides?: IScannerConfigOverrides;
}

export interface ILoadedScannerConfig {
	config: IScannerConfig;
	/** Normalized path of the config file that was applied, if any. */
	configFilePath?: string;
}

export interface IScannerConfigSources {
	packageJson?: unknown;
	configFile?: unknown;
	overrides?: IScannerConfigOverrides;
}

export interface IResolvedScannerConfig {
	config: IScannerConfig;
	packageJsonConfigApplied: boolean;
	configFileApplied: boolean;
	guardrailSources: Record<keyof IScannerGuardrails, ScannerConfigValueSource>;
}

export type ScannerConfigValueSource = 'default' | 'package-json' | 'config-file' | 'override';
