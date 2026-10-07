import { IFileSystemAdapter, IKeyUsage, IProjectContext, IScanAdapter } from '../scan-adapter.interface.js';
import { IFinding } from '../../models/finding.model.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { IAngularMarkers } from './angular.interfaces.js';
import { DYNAMIC_PATTERNS, STATIC_HTML_PATTERNS, STATIC_TS_PATTERNS } from './extractors/translation-usage.patterns.js';
import { extractMatches } from './extractors/pattern-matcher.util.js';
import { extractTranslocoStructuralMatches } from './extractors/transloco/transloco-structural.extractor.js';
import { BaseLocaleSelectionSource, hasTranslationKey } from '../../util/translation-matrix.util.js';
import { readTranslationJson } from '../../util/translation-json.util.js';
import { extractMustachePlaceholders, parsePlaceholderParameters } from '../../util/placeholder.util.js';
import { ITranslationResource } from '../../models/translation-resource.model.js';
import { mergeTranslationResources } from '../../util/translation-resource.util.js';
import { ITranslationSourceConfig } from '../../config/config.interfaces.js';
import { collectRemoteTranslationResources } from '../../remote/remote-translation-resource.util.js';
import { IPatternDescriptor } from '../adapter.interfaces.js';
import { normalizePath } from '../../util/path.util.js';

/**
 * Collects dotted translation paths by recursively traversing non-array objects.
 * Arrays and scalar children are leaves, including null-valued properties; empty objects contribute no keys.
 *
 * @param value - Acyclic translation content or a nested value to inspect.
 * @param prefix - Optional parent key path for recursive traversal.
 * @returns Leaf key paths in object-entry order, without deduplication or sorting.
 */
function flattenTranslationObject(value: unknown, prefix = ''): string[] {
	if (value === null || value === undefined) {
		return [];
	}

	if (Array.isArray(value)) {
		return prefix ? [prefix] : [];
	}

	if (typeof value !== 'object') {
		return prefix ? [prefix] : [];
	}

	const result: string[] = [];
	const entries = Object.entries(value as Record<string, unknown>);

	for (const [key, child] of entries) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
			result.push(...flattenTranslationObject(child, nextPrefix));
			continue;
		}

		result.push(nextPrefix);
	}

	return result;
}

/**
 * Finds the first quoted key fragment and accepts it only when it ends with a dot.
 * The fragment is a heuristic prefix for possible dynamic usage, not a resolved expression value.
 *
 * @param expression - Dynamic translation expression to inspect.
 * @returns A dotted literal prefix, or `null` when the first supported fragment is absent or unsuitable.
 */
function leadingLiteralPrefix(expression: string): string | null {
	// Capture the first quoted translation-key fragment, allowing an empty fragment before concatenation.
	const match: RegExpExecArray | null = /['"`]([A-Za-z0-9_.-]*)['"`]/.exec(expression);
	if (!match) {
		return null;
	}

	const prefix: string = match[1];
	return prefix.endsWith('.') ? prefix : null;
}

/**
 * Removes exact duplicates and sorts strings without modifying the input array.
 *
 * @param values - Strings to normalize into deterministic output.
 * @returns Unique values sorted using `localeCompare`.
 */
function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Converts strings, primitive scalar values, and functions into matrix display text.
 * Objects, arrays, null, and undefined fall back to an empty string.
 *
 * @param value - Translation leaf value to render.
 * @returns String content or an empty fallback for unsupported values.
 */
function stringifyTranslationValue(value: unknown): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint' || typeof value === 'symbol') {
		return value.toString();
	}
	if (typeof value === 'function') return value.toString();
	return '';
}

/**
 * Writes dotted translation paths and display values into a mutable collector.
 * Nulls and empty objects become empty strings; arrays are JSON-serialized as leaves.
 * Unlike defined-key flattening, nested empty objects are retained as present matrix keys.
 *
 * @param value - Acyclic translation content to flatten.
 * @param prefix - Parent path, normally empty for root content.
 * @param collector - Flat key-to-value map updated in place.
 * @throws {TypeError} When a leaf array cannot be JSON-serialized.
 */
function flattenTranslationValueObject(value: unknown, prefix = '', collector: Record<string, string>): void {
	if (value === null || value === undefined) {
		if (prefix) {
			collector[prefix] = '';
		}
		return;
	}

	if (Array.isArray(value)) {
		if (prefix) {
			collector[prefix] = JSON.stringify(value);
		}
		return;
	}

	if (typeof value !== 'object') {
		if (prefix) {
			collector[prefix] = stringifyTranslationValue(value);
		}
		return;
	}

	const entries: [string, unknown][] = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0 && prefix) {
		collector[prefix] = '';
		return;
	}

	for (const [key, child] of entries) {
		const nextPrefix: string = prefix ? `${prefix}.${key}` : key;
		if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
			flattenTranslationValueObject(child, nextPrefix, collector);
			continue;
		}

		if (child === null || child === undefined) {
			collector[nextPrefix] = '';
			continue;
		}

		collector[nextPrefix] = Array.isArray(child) ? JSON.stringify(child) : stringifyTranslationValue(child);
	}
}

