import { AdapterRegistry } from '../adapters/adapter-registry.js';
import { defaultAdapterRegistry } from '../adapters/default-adapter-registry.js';
import { IFileSystemAdapter, IProjectContext } from '../adapters/scan-adapter.interface.js';
import { IScannerConfig } from '../config/config.interfaces.js';
import { DEFAULT_SCANNER_CONFIG } from '../config/scanner-defaults.js';
import { buildSummary, IProjectScanResult, ITranslationMatrix } from '../models/scan-result.model.js';
import { matchesAny } from '../util/glob.util.js';
import { normalizePath } from '../util/path.util.js';
import { resolveBaseLocale } from '../util/translation-matrix.util.js';
import { IRemoteTranslationRuntime } from '../remote/remote-translation.interfaces.js';
import { RemoteTranslationError } from '../remote/remote-translation.error.js';

export type ScanStage =
	| 'detecting-adapter'
	| 'collecting-translation-files'
	| 'extracting-defined-keys'
	| 'building-translation-matrix'
	| 'scanning-source-usage'
	| 'evaluating-rules'
	| 'completed';

export interface IScanProgress {
	stage: ScanStage;
	message: string;
}

export interface IRunScanOptions {
	projectRoot: string;
	fs: IFileSystemAdapter;
	config?: IScannerConfig;
	registry?: AdapterRegistry;
	/**
	 * Receives synchronous notifications as scan stages begin and when the scan completes.
	 *
	 * @param progress - Current stage and human-readable status message.
	 */
	onProgress?: (progress: IScanProgress) => void;
	remoteTranslations?: IRemoteTranslationRuntime;
	/** Loader frameworks confirmed by a preceding static auto-http analysis. */
	detectedLoaderTypes?: readonly ('ngx-translate' | 'transloco')[];
}

const EMPTY_TRANSLATION_MATRIX: ITranslationMatrix = {
	locales: [],
	rows: [],
	totalKeys: 0
};

/**
 * Runs the full i18n scan pipeline. Framework agnostic: every runtime concern
 * (filesystem access, progress reporting) is injected by the caller.
 * Uses resource-aware adapter methods when available and falls back to legacy file-based methods.
 * HTTP sources require explicit runtime consent; auto-HTTP sources must already be resolved.
 * Findings matching ignore-key globs are removed before the result summary is built.
 *
 * @param options - Project root, runtime adapters, optional configuration, and progress callback.
 * @returns Scan findings, summary, translation matrix, timing, and source metadata.
 * @throws {Error} When auto-HTTP sources are unresolved, no adapter supports the project, or an adapter or progress callback fails.
 * @throws {RemoteTranslationError} When HTTP sources lack network consent or a transport, or remote collection fails.
 * @throws {ScannerConfigError} When a configured reference locale cannot be found.
 */
