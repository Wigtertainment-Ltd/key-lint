import { IFileSystemAdapter, IKeyUsage, IProjectContext, IScanAdapter } from '../scan-adapter.interface.js';
import { IFinding } from '../../models/finding.model.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { IAngularMarkers } from './angular.interfaces.js';
import { DYNAMIC_PATTERNS, STATIC_HTML_PATTERNS, STATIC_TS_PATTERNS } from './extractors/translation-usage.patterns.js';
import { extractMatches } from './extractors/pattern-matcher.util.js';
import { extractTranslocoStructuralMatches } from './extractors/transloco/transloco-structural.extractor.js';
import { BaseLocaleSelectionSource, hasTranslationKey } from '../../util/translation-matrix.util.js';
import { readTranslationJson } from '../../util/translation-json.util.js';

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function escapeRegex(text: string): string {
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(glob: string): RegExp {
	const normalized = normalizePath(glob);
	const escaped = escapeRegex(normalized)
		.replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
		.replace(/\*\*/g, '__DOUBLE_STAR__')
		.replace(/\*/g, '[^/]*')
		.replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
		.replace(/__DOUBLE_STAR__/g, '.*');

	return new RegExp(`^${escaped}$`);
}

function matchesAny(path: string, patterns: string[]): boolean {
	if (patterns.length === 0) {
		return false;
	}

	return patterns.some((pattern) => globToRegex(pattern).test(path));
}


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


function leadingLiteralPrefix(expression: string): string | null {
	const match = /['"`]([A-Za-z0-9_.-]*)['"`]/.exec(expression);
	if (!match) {
		return null;
	}

	const prefix = match[1];
	return prefix.endsWith('.') ? prefix : null;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

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
			collector[prefix] = String(value);
		}
		return;
	}

	const entries = Object.entries(value as Record<string, unknown>);
	if (entries.length === 0 && prefix) {
		collector[prefix] = '';
		return;
	}

	for (const [key, child] of entries) {
		const nextPrefix = prefix ? `${prefix}.${key}` : key;
		if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
			flattenTranslationValueObject(child, nextPrefix, collector);
			continue;
		}

		if (child === null || child === undefined) {
			collector[nextPrefix] = '';
			continue;
		}

		collector[nextPrefix] = Array.isArray(child) ? JSON.stringify(child) : String(child);
	}
}

function inferLocaleFromTranslationFile(filePath: string): string {
	const normalized = normalizePath(filePath);
	const fileName = normalized.split('/').at(-1) ?? normalized;
	const withoutExtension = fileName.replace(/\.[^.]+$/, '');
	const dottedParts = withoutExtension.split('.').filter(Boolean);

	if (dottedParts.length > 1) {
		return dottedParts.at(-1) ?? withoutExtension;
	}

	return withoutExtension;
}

function getParentDirectory(path: string): string {
	const normalized = normalizePath(path).replace(/\/$/, '');
	const lastSlash = normalized.lastIndexOf('/');
	if (lastSlash <= 0) {
		return normalized;
	}

	return normalized.slice(0, lastSlash);
}

function isRootDirectory(path: string): boolean {
	const normalized = normalizePath(path).replace(/\/$/, '');
	if (normalized === '/') {
		return true;
	}

	return /^[A-Za-z]:$/.test(normalized);
}

function joinPath(base: string, fileName: string): string {
	return normalizePath(`${base.replace(/\/$/, '')}/${fileName}`);
}

function collectCandidateRoots(startPath: string): string[] {
	const candidates: string[] = [];
	let current = normalizePath(startPath).replace(/\/$/, '');

	while (true) {
		candidates.push(current);
		if (isRootDirectory(current)) {
			break;
		}

		const parent = getParentDirectory(current);
		if (parent === current) {
			break;
		}

		current = parent;
	}

	return candidates;
}

async function readPackageJsonDependencies(root: string, fs: IFileSystemAdapter): Promise<{ hasPackageJson: boolean; hasAngularDependency: boolean }> {
	const packageJsonPath = joinPath(root, 'package.json');
	const hasPackageJson = await fs.fileExists(packageJsonPath);
	if (!hasPackageJson) {
		return { hasPackageJson: false, hasAngularDependency: false };
	}

	try {
		const packageJsonRaw = await fs.readFile(packageJsonPath);
		const packageJson = JSON.parse(packageJsonRaw) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		const hasAngularDependency =
			Boolean(packageJson.dependencies?.['@angular/core']) ||
			Boolean(packageJson.devDependencies?.['@angular/cli']) ||
			Boolean(packageJson.devDependencies?.['@nx/angular']);

		return { hasPackageJson: true, hasAngularDependency };
	} catch {
		return { hasPackageJson: true, hasAngularDependency: false };
	}
}

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