/**
 * Infers a locale from the filename's last dotted segment after removing the final extension.
 * Does not validate locale identifiers or infer them from parent directories.
 *
 * @param filePath - Translation path to normalize and inspect.
 * @returns The final non-empty dotted segment, or the entire extensionless filename.
 */
function inferLocaleFromTranslationFile(filePath: string): string {
	const normalized: string = normalizePath(filePath);
	const fileName: string = normalized.split('/').at(-1) ?? normalized;
	// Remove the final extension while preserving earlier dots used before a locale suffix.
	const withoutExtension: string = fileName.replace(/\.[^.]+$/, '');
	const dottedParts: string[] = withoutExtension.split('.').filter(Boolean);

	if (dottedParts.length > 1) {
		return dottedParts.at(-1) ?? withoutExtension;
	}

	return withoutExtension;
}

/**
 * Lists translation files, filters their extensions case-insensitively, and sorts normalized paths.
 *
 * @param context - Project root and translation discovery configuration.
 * @param fs - Filesystem adapter used for enumeration.
 * @param includeGlobs - Source-specific include patterns; defaults to global translation patterns.
 * @returns Normalized paths with supported extensions, sorted using `localeCompare`.
 * @throws {Error} When filesystem enumeration fails.
 */
async function collectFilesystemTranslationFiles(
	context: IProjectContext,
	fs: IFileSystemAdapter,
	includeGlobs: string[] = context.config.includeTranslationGlobs
): Promise<string[]> {
	const listedFiles: string[] = await fs.listFiles(context.projectRoot, includeGlobs, context.config.excludeGlobs);
	const extensions: Set<string> = new Set<string>(context.config.supportedTranslationExtensions.map((value: string) => value.toLowerCase()));

	return listedFiles
		.map((file) => normalizePath(file))
		.filter((file) => extensions.has(file.slice(file.lastIndexOf('.')).toLowerCase()))
		.sort((left, right) => left.localeCompare(right));
}

/**
 * Reads translation files sequentially and creates writable filesystem resource records.
 * Infers locales from filenames and preserves the supplied file order in resource positions.
 *
 * @param translationFiles - Ordered translation file paths.
 * @param fs - Filesystem adapter used to read and parse JSON content.
 * @param sourceId - Source identifier; defaults to `filesystem-1`.
 * @param sourceIndex - Source position in the configuration; defaults to zero.
 * @param positionOffset - Starting global merge position for these resources; defaults to zero.
 * @returns Parsed filesystem resources with normalized origins and deterministic positions.
 * @throws {TranslationFileError} When a file cannot be read or does not contain a valid JSON object.
 */
async function resourcesFromFiles(
	translationFiles: string[],
	fs: IFileSystemAdapter,
	sourceId = 'filesystem-1',
	sourceIndex = 0,
	positionOffset = 0
): Promise<ITranslationResource[]> {
	const resources: ITranslationResource[] = [];
	for (const [resourceIndex, filePath] of translationFiles.entries()) {
		const normalizedPath: string = normalizePath(filePath);
		resources.push({
			locale: inferLocaleFromTranslationFile(normalizedPath),
			sourceType: 'filesystem',
			sourceId,
			sourceIndex,
			resourceIndex,
			position: positionOffset + resourceIndex,
			content: await readTranslationJson(fs, normalizedPath),
			origin: { type: 'file', path: normalizedPath },
			writable: true
		});
	}
	return resources;
}

/**
 * Merges resources by locale before collecting defined leaf keys across all locales.
 * Later resource positions can replace earlier values and thereby change the resulting key paths.
 *
 * @param resources - Parsed translation resources with locale and merge-order metadata.
 * @returns Unique dotted leaf keys sorted using `localeCompare`.
 */
function definedKeysFromResources(resources: ITranslationResource[]): string[] {
	return uniqueSorted(
		[...mergeTranslationResources(resources).values()]
			.flatMap((content) => flattenTranslationObject(content))
	);
}

/**
 * Builds a sorted locale-by-key matrix from merged resource content.
 * Stores explicit presence separately from display values and extracts Mustache placeholders per locale.
 * Missing values use empty display strings while their presence flag remains false.
 *
 * @param resources - Parsed resources merged in their configured position order.
 * @returns Sorted locales and rows with values, presence flags, placeholders, and total key count.
 * @throws {TypeError} When a translation array cannot be JSON-serialized for display.
 */
