import { AdapterRegistry } from '../adapters/adapter-registry.js';
import { defaultAdapterRegistry } from '../adapters/default-adapter-registry.js';
import { IFileSystemAdapter, IProjectContext } from '../adapters/scan-adapter.interface.js';
import { DEFAULT_SCANNER_CONFIG, IScannerConfig } from '../config/scanner-defaults.js';
import { buildSummary, IProjectScanResult, ITranslationMatrix } from '../models/scan-result.model.js';
import { matchesAny } from '../util/glob.util.js';
import { normalizePath } from '../util/path.util.js';
import { resolveBaseLocale } from '../util/translation-matrix.util.js';

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
	onProgress?: (progress: IScanProgress) => void;
}

const EMPTY_TRANSLATION_MATRIX: ITranslationMatrix = {
	locales: [],
	rows: [],
	totalKeys: 0
};

/**
 * Runs the full i18n scan pipeline. Framework agnostic: every runtime concern
 * (filesystem access, progress reporting) is injected by the caller.
 */
export async function runScan(options: IRunScanOptions): Promise<IProjectScanResult> {
	const { fs, registry = defaultAdapterRegistry, config = DEFAULT_SCANNER_CONFIG } = options;
	const report = (stage: ScanStage, message: string): void => options.onProgress?.({ stage, message });

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
		config
	};

	report('collecting-translation-files', 'Collecting translation files...');
	const translationFiles = await adapter.collectTranslationFiles(context, fs);

	report('extracting-defined-keys', 'Extracting translation keys...');
	const definedKeys = await adapter.extractDefinedKeys(translationFiles, fs);

	report('building-translation-matrix', 'Building translation matrix...');
	const translationMatrix = adapter.buildTranslationMatrix
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