export const angularScanAdapter: IScanAdapter = {
	id: 'angular',
	framework: 'angular',
	capabilities: {
		templateParsing: true,
		typescriptParsing: true,
		translationFormats: ['json']
	},

	async detect(projectRoot: string, fs: IFileSystemAdapter) {
		const normalizedStart = normalizePath(projectRoot);
		const candidates = collectCandidateRoots(normalizedStart);

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

			const confidence = scoreMarkers(markers);
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

	async collectTranslationFiles(context: IProjectContext, fs: IFileSystemAdapter) {
		const listedFiles = await fs.listFiles(
			context.projectRoot,
			context.config.includeTranslationGlobs,
			context.config.excludeGlobs
		);

		const extensions = new Set(context.config.supportedTranslationExtensions.map((value) => value.toLowerCase()));

		return listedFiles
			.map((file) => normalizePath(file))
			.filter((file) => {
				const extension = file.slice(file.lastIndexOf('.')).toLowerCase();
				return extensions.has(extension);
			})
			.filter((file) => !matchesAny(file, context.config.excludeGlobs))
			.sort((a, b) => a.localeCompare(b));
	},

	async extractDefinedKeys(translationFiles: string[], fs: IFileSystemAdapter) {
		const allKeys: string[] = [];

		for (const filePath of translationFiles) {
			const parsed = await readTranslationJson(fs, filePath);
			allKeys.push(...flattenTranslationObject(parsed));
		}

		return uniqueSorted(allKeys);
	},

	async buildTranslationMatrix(translationFiles: string[], fs: IFileSystemAdapter): Promise<ITranslationMatrix> {
		const localeToValues = new Map<string, Record<string, string>>();
		const localeToPresence = new Map<string, Set<string>>();

		for (const filePath of translationFiles) {
			const parsed = await readTranslationJson(fs, filePath);
			const locale = inferLocaleFromTranslationFile(filePath);
			const flattened: Record<string, string> = {};
			flattenTranslationValueObject(parsed, '', flattened);

			const existing = localeToValues.get(locale) ?? {};
			localeToValues.set(locale, {
				...existing,
				...flattened
			});

			const existingPresence = localeToPresence.get(locale) ?? new Set<string>();
			for (const key of Object.keys(flattened)) {
				existingPresence.add(key);
			}
			localeToPresence.set(locale, existingPresence);
		}

		const locales = uniqueSorted([...localeToValues.keys()]);
		const allKeys = uniqueSorted(
			locales.flatMap((locale) => Object.keys(localeToValues.get(locale) ?? {}))
		);

		const rows = allKeys.map((key) => {
			const values: Record<string, string> = {};
			const keyPresence: Record<string, boolean> = {};
			for (const locale of locales) {
				const localeValues = localeToValues.get(locale) ?? {};
				const localePresence = localeToPresence.get(locale) ?? new Set<string>();
				values[locale] = localeValues[key] ?? '';
				keyPresence[locale] = localePresence.has(key);
			}

			return { key, values, keyPresence };
		});

		return {
			locales,
			rows,
			totalKeys: rows.length
		};
	},

	async extractUsedKeys(context: IProjectContext, fs: IFileSystemAdapter) {
		const sourceFiles = await fs.listFiles(
			context.projectRoot,
			context.config.includeSourceGlobs,
			context.config.excludeGlobs
		);

		const used: IKeyUsage[] = [];

		for (const filePath of sourceFiles.map((file) => normalizePath(file)).sort((a, b) => a.localeCompare(b))) {
			if (matchesAny(filePath, context.config.excludeGlobs)) {
				continue;
			}

			const source = await fs.readFile(filePath);
			const descriptors = filePath.endsWith('.html')
				? [...STATIC_HTML_PATTERNS, ...DYNAMIC_PATTERNS]
				: [...STATIC_TS_PATTERNS, ...STATIC_HTML_PATTERNS, ...DYNAMIC_PATTERNS];
			used.push(...extractMatches(source, filePath, descriptors));

			if (filePath.endsWith('.html')) {
				used.push(...extractTranslocoStructuralMatches(source, filePath));
			}
		}

		return used;
	},

	async runRules(input: {
		definedKeys: string[];
		usedKeys: IKeyUsage[];
		translationMatrix?: ITranslationMatrix;
		baseLocale?: string;
		baseLocaleSelectionSource?: BaseLocaleSelectionSource;
		context: IProjectContext;
	}) {
		const findings: IFinding[] = [];
		const staticUsage = new Set<string>();
		const dynamicUsage = new Map<string, IKeyUsage>();
		const dynamicPrefixes = new Map<string, IKeyUsage>();
		const indirectLiteralUsage = new Map<string, IKeyUsage>();
		const allDefined = new Set(input.definedKeys);
		const translationMatrix = input.translationMatrix ?? { locales: [], rows: [], totalKeys: 0 };

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

				const prefix = leadingLiteralPrefix(usage.key);
				if (prefix && !dynamicPrefixes.has(prefix)) {
					dynamicPrefixes.set(prefix, usage);
				}
				continue;
			}

			staticUsage.add(usage.key);
		}

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

			const indirectEvidence = indirectLiteralUsage.get(key);
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

			const dynamicEvidence = matchDynamicPrefix(key);
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
			const targetLocales = translationMatrix.locales.filter(
				(locale) => locale !== input.baseLocale
			);

			for (const row of translationMatrix.rows) {
				const isInBaseLocale = hasTranslationKey(row, input.baseLocale);

				if (isInBaseLocale) {
					for (const locale of targetLocales) {
						if (hasTranslationKey(row, locale)) {
							continue;
						}

						const evidence = input.usedKeys.filter(
							(usage) => !usage.isDynamic && usage.key === row.key
						);
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

			const evidence = input.usedKeys.filter((usage) => !usage.isDynamic && usage.key === usedKey);
			const missingLocales = translationMatrix.locales.length > 0
				? translationMatrix.locales
				: [undefined];

			for (const locale of missingLocales) {
				findings.push({
					id: locale ? `missing:${usedKey}:${locale}` : `missing:${usedKey}`,
					adapterId: this.id,
					key: usedKey,
					status: 'missing-in-language',
					severity: 'error',
					language: locale,
					message: locale
						? `Key "${usedKey}" is used but missing in locale "${locale}".`
						: `Key "${usedKey}" is used but not present in discovered translation files.`,
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

		return findings.sort(
			(a, b) => a.key.localeCompare(b.key) || (a.language ?? '').localeCompare(b.language ?? '')
		);
	}
};