function matrixFromResources(resources: ITranslationResource[]): ITranslationMatrix {
	const localeToContent: Map<string, Record<string, unknown>> = mergeTranslationResources(resources);
	const localeToValues: Map<string, Record<string, string>> = new Map<string, Record<string, string>>();
	const localeToPresence: Map<string, Set<string>> = new Map<string, Set<string>>();

	for (const [locale, content] of localeToContent) {
		const flattened: Record<string, string> = {};
		flattenTranslationValueObject(content, '', flattened);
		localeToValues.set(locale, flattened);
		localeToPresence.set(locale, new Set(Object.keys(flattened)));
	}

	const locales: string[] = uniqueSorted([...localeToValues.keys()]);
	const allKeys: string[] = uniqueSorted(locales.flatMap((locale) => Object.keys(localeToValues.get(locale) ?? {})));
	const rows = allKeys.map((key) => {
		const values: Record<string, string> = {};
		const keyPresence: Record<string, boolean> = {};
		const placeholders: Record<string, string[]> = {};
		for (const locale of locales) {
			const localeValues: Record<string, string> = localeToValues.get(locale) ?? {};
			const localePresence: Set<string> = localeToPresence.get(locale) ?? new Set<string>();
			values[locale] = localeValues[key] ?? '';
			keyPresence[locale] = localePresence.has(key);
			placeholders[locale] = extractMustachePlaceholders(values[locale]);
		}
		return { key, values, keyPresence, placeholders };
	});

	return { locales, rows, totalKeys: rows.length };
}

/**
 * Removes the final directory segment using normalized forward-slash paths.
 * Stops reducing a path when its final slash is absent or at index zero.
 *
 * @param path - Directory path whose parent is requested.
 * @returns The shortened path, or the trailing-slash-stripped input when it cannot be reduced.
 */
function getParentDirectory(path: string): string {
	// Remove one trailing forward slash before locating the parent directory.
	const normalized: string = normalizePath(path).replace(/\/$/, '');
	const lastSlash: number = normalized.lastIndexOf('/');
	if (lastSlash <= 0) {
		return normalized;
	}

	return normalized.slice(0, lastSlash);
}

/**
 * Tests a normalized, trailing-slash-stripped path against the adapter's root markers.
 * Recognizes Windows drive roots; a bare Unix slash becomes empty before the comparison.
 *
 * @param path - Candidate directory path to classify.
 * @returns Whether the stripped path matches a root marker.
 */
function isRootDirectory(path: string): boolean {
	// Remove one trailing forward slash so Unix and Windows roots can be compared consistently.
	const normalized: string = normalizePath(path).replace(/\/$/, '');
	if (normalized === '/') {
		return true;
	}

	// Match a Windows drive root after its trailing slash has been removed, for example "C:".
	return /^[A-Za-z]:$/.test(normalized);
}

/**
 * Joins a directory and filename using the adapter's filesystem path normalization.
 * Does not resolve dot segments or access the filesystem.
 *
 * @param base - Directory path to extend.
 * @param fileName - Filename or relative suffix to append.
 * @returns A normalized path with forward-slash separators.
 */
function joinPath(base: string, fileName: string): string {
	// Remove one trailing slash from the base to avoid creating a doubled separator.
	return normalizePath(`${base.replace(/\/$/, '')}/${fileName}`);
}

/**
 * Collects the selected directory and progressively reducible parents for project detection.
 * Stops at a recognized root or when parent extraction no longer changes the path.
 *
 * @param startPath - Selected project directory to normalize.
 * @returns Candidate directory strings in nearest-to-farthest order.
 */
function collectCandidateRoots(startPath: string): string[] {
	const candidates: string[] = [];
	// Remove one trailing slash before walking upward through candidate roots.
	let current: string = normalizePath(startPath).replace(/\/$/, '');

	while (true) {
		candidates.push(current);
		if (isRootDirectory(current)) {
			break;
		}

		const parent: string = getParentDirectory(current);
		if (parent === current) {
			break;
		}

		current = parent;
	}

	return candidates;
}

/**
 * Checks package metadata for the Angular core, Angular CLI, or Nx Angular dependency markers.
 * Read and JSON parsing failures retain the file-presence flag but produce no dependency marker.
 *
 * @param root - Candidate project directory containing package metadata.
 * @param fs - Filesystem adapter used for existence checks and reading.
 * @returns Package-file availability and whether a recognized dependency has a truthy value.
 * @throws {Error} When the filesystem existence check rejects.
 */
