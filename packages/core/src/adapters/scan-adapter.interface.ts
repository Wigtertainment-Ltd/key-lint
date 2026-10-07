import { IFinding } from '../models/finding.model.js';
import { BaseLocaleSelectionSource } from '../util/translation-matrix.util.js';
import { ITranslationMatrix } from '../models/scan-result.model.js';
import { IScannerConfig } from '../config/config.interfaces.js';
import { ITranslationResource } from '../models/translation-resource.model.js';
import { IRemoteTranslationRuntime } from '../remote/remote-translation.interfaces.js';

export type TranslationFormat = 'json' | 'yaml' | 'xliff' | 'po';

export interface IAdapterCapabilities {
	templateParsing: boolean;
	typescriptParsing: boolean;
	translationFormats: TranslationFormat[];
}

export interface IAdapterDetectionResult {
	supported: boolean;
	confidence: number;
	reason?: string;
	resolvedProjectRoot?: string;
}

export interface IFileSystemAdapter {
	/**
	 * Checks whether a path exists according to the runtime adapter's filesystem semantics.
	 *
	 * @param filePath - Path to inspect; implementations may also recognize directories.
	 * @returns Whether the path is available to the adapter.
	 */
	fileExists(filePath: string): Promise<boolean>;
	/**
	 * Reads textual file content through the runtime's filesystem implementation.
	 *
	 * @param filePath - Path of the file to read.
	 * @returns Decoded file content.
	 * @throws {Error} When the file cannot be read.
	 */
	readFile(filePath: string): Promise<string>;
	/**
	 * Enumerates project files selected by include globs and not excluded by exclude globs.
	 * Runtime implementations may apply guardrails and report partial results through their own warning APIs.
	 *
	 * @param projectRoot - Directory beneath which files are enumerated.
	 * @param includeGlobs - Supported patterns identifying files to collect.
	 * @param excludeGlobs - Supported patterns identifying files or directories to omit.
	 * @returns Matching file paths in the implementation's enumeration order.
	 * @throws {Error} When an unrecoverable filesystem enumeration error occurs.
	 */
	listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]>;
}

export interface IProjectContext {
	projectRoot: string;
	config: IScannerConfig;
	remoteTranslations?: IRemoteTranslationRuntime;
}

export interface IKeyUsage {
	key: string;
	filePath: string;
	line?: number;
	column?: number;
	snippet?: string;
	matchType?: string;
	isDynamic?: boolean;
	sourceIndex?: number;
	placeholderParameters?: {
		kind: 'absent' | 'static' | 'dynamic';
		names: string[];
		dynamicPrefixes?: string[];
	};
}

export interface IScanAdapter {
	id: string;
	framework: string;
	capabilities: IAdapterCapabilities;
	/**
	 * Determines whether this adapter supports a project and reports detection confidence.
	 *
	 * @param projectRoot - Selected directory to inspect.
	 * @param fs - Filesystem implementation used for project detection.
	 * @returns Support status, confidence, and optional reason or resolved project root.
	 * @throws {Error} When detection encounters an unrecoverable failure.
	 */
	detect(projectRoot: string, fs: IFileSystemAdapter): Promise<IAdapterDetectionResult>;
	/**
	 * Collects local translation file paths for the legacy file-based scan pipeline.
	 *
	 * @param context - Resolved project root and scanner configuration.
	 * @param fs - Filesystem implementation used for collection.
	 * @returns Translation file paths to pass to file-based extraction methods.
	 * @throws {Error} When translation file collection fails.
	 */
	collectTranslationFiles(context: IProjectContext, fs: IFileSystemAdapter): Promise<string[]>;
	/**
	 * Optionally collects parsed local and remote resources with explicit origin and merge-order metadata.
	 * When implemented, the scan pipeline prefers this method over file-only collection.
	 *
	 * @param context - Project configuration and optional authorized remote runtime.
	 * @param fs - Filesystem implementation used for local resource collection.
	 * @returns Translation resources including parsed content and writability information.
	 * @throws {Error} When local or remote resource collection fails.
	 */
	collectTranslationResources?(context: IProjectContext, fs: IFileSystemAdapter): Promise<ITranslationResource[]>;
	/**
	 * Extracts defined translation keys from collected files.
	 *
	 * @param translationFiles - Translation file paths produced by collection.
	 * @param fs - Filesystem implementation used to read translations.
	 * @returns Defined keys used by the rule evaluator and result summary.
	 * @throws {Error} When a translation file cannot be read or parsed.
	 */
	extractDefinedKeys(translationFiles: string[], fs: IFileSystemAdapter): Promise<string[]>;
	/**
	 * Optionally extracts defined keys directly from parsed translation resources.
	 * The scan pipeline prefers this method when resource-aware collection is available.
	 *
	 * @param resources - Parsed resources with source ordering and locale metadata.
	 * @returns Defined translation keys derived from the resources.
	 * @throws {Error} When resource key extraction fails.
	 */
	extractDefinedKeysFromResources?(resources: ITranslationResource[]): Promise<string[]>;
	/**
	 * Extracts translation-key usage evidence from project source files.
	 *
	 * @param context - Project root and source-scanning configuration.
	 * @param fs - Filesystem implementation used to locate and read source files.
	 * @returns Usage evidence, including locations and dynamic or placeholder metadata when supported.
	 * @throws {Error} When source usage extraction fails.
	 */
	extractUsedKeys(context: IProjectContext, fs: IFileSystemAdapter): Promise<IKeyUsage[]>;
	/**
	 * Optionally builds a locale-by-key matrix from translation files.
	 * When neither matrix-building method is available, the pipeline uses an empty matrix.
	 *
	 * @param translationFiles - Collected translation file paths.
	 * @param fs - Filesystem implementation used to read translations.
	 * @returns Translation values and presence metadata organized by key and locale.
	 * @throws {Error} When matrix construction or translation reading fails.
	 */
	buildTranslationMatrix?(translationFiles: string[], fs: IFileSystemAdapter): Promise<ITranslationMatrix>;
	/**
	 * Optionally builds a locale-by-key matrix from parsed translation resources.
	 * Preferred over file-based matrix construction when resources have been collected.
	 *
	 * @param resources - Parsed resources with explicit merge-order metadata.
	 * @returns Translation values and presence metadata organized by key and locale.
	 * @throws {Error} When resource-based matrix construction fails.
	 */
	buildTranslationMatrixFromResources?(resources: ITranslationResource[]): Promise<ITranslationMatrix>;
	/**
	 * Evaluates adapter-specific rules using definitions, source evidence, and locale coverage.
	 * Ignore-key filtering is applied by the scan pipeline after this method returns.
	 *
	 * @param input - Defined and used keys, translation matrix, selected base locale and its provenance, and project context.
	 * @returns Findings produced by the adapter's rules before pipeline filtering.
	 * @throws {Error} When rule evaluation fails.
	 */
	runRules(input: {
		definedKeys: string[];
		usedKeys: IKeyUsage[];
		translationMatrix: ITranslationMatrix;
		baseLocale?: string;
		baseLocaleSelectionSource: BaseLocaleSelectionSource;
		context: IProjectContext;
	}): Promise<IFinding[]>;
}
