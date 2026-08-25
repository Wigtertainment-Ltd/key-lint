export interface IScannerGuardrails {
	maxFiles: number;
	maxFileSizeBytes: number;
}

export interface IFilesystemTranslationSourceConfig {
	type: 'filesystem';
	/** Optional stable identifier. A deterministic identifier is generated when omitted. */
	id?: string;
	/** Source-specific file globs. Global translation globs are used when omitted. */
	includeGlobs?: string[];
}

export interface IHttpTranslationSourceConfig {
	type: 'http';
	/** Stable identifier used in diagnostics and source metadata. */
	id: string;
	/** HTTP(S) URL containing exactly one `{locale}` placeholder. */
	urlTemplate: string;
	locales: string[];
	/** Maps HTTP header names to environment-variable names. */
	headersFromEnv?: Record<string, string>;
}

export interface IAutoHttpTranslationSourceConfig {
	type: 'auto-http';
	/** Optional stable identifier. A deterministic identifier is generated when omitted. */
	id?: string;
	/** Base origin required to resolve relative detected URL templates. */
	origin?: string;
	/** Overrides detected locales. Required when the loader exposes no literal locales. */
	locales?: string[];
	/** Maps HTTP header names to environment-variable names. */
	headersFromEnv?: Record<string, string>;
}

export type ITranslationSourceConfig =
	| IFilesystemTranslationSourceConfig
	| IHttpTranslationSourceConfig
	| IAutoHttpTranslationSourceConfig;

export interface IScannerConfig {
	/** Canonical locale used for cross-locale consistency checks. Auto-detected when omitted. */
	baseLocale?: string;
	includeTranslationGlobs: string[];
	includeSourceGlobs: string[];
	excludeGlobs: string[];
	supportedTranslationExtensions: string[];
	/** Ordered translation inputs. Later sources override earlier sources. */
	translationSources?: ITranslationSourceConfig[];
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
	translationSources?: ITranslationSourceConfig[];
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