export async function runScan(options: IRunScanOptions): Promise<IProjectScanResult> {
	const { fs, registry = defaultAdapterRegistry, config = DEFAULT_SCANNER_CONFIG } = options;
	/**
	 * Forwards a stage notification to the optional caller-provided callback.
	 *
	 * @param stage - Pipeline stage being reported.
	 * @param message - Human-readable progress description.
	 */
	const report = (stage: ScanStage, message: string): void => options.onProgress?.({ stage, message });
	if (config.translationSources?.some((source) => source.type === 'auto-http')) {
		throw new Error('auto-http translation sources must be resolved and confirmed before runScan(). No request was made.');
	}

	const startedAt = new Date();
	const normalizedProjectRoot = normalizePath(options.projectRoot);

	report('detecting-adapter', 'Detecting project adapter...');
	const adapterMatch = await registry.detectBestAdapter(normalizedProjectRoot, fs);
	if (!adapterMatch) {
		throw new Error('No supported project adapter found for the selected directory.');
	}

	const resolvedProjectRoot = normalizePath(
		adapterMatch.detection.resolvedProjectRoot ?? normalizedProjectRoot
	);
	const adapter = adapterMatch.adapter;
	const context: IProjectContext = {
		projectRoot: resolvedProjectRoot,
		config,
		remoteTranslations: options.remoteTranslations
	};
	const hasRemoteSources = config.translationSources?.some((source) => source.type === 'http') ?? false;
	if (hasRemoteSources && !options.remoteTranslations?.allowNetwork) {
		throw new RemoteTranslationError(
			'network-not-allowed',
			'Remote translation sources are configured, but network access is disabled. Enable the runtime network opt-in explicitly.'
		);
	}
	if (hasRemoteSources && !options.remoteTranslations?.fetcher) {
		throw new RemoteTranslationError(
			'remote-fetcher-missing',
			'Remote translation sources require an injected remote translation fetcher.'
		);
	}

	report('collecting-translation-files', 'Collecting translation files...');
	const translationResources = adapter.collectTranslationResources
		? await adapter.collectTranslationResources(context, fs)
		: undefined;
	const translationFiles = translationResources
		? translationResources
			.flatMap((resource) => resource.origin.type === 'file' ? [resource.origin.path] : [])
		: await adapter.collectTranslationFiles(context, fs);

	report('extracting-defined-keys', 'Extracting translation keys...');
	const definedKeys = translationResources && adapter.extractDefinedKeysFromResources
		? await adapter.extractDefinedKeysFromResources(translationResources)
		: await adapter.extractDefinedKeys(translationFiles, fs);

	report('building-translation-matrix', 'Building translation matrix...');
	const translationMatrix = translationResources && adapter.buildTranslationMatrixFromResources
		? await adapter.buildTranslationMatrixFromResources(translationResources)
		: adapter.buildTranslationMatrix
			? await adapter.buildTranslationMatrix(translationFiles, fs)
			: EMPTY_TRANSLATION_MATRIX;
	const baseLocaleSelection = resolveBaseLocale(translationMatrix, config.baseLocale);

	report('scanning-source-usage', 'Scanning source key usage...');
	const usedKeys = await adapter.extractUsedKeys(context, fs);

	report('evaluating-rules', 'Evaluating scan rules...');
	const rawFindings = await adapter.runRules({
		definedKeys,
		usedKeys,
		translationMatrix,
		baseLocale: baseLocaleSelection.locale,
		baseLocaleSelectionSource: baseLocaleSelection.source,
		context
	});
	const findings = config.ignoreKeys.length
		? rawFindings.filter((finding) => !matchesAny(finding.key, config.ignoreKeys))
		: rawFindings;
	const ignoredFindingCount = rawFindings.length - findings.length;
	const translationSources = config.translationSources ?? [{ type: 'filesystem' as const }];
	const localTranslationSourceCount = translationSources.filter((source) => source.type === 'filesystem').length;
	const remoteSources = translationSources.filter((source) => source.type === 'http');
	const remoteRequestUrls = new Set(
		remoteSources.flatMap((source) => source.locales.map((locale) =>
			source.urlTemplate.replace('{locale}', encodeURIComponent(locale))
		))
	);
	const detectedLoaderTypes = [...new Set(options.detectedLoaderTypes ?? [])].sort();

	const finishedAt = new Date();
	const result: IProjectScanResult = {
		projectRoot: resolvedProjectRoot,
		adapterId: adapter.id,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: finishedAt.getTime() - startedAt.getTime(),
		summary: buildSummary(findings, definedKeys.length),
		findings,
		errors: [],
		translationMatrix,
		metadata: {
			selectedProjectRoot: normalizedProjectRoot,
			adapterDetectionReason: adapterMatch.detection.reason,
			adapterDetectionConfidence: adapterMatch.detection.confidence,
			translationFileCount: translationFiles.length,
			translationSourceCount: translationSources.length,
			localTranslationSourceCount,
			remoteTranslationSourceCount: remoteSources.length,
			remoteRequestCount: remoteRequestUrls.size,
			detectedLoaderTypes,
			translationReadOnly: translationResources?.some((resource) => !resource.writable) ?? false,
			usedKeyEvidenceCount: usedKeys.length,
			translationLocaleCount: translationMatrix.locales.length,
			baseLocale: baseLocaleSelection.locale ?? null,
			baseLocaleSelectionSource: baseLocaleSelection.source,
			ignoredFindingCount
		}
	};

	report('completed', 'Scan completed.');

	return result;
}