async function readPackageJsonDependencies(root: string, fs: IFileSystemAdapter): Promise<{ hasPackageJson: boolean; hasAngularDependency: boolean }> {
	const packageJsonPath: string = joinPath(root, 'package.json');
	const hasPackageJson: boolean = await fs.fileExists(packageJsonPath);
	if (!hasPackageJson) {
		return { hasPackageJson: false, hasAngularDependency: false };
	}

	try {
		const packageJsonRaw: string = await fs.readFile(packageJsonPath);
		const packageJson = JSON.parse(packageJsonRaw) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const hasAngularDependency =
			Boolean(packageJson.dependencies?.['@angular/core']) || Boolean(packageJson.devDependencies?.['@angular/cli']) || Boolean(packageJson.devDependencies?.['@nx/angular']);

		return { hasPackageJson: true, hasAngularDependency };
	} catch {
		return { hasPackageJson: true, hasAngularDependency: false };
	}
}

/**
 * Assigns detection confidence from recognized Angular workspace files and dependencies.
 * Scores range from zero to one; package-file presence alone is not sufficient support evidence.
 *
 * @param markers - Filesystem and dependency markers found at a candidate root.
 * @returns The confidence of the strongest supported marker combination.
 */
function scoreMarkers(markers: IAngularMarkers): number {
	if (markers.hasAngularJson && markers.hasAngularDependency) {
		return 1;
	}

	if ((markers.hasNxJson || markers.hasWorkspaceJson) && markers.hasAngularDependency) {
		return 0.9;
	}

	if (markers.hasAngularJson || markers.hasProjectJson) {
		return 0.85;
	}

	if (markers.hasAngularDependency) {
		return 0.7;
	}

	return 0;
}

/**
 * Formats the recognized workspace files and dependency markers into detection diagnostics.
 *
 * @param markers - Markers discovered at the selected detection root.
 * @returns A human-readable list of detected markers, or a no-markers explanation.
 */
function buildReason(markers: IAngularMarkers): string {
	const parts: string[] = [];
	if (markers.hasAngularJson) {
		parts.push('angular.json');
	}
	if (markers.hasNxJson) {
		parts.push('nx.json');
	}
	if (markers.hasWorkspaceJson) {
		parts.push('workspace.json');
	}
	if (markers.hasProjectJson) {
		parts.push('project.json');
	}
	if (markers.hasAngularDependency) {
		parts.push('Angular dependencies');
	}

	if (parts.length === 0) {
		return 'No Angular markers found';
	}

	return `Detected ${parts.join(', ')}`;
}

/** Angular JSON scanner with heuristic ngx-translate and Transloco usage extraction and locale/placeholder rules. */
export const angularScanAdapter: IScanAdapter = {
	id: 'angular',
	framework: 'angular',
	capabilities: {
		templateParsing: true,
		typescriptParsing: true,
		translationFormats: ['json']
	},

	/**
	 * Inspects the selected directory and reducible parents for Angular workspace and dependency markers.
	 * Checks markers concurrently within each directory and keeps the highest-confidence supported root.
	 * Confidence ties retain the candidate nearest to the selected directory.
	 *
	 * @param projectRoot - Selected directory from which upward detection begins.
	 * @param fs - Filesystem adapter used for marker and package checks.
	 * @returns Detection support, confidence, reason, and the best root when supported.
	 * @throws {Error} When a filesystem existence check fails.
	 */
	async detect(projectRoot: string, fs: IFileSystemAdapter) {
		const normalizedStart: string = normalizePath(projectRoot);
		const candidates: string[] = collectCandidateRoots(normalizedStart);

		let best: { markers: IAngularMarkers; confidence: number } | null = null;

		for (const root of candidates) {
			const [hasAngularJson, hasNxJson, hasWorkspaceJson, hasProjectJson, packageInfo] = await Promise.all([
				fs.fileExists(joinPath(root, 'angular.json')),
				fs.fileExists(joinPath(root, 'nx.json')),
				fs.fileExists(joinPath(root, 'workspace.json')),
				fs.fileExists(joinPath(root, 'project.json')),
				readPackageJsonDependencies(root, fs)
			]);

			const markers: IAngularMarkers = {
				root,
				hasAngularJson,
				hasNxJson,
				hasWorkspaceJson,
				hasProjectJson,
				hasPackageJson: packageInfo.hasPackageJson,
				hasAngularDependency: packageInfo.hasAngularDependency
			};

			const confidence: number = scoreMarkers(markers);
			if (confidence <= 0) {
				continue;
			}

			if (!best || confidence > best.confidence) {
				best = { markers, confidence };
			}
		}

		if (!best) {
			return {
				supported: false,
				confidence: 0,
				reason: 'No Angular markers found in selected path or parent directories.'
			};
		}

		return {
			supported: true,
			confidence: best.confidence,
			reason: buildReason(best.markers),
			resolvedProjectRoot: best.markers.root
		};
	},

	/**
	 * Collects local translation paths using global translation globs and supported extensions.
	 * This legacy method does not collect HTTP sources or apply source-specific include patterns.
	 *
	 * @param context - Resolved project root and file discovery settings.
	 * @param fs - Filesystem adapter used for enumeration.
	 * @returns Normalized translation paths in sorted order.
	 * @throws {Error} When filesystem enumeration fails.
	 */
	async collectTranslationFiles(context: IProjectContext, fs: IFileSystemAdapter) {
		return collectFilesystemTranslationFiles(context, fs);
	},

	/**
	 * Collects parsed filesystem and explicit HTTP resources in configured source order.
	 * Fetches HTTP resources first, then interleaves them with local resources and assigns global positions.
	 * Defaults to one filesystem source when no sources are configured; auto-HTTP sources must be resolved beforehand.
	 *
	 * @param context - Project settings and optional explicitly authorized remote runtime.
	 * @param fs - Filesystem adapter used for local enumeration and JSON reading.
	 * @returns Ordered resources with local writability and read-only remote origins.
	 * @throws {RemoteTranslationError} When remote preflight or fetching fails.
	 * @throws {TranslationFileError} When local or remote translation content is unreadable or invalid.
	 * @throws {Error} When auto-HTTP sources remain unresolved or file enumeration fails.
	 */
	async collectTranslationResources(context: IProjectContext, fs: IFileSystemAdapter) {
		const resources: ITranslationResource[] = [];
		const configuredSources: ITranslationSourceConfig[] = context.config.translationSources ?? [
			{ type: 'filesystem' }
		];
		const hasRemoteSources = configuredSources.some((source) => source.type === 'http');
		const remoteResources = hasRemoteSources
			? await collectRemoteTranslationResources(
				configuredSources,
				context.remoteTranslations ?? { allowNetwork: false },
				context.config.guardrails
			)
			: new Map<number, ITranslationResource[]>();
		for (const [sourceIndex, source] of configuredSources.entries()) {
			if (source.type === 'http') {
				const sourceResources = (remoteResources.get(sourceIndex) ?? []).map((resource, resourceIndex) => ({
					...resource,
					resourceIndex,
					position: resources.length + resourceIndex
				}));
				resources.push(...sourceResources);
				continue;
			}
			if (source.type === 'auto-http') {
				throw new Error('auto-http translation sources must be resolved before resource collection.');
			}

			const files = await collectFilesystemTranslationFiles(
				context,
				fs,
				source.includeGlobs ?? context.config.includeTranslationGlobs
			);
			const sourceResources: ITranslationResource[] = await resourcesFromFiles(
				files,
				fs,
				source.id ?? `filesystem-${sourceIndex + 1}`,
				sourceIndex,
				resources.length
			);
			resources.push(...sourceResources);
		}
		return resources;
	},

	/**
	 * Reads local JSON files, merges their resource content by locale, and extracts defined leaf keys.
	 * File input order supplies merge precedence.
	 *
	 * @param translationFiles - Ordered local translation paths.
	 * @param fs - Filesystem adapter used to read JSON content.
	 * @returns Unique sorted keys from the merged translations.
	 * @throws {TranslationFileError} When a file cannot be read or parsed as a JSON object.
	 */
	async extractDefinedKeys(translationFiles: string[], fs: IFileSystemAdapter) {
		return definedKeysFromResources(await resourcesFromFiles(translationFiles, fs));
	},

	/**
	 * Extracts defined keys from resource content without further filesystem or network access.
	 *
	 * @param resources - Parsed resources whose positions determine locale merge precedence.
	 * @returns Unique sorted leaf keys across merged locales.
	 */
	async extractDefinedKeysFromResources(resources: ITranslationResource[]) {
		return definedKeysFromResources(resources);
	},

	/**
	 * Reads local JSON files and builds a merged locale-by-key matrix.
	 *
	 * @param translationFiles - Ordered file paths supplying merge precedence and inferred locales.
	 * @param fs - Filesystem adapter used to read JSON content.
	 * @returns Sorted translation rows with explicit presence and Mustache-placeholder metadata.
	 * @throws {TranslationFileError} When a file cannot be read or parsed as a JSON object.
	 */
	async buildTranslationMatrix(translationFiles: string[], fs: IFileSystemAdapter): Promise<ITranslationMatrix> {
		return matrixFromResources(await resourcesFromFiles(translationFiles, fs));
	},

	/**
	 * Builds the translation matrix directly from parsed resources without runtime I/O.
	 *
	 * @param resources - Resources carrying locale content and merge positions.
	 * @returns Sorted locales and rows with values, key presence, and placeholder contracts.
	 * @throws {TypeError} When a translation array cannot be JSON-serialized for display.
	 */
	async buildTranslationMatrixFromResources(resources: ITranslationResource[]): Promise<ITranslationMatrix> {
		return matrixFromResources(resources);
	},

	/**
	 * Scans sorted project source files with static and dynamic translation patterns.
	 * Also scans non-HTML files for inline HTML patterns, attaches ngx-translate directive parameters,
	 * and extracts Transloco structural aliases from HTML files. Overlapping evidence is deduplicated
	 * by path, source offset, key, and dynamic classification while retaining the first match.
	 *
	 * @param context - Project root and configured source include/exclude patterns.
	 * @param fs - Filesystem adapter used for source enumeration and reading.
	 * @returns Heuristic key-usage evidence with locations, snippets, and parameter metadata.
	 * @throws {Error} When source enumeration or reading fails.
	 */
	async extractUsedKeys(context: IProjectContext, fs: IFileSystemAdapter) {
		const sourceFiles: string[] = await fs.listFiles(context.projectRoot, context.config.includeSourceGlobs, context.config.excludeGlobs);

		const used: IKeyUsage[] = [];

		for (const filePath of sourceFiles.map((file) => normalizePath(file)).sort((a, b) => a.localeCompare(b))) {
			const source: string = await fs.readFile(filePath);
			const descriptors: IPatternDescriptor[] = filePath.endsWith('.html') ? [...STATIC_HTML_PATTERNS, ...DYNAMIC_PATTERNS] : [...STATIC_TS_PATTERNS, ...STATIC_HTML_PATTERNS, ...DYNAMIC_PATTERNS];
			const fileUsages: IKeyUsage[] = extractMatches(source, filePath, descriptors);
			for (const usage of fileUsages) {
				if (usage.matchType === 'html-attribute-translate' || usage.matchType === 'html-bound-translate') {
					const sourceIndex: number = usage.sourceIndex ?? 0;
					const tagStart: number = source.lastIndexOf('<', sourceIndex);
					const tagEnd: number = source.indexOf('>', sourceIndex);
					const tag: string = tagStart >= 0 && tagEnd >= 0 ? source.slice(tagStart, tagEnd + 1) : '';
					// Capture the Angular expression assigned to translateParams in the same start tag.
					const paramsMatch: RegExpExecArray | null = /\[?translateParams\]?\s*=\s*(['"])([\s\S]*?)\1/i.exec(tag);
					usage.placeholderParameters = parsePlaceholderParameters(paramsMatch?.[2]);
				}
			}
			used.push(...fileUsages);

			if (filePath.endsWith('.html')) {
				used.push(...extractTranslocoStructuralMatches(source, filePath));
			}
		}

		const deduplicated: Map<string, IKeyUsage> = new Map<string, IKeyUsage>();
		for (const usage of used) {
			const identity: string = `${usage.filePath}:${usage.sourceIndex ?? `${usage.line}:${usage.column}`}:${usage.key}:${usage.isDynamic ? 'dynamic' : 'static'}`;
			if (!deduplicated.has(identity)) {
				deduplicated.set(identity, usage);
			}
		}
		return [...deduplicated.values()];
	},

	/**
	 * Evaluates static usage, uncertain indirect/dynamic usage, locale coverage, and placeholder contracts.
	 * Uses the selected base locale for cross-locale checks and required parameters; dynamic evidence
	 * produces uncertainty warnings rather than proving a key unused. Static keys absent from all
	 * translations receive a missing finding per discovered locale, or one unscoped finding when none exists.
	 * Must be called on the adapter instance because finding metadata uses its ID.
	 *
	 * @param input - Definitions, source usages, optional matrix and base-locale metadata, and project context.
	 * @returns Findings sorted by key and language, before pipeline ignore-key filtering.
	 */
	async runRules(input: {
		definedKeys: string[];
		usedKeys: IKeyUsage[];
		translationMatrix?: ITranslationMatrix;
		baseLocale?: string;
		baseLocaleSelectionSource?: BaseLocaleSelectionSource;
		context: IProjectContext;
	}) {
		const findings: IFinding[] = [];
		const staticUsage: Set<string> = new Set<string>();
		const dynamicUsage: Map<string, IKeyUsage> = new Map<string, IKeyUsage>();
		const dynamicPrefixes: Map<string, IKeyUsage> = new Map<string, IKeyUsage>();
		const indirectLiteralUsage: Map<string, IKeyUsage> = new Map<string, IKeyUsage>();
		const allDefined: Set<string> = new Set<string>(input.definedKeys);
		const translationMatrix: ITranslationMatrix = input.translationMatrix ?? { locales: [], rows: [], totalKeys: 0 };
		const placeholderContractByKey: Map<string, string[]> = new Map<string, string[]>();
		if (input.baseLocale) {
			for (const row of translationMatrix.rows) {
				placeholderContractByKey.set(row.key, row.placeholders?.[input.baseLocale] ?? []);
			}
		}

		for (const usage of input.usedKeys) {
			if (usage.matchType === 'ts-indirect-key-literal') {
				if (!indirectLiteralUsage.has(usage.key)) {
					indirectLiteralUsage.set(usage.key, usage);
				}
				continue;
			}

			if (usage.isDynamic) {
				if (!dynamicUsage.has(usage.key)) {
					dynamicUsage.set(usage.key, usage);
				}

				const prefix: string | null = leadingLiteralPrefix(usage.key);
				if (prefix && !dynamicPrefixes.has(prefix)) {
					dynamicPrefixes.set(prefix, usage);
				}
				continue;
			}

			staticUsage.add(usage.key);
		}

		for (const [key, required] of placeholderContractByKey) {
			if (required.length === 0) {
				continue;
			}

			const usages: IKeyUsage[] = input.usedKeys.filter((usage) => !usage.isDynamic && usage.key === key);
			for (const usage of usages) {
				const parameterUsage = usage.placeholderParameters ?? { kind: 'absent' as const, names: [] };
				const missing: string[] = required.filter((name) => !parameterUsage.names.includes(name));
				if (missing.length === 0) {
					continue;
				}

				const uncertain: boolean =
					parameterUsage.kind === 'dynamic' || missing.some((name) => (parameterUsage.dynamicPrefixes ?? []).some((prefix) => name.startsWith(`${prefix}.`)));
				const status = uncertain ? ('placeholder-uncertain' as const) : ('placeholder-missing' as const);
				const locationId: string = `${usage.filePath}:${usage.line ?? 0}:${usage.column ?? 0}`;
				findings.push({
					id: `${status}:${key}:${locationId}`,
					adapterId: this.id,
					key,
					status,
					severity: uncertain ? 'warning' : 'error',
					message: uncertain
						? `Key "${key}" requires placeholder(s) ${missing.map((name) => `"${name}"`).join(', ')}, but the supplied parameters cannot be resolved statically.`
						: `Key "${key}" is used without required placeholder(s) ${missing.map((name) => `"${name}"`).join(', ')}.`,
					evidence: [
						{
							filePath: usage.filePath,
							line: usage.line,
							column: usage.column,
							snippet: usage.snippet,
							matchType: usage.matchType
						}
					],
					placeholderDetails: {
						required,
						provided: parameterUsage.names,
						missing
					}
				});
			}
		}

		if (input.baseLocale) {
			for (const row of translationMatrix.rows) {
				if (row.keyPresence?.[input.baseLocale] === false) {
					continue;
				}
				const expected: string[] = row.placeholders?.[input.baseLocale] ?? [];
				for (const locale of translationMatrix.locales) {
					if (locale === input.baseLocale || row.keyPresence?.[locale] === false) {
						continue;
					}
					const actual: string[] = row.placeholders?.[locale] ?? [];
					const matches: boolean = expected.length === actual.length && expected.every((name) => actual.includes(name));
					if (matches) {
						continue;
					}
					findings.push({
						id: `placeholder-mismatch:${row.key}:${locale}`,
						adapterId: this.id,
						key: row.key,
						status: 'placeholder-mismatch',
						severity: 'error',
						language: locale,
						message: `Key "${row.key}" uses placeholder(s) [${actual.join(', ')}] in locale "${locale}", but base locale "${input.baseLocale}" requires [${expected.join(', ')}].`,
						evidence: [],
						placeholderDetails: {
							required: expected,
							expected,
							actual
						}
					});
				}
			}
		}

		/**
		 * Finds the first recorded dynamic-prefix evidence covering a defined translation key.
		 *
		 * @param key - Defined key to compare with inferred literal prefixes.
		 * @returns The first matching usage record, or `undefined` when no prefix covers the key.
		 */
		const matchDynamicPrefix = (key: string): IKeyUsage | undefined => {
			for (const [prefix, usage] of dynamicPrefixes.entries()) {
				if (key.startsWith(prefix)) {
					return usage;
				}
			}

			return undefined;
		};

		for (const key of uniqueSorted([...allDefined])) {
			if (staticUsage.has(key)) {
				findings.push({
					id: `used:${key}`,
					adapterId: this.id,
					key,
					status: 'used',
					severity: 'info',
					message: `Key "${key}" is used in project sources.`,
					evidence: input.usedKeys
						.filter((usage) => !usage.isDynamic && usage.key === key)
						.map((usage) => ({
							filePath: usage.filePath,
							line: usage.line,
							column: usage.column,
							snippet: usage.snippet,
							matchType: usage.matchType
						}))
				});
				continue;
			}

			const indirectEvidence: IKeyUsage | undefined = indirectLiteralUsage.get(key);
			if (indirectEvidence) {
				findings.push({
					id: `indirect-key:${key}`,
					adapterId: this.id,
					key,
					status: 'indirect-uncertain',
					severity: 'warning',
					message: `Key "${key}" appears in TypeScript string literals but is not confirmed by direct translation usage patterns.`,
					evidence: [
						{
							filePath: indirectEvidence.filePath,
							line: indirectEvidence.line,
							column: indirectEvidence.column,
							snippet: indirectEvidence.snippet,
							matchType: indirectEvidence.matchType
						}
					]
				});
				continue;
			}

			const dynamicEvidence: IKeyUsage | undefined = matchDynamicPrefix(key);
			if (dynamicEvidence) {
				findings.push({
					id: `dynamic-key:${key}`,
					adapterId: this.id,
					key,
					status: 'dynamic-uncertain',
					severity: 'warning',
					message: `Key "${key}" is likely used through a dynamic translation expression and could not be confirmed statically.`,
					evidence: [
						{
							filePath: dynamicEvidence.filePath,
							line: dynamicEvidence.line,
							column: dynamicEvidence.column,
							snippet: dynamicEvidence.snippet,
							matchType: dynamicEvidence.matchType
						}
					]
				});
				continue;
			}

			findings.push({
				id: `unused:${key}`,
				adapterId: this.id,
				key,
				status: 'unused',
				severity: 'warning',
				message: `Key "${key}" is not referenced by detected static usage patterns.`,
				evidence: []
			});
		}

		for (const [dynamicExpression, evidence] of dynamicUsage.entries()) {
			findings.push({
				id: `dynamic:${dynamicExpression}`,
				adapterId: this.id,
				key: dynamicExpression,
				status: 'dynamic-uncertain',
				severity: 'warning',
				message: `Dynamic translation expression "${dynamicExpression}" could not be resolved statically.`,
				evidence: [
					{
						filePath: evidence.filePath,
						line: evidence.line,
						column: evidence.column,
						snippet: evidence.snippet,
						matchType: evidence.matchType
					}
				]
			});
		}

		if (input.baseLocale) {
			const targetLocales: string[] = translationMatrix.locales.filter((locale) => locale !== input.baseLocale);

			for (const row of translationMatrix.rows) {
				const isInBaseLocale: boolean = hasTranslationKey(row, input.baseLocale);

				if (isInBaseLocale) {
					for (const locale of targetLocales) {
						if (hasTranslationKey(row, locale)) {
							continue;
						}

						const evidence: IKeyUsage[] = input.usedKeys.filter((usage) => !usage.isDynamic && usage.key === row.key);
						findings.push({
							id: `missing:${row.key}:${locale}`,
							adapterId: this.id,
							key: row.key,
							status: 'missing-in-language',
							severity: 'error',
							language: locale,
							message: `Key "${row.key}" is present in base locale "${input.baseLocale}" but missing in locale "${locale}".`,
							evidence: evidence.map((usage) => ({
								filePath: usage.filePath,
								line: usage.line,
								column: usage.column,
								snippet: usage.snippet,
								matchType: usage.matchType
							}))
						});
					}

					continue;
				}

				for (const locale of targetLocales) {
					if (!hasTranslationKey(row, locale)) {
						continue;
					}

					findings.push({
						id: `extra:${row.key}:${locale}`,
						adapterId: this.id,
						key: row.key,
						status: 'extra-in-language',
						severity: 'warning',
						language: locale,
						message: `Key "${row.key}" exists in locale "${locale}" but not in base locale "${input.baseLocale}".`,
						evidence: []
					});
				}
			}
		}

		for (const usedKey of uniqueSorted([...staticUsage])) {
			if (allDefined.has(usedKey)) {
				continue;
			}

			const evidence: IKeyUsage[] = input.usedKeys.filter((usage) => !usage.isDynamic && usage.key === usedKey);
			const missingLocales: string[] | undefined[] = translationMatrix.locales.length > 0 ? translationMatrix.locales : [undefined];

			for (const locale of missingLocales) {
				findings.push({
					id: locale ? `missing:${usedKey}:${locale}` : `missing:${usedKey}`,
					adapterId: this.id,
					key: usedKey,
					status: 'missing-in-language',
					severity: 'error',
					language: locale,
					message: locale ? `Key "${usedKey}" is used but missing in locale "${locale}".` : `Key "${usedKey}" is used but not present in discovered translation files.`,
					evidence: evidence.map((usage) => ({
						filePath: usage.filePath,
						line: usage.line,
						column: usage.column,
						snippet: usage.snippet,
						matchType: usage.matchType
					}))
				});
			}
		}

		return findings.sort((a, b) => a.key.localeCompare(b.key) || (a.language ?? '').localeCompare(b.language ?? ''));
	}
};
