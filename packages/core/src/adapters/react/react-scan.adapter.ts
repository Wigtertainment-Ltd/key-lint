import { IFinding } from '../../models/finding.model.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { ITranslationResource } from '../../models/translation-resource.model.js';
import { normalizePath } from '../../util/path.util.js';
import { readTranslationJson } from '../../util/translation-json.util.js';
import { hasTranslationKey } from '../../util/translation-matrix.util.js';
import { mergeTranslationResources } from '../../util/translation-resource.util.js';
import { IFileSystemAdapter, IKeyUsage, IProjectContext, IScanAdapter } from '../scan-adapter.interface.js';
import { matchesReactDynamicKey, qualifyReactKey, reactResourceIdentity } from './react-key.util.js';
import { extractReactPlaceholders } from './react-interpolation.util.js';
import { reactPlaceholderFindings } from './react-placeholder.rules.js';
import { resolveReactPluralUsages } from './react-plural.rules.js';

function flattenTranslations(content: Record<string, unknown>, prefix = ''): Record<string, string> {
	return Object.fromEntries(
		Object.entries(content).flatMap(([key, value]) => {
			const path = prefix ? `${prefix}.${key}` : key;
			if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
				return Object.entries(flattenTranslations(value as Record<string, unknown>, path));
			}
			return [[path, value === null ? '' : typeof value === 'string' ? value : (JSON.stringify(value) ?? '')]];
		})
	);
}

function matrixFromResources(resources: ITranslationResource[]): ITranslationMatrix {
	const namespaceResources = new Map<string, ITranslationResource[]>();
	for (const resource of resources) {
		const namespace = resource.namespace ?? (resource.origin.type === 'file' ? reactResourceIdentity(resource.origin.path).namespace : 'translation');
		const group = namespaceResources.get(namespace) ?? [];
		group.push(resource);
		namespaceResources.set(namespace, group);
	}
	const valuesByLocale = new Map<string, Record<string, string>>();
	for (const [namespace, group] of namespaceResources) {
		for (const [locale, content] of mergeTranslationResources(group)) {
			const values = valuesByLocale.get(locale) ?? {};
			for (const [key, value] of Object.entries(flattenTranslations(content))) values[qualifyReactKey(namespace, key)] = value;
			valuesByLocale.set(locale, values);
		}
	}
	const locales = [...valuesByLocale.keys()].sort((a, b) => a.localeCompare(b));
	const keys = [...new Set([...valuesByLocale.values()].flatMap((values) => Object.keys(values)))].sort((a, b) => a.localeCompare(b));
	const rows = keys.map((key) => ({
		key,
		values: Object.fromEntries(locales.map((locale) => [locale, valuesByLocale.get(locale)?.[key] ?? ''])),
		keyPresence: Object.fromEntries(locales.map((locale) => [locale, Object.hasOwn(valuesByLocale.get(locale) ?? {}, key)])),
		placeholders: Object.fromEntries(locales.map((locale) => [locale, extractReactPlaceholders(valuesByLocale.get(locale)?.[key] ?? '')]))
	}));
	return { locales, rows, totalKeys: keys.length };
}

async function collectFiles(context: IProjectContext, fs: IFileSystemAdapter, includes = context.config.includeTranslationGlobs): Promise<string[]> {
	const files = await fs.listFiles(context.projectRoot, includes, context.config.excludeGlobs);
	return files
		.map((file) => normalizePath(file))
		.filter((file) => file.toLowerCase().endsWith('.json') && context.config.supportedTranslationExtensions.some((extension) => extension.toLowerCase() === '.json'))
		.sort((a, b) => a.localeCompare(b));
}

async function readResources(
	files: string[],
	fs: IFileSystemAdapter,
	sourceIndex = 0,
	sourceId = 'filesystem-1',
	offset = 0,
	defaultNamespace = 'translation'
): Promise<ITranslationResource[]> {
	const resources: ITranslationResource[] = [];
	for (const [resourceIndex, filePath] of files.entries()) {
		resources.push({
			...reactResourceIdentity(filePath, defaultNamespace),
			sourceType: 'filesystem',
			sourceId,
			sourceIndex,
			resourceIndex,
			position: offset + resourceIndex,
			content: await readTranslationJson(fs, filePath),
			origin: { type: 'file', path: normalizePath(filePath) },
			writable: true
		});
	}
	return resources;
}

async function readProjectSources(context: IProjectContext, fs: IFileSystemAdapter): Promise<{ filePath: string; content: string }[]> {
	const files = await fs.listFiles(context.projectRoot, context.config.includeSourceGlobs, context.config.excludeGlobs);
	const sources: { filePath: string; content: string }[] = [];
	for (const filePath of files.map((file) => normalizePath(file)).sort((a, b) => a.localeCompare(b))) {
		if (/\.[jt]sx?$/.test(filePath)) sources.push({ filePath, content: await fs.readFile(filePath) });
	}
	return sources;
}

async function collectReactResources(context: IProjectContext, fs: IFileSystemAdapter): Promise<ITranslationResource[]> {
	const { detectReactDefaultNamespace } = await import('./react-config.analyzer.js');
	const resources: ITranslationResource[] = [];
	const defaultNamespace = detectReactDefaultNamespace(await readProjectSources(context, fs));
	for (const [sourceIndex, source] of (context.config.translationSources ?? [{ type: 'filesystem' as const }]).entries()) {
		if (source.type !== 'filesystem') throw new Error('The React adapter currently supports local JSON translation sources only.');
		const files = await collectFiles(context, fs, source.includeGlobs ?? context.config.includeTranslationGlobs);
		resources.push(...(await readResources(files, fs, sourceIndex, source.id ?? `filesystem-${sourceIndex + 1}`, resources.length, defaultNamespace)));
	}
	return resources;
}

/** React scanner for namespace-scoped hook calls and local JSON translation resources. */
export const reactScanAdapter: IScanAdapter = {
	id: 'react',
	framework: 'react',
	capabilities: { templateParsing: true, typescriptParsing: true, translationFormats: ['json'] },
	extractPlaceholders: extractReactPlaceholders,

	async resolveTranslationWriteTarget(context, fs, locale, key) {
		const separator = key.indexOf(':');
		const namespace = separator < 0 ? 'translation' : key.slice(0, separator);
		const relativeKey = separator < 0 ? key : key.slice(separator + 1);
		const resources = await collectReactResources(context, fs);
		const resource = resources
			.reverse()
			.find((entry) => entry.writable && entry.origin.type === 'file' && entry.locale.toLowerCase() === locale.trim().toLowerCase() && entry.namespace === namespace);
		if (!resource || resource.origin.type !== 'file') throw new Error(`No translation file found for locale "${locale}" in namespace "${namespace}".`);
		return { filePath: resource.origin.path, key: relativeKey };
	},

	async detect(projectRoot, fs) {
		let root = normalizePath(projectRoot);
		while (root) {
			const packagePath = normalizePath(`${root}/package.json`);
			if (await fs.fileExists(packagePath)) {
				try {
					const manifest = JSON.parse(await fs.readFile(packagePath)) as {
						dependencies?: Record<string, string>;
						devDependencies?: Record<string, string>;
					} | null;
					const dependencies = { ...manifest?.dependencies, ...manifest?.devDependencies };
					if (dependencies.react && dependencies['react-i18next']) {
						return { supported: true, confidence: 1, resolvedProjectRoot: root, reason: 'Detected React and react-i18next dependencies.' };
					}
				} catch {
					// Unreadable or invalid package metadata is not evidence of a supported project.
				}
			}
			const parent = root.slice(0, root.lastIndexOf('/'));
			if (!root.includes('/') || parent === root || /^[A-Za-z]:\/?$/.test(root) || root === '/') break;
			root = parent || '/';
		}
		return { supported: false, confidence: 0, reason: 'No React and react-i18next dependencies found.' };
	},

	collectTranslationFiles: collectFiles,

	collectTranslationResources: collectReactResources,

	async extractDefinedKeys(files, fs) {
		return matrixFromResources(await readResources(files, fs)).rows.map((row) => row.key);
	},

	async extractDefinedKeysFromResources(resources) {
		return matrixFromResources(resources).rows.map((row) => row.key);
	},

	async buildTranslationMatrix(files, fs) {
		return matrixFromResources(await readResources(files, fs));
	},

	async buildTranslationMatrixFromResources(resources) {
		return matrixFromResources(resources);
	},

	async extractUsedKeys(context, fs) {
		const [{ detectReactDefaultNamespace }, { extractReactUsages }] = await Promise.all([import('./react-config.analyzer.js'), import('./react-usage.extractor.js')]);
		const sources = await readProjectSources(context, fs);
		const defaultNamespace = detectReactDefaultNamespace(sources);
		return sources.flatMap(({ filePath, content }) => extractReactUsages(filePath, content, defaultNamespace));
	},

	async runRules({ definedKeys, usedKeys, translationMatrix, baseLocale }) {
		const plural = resolveReactPluralUsages(this.id, usedKeys, translationMatrix);
		const staticUsages = plural.usages.filter((usage) => !usage.isDynamic);
		const dynamicUsages = plural.usages.filter((usage) => usage.isDynamic);
		const defined = new Set(definedKeys);
		const usagesByKey = new Map<string, IKeyUsage[]>();
		for (const usage of staticUsages) {
			const usages = usagesByKey.get(usage.key) ?? [];
			usages.push(usage);
			usagesByKey.set(usage.key, usages);
		}
		const findings: IFinding[] = [...plural.findings, ...reactPlaceholderFindings(this.id, staticUsages, translationMatrix, baseLocale, plural.familyKeys)];
		const addFinding = (
			key: string,
			status: 'used' | 'unused' | 'missing-in-language' | 'extra-in-language' | 'dynamic-uncertain',
			language?: string,
			usages = usagesByKey.get(key) ?? []
		): void => {
			const messages = {
				used: `Key "${key}" is used in project sources.`,
				unused: `Key "${key}" is not referenced by detected static usage patterns.`,
				'dynamic-uncertain': `Key "${key}" may be used through a dynamic lookup and cannot be confirmed statically.`,
				'missing-in-language': language ? `Key "${key}" is missing in locale "${language}".` : `Key "${key}" is used but not defined in discovered translations.`,
				'extra-in-language': `Key "${key}" exists in locale "${language ?? ''}" but not in base locale "${baseLocale ?? ''}".`
			};
			findings.push({
				id: `${status}:${key}${language ? `:${language}` : ''}`,
				adapterId: this.id,
				key,
				status,
				severity: status === 'used' ? 'info' : status === 'missing-in-language' ? 'error' : 'warning',
				message: messages[status],
				language,
				evidence: usages.map(({ filePath, line, column, snippet, matchType }) => ({ filePath, line, column, snippet, matchType }))
			});
		};

		for (const key of defined) {
			const dynamic = dynamicUsages.filter((usage) => matchesReactDynamicKey(usage, key));
			if (!usagesByKey.has(key) && dynamic.length > 0) {
				addFinding(key, 'dynamic-uncertain', undefined, dynamic);
			} else addFinding(key, usagesByKey.has(key) ? 'used' : 'unused');
		}
		for (const usage of dynamicUsages) {
			if ([...defined].some((key) => matchesReactDynamicKey(usage, key))) continue;
			findings.push({
				id: `dynamic:${usage.filePath}:${usage.sourceIndex ?? `${usage.line ?? 0}:${usage.column ?? 0}`}`,
				adapterId: this.id,
				key: usage.key,
				status: 'dynamic-uncertain',
				severity: 'warning',
				message: `Dynamic translation lookup "${usage.key}" cannot be resolved statically.`,
				evidence: [{ filePath: usage.filePath, line: usage.line, column: usage.column, snippet: usage.snippet, matchType: usage.matchType }]
			});
		}
		for (const key of usagesByKey.keys()) {
			if (defined.has(key)) continue;
			for (const locale of translationMatrix.locales.length > 0 ? translationMatrix.locales : [undefined]) addFinding(key, 'missing-in-language', locale);
		}
		const ordinaryFamilyKeys = new Set(usedKeys.filter((usage) => !usage.isDynamic && !usage.plural && plural.familyKeys.has(usage.key)).map((usage) => usage.key));
		for (const key of ordinaryFamilyKeys) {
			const row = translationMatrix.rows.find((item) => item.key === key);
			if (!row) continue;
			for (const locale of translationMatrix.locales) {
				if (!hasTranslationKey(row, locale))
					addFinding(
						key,
						'missing-in-language',
						locale,
						usedKeys.filter((usage) => !usage.isDynamic && !usage.plural && usage.key === key)
					);
			}
		}
		if (baseLocale) {
			for (const row of translationMatrix.rows) {
				if (plural.familyKeys.has(row.key)) continue;
				for (const locale of translationMatrix.locales.filter((value) => value !== baseLocale)) {
					if (hasTranslationKey(row, baseLocale) && !hasTranslationKey(row, locale)) addFinding(row.key, 'missing-in-language', locale);
					if (!hasTranslationKey(row, baseLocale) && hasTranslationKey(row, locale)) addFinding(row.key, 'extra-in-language', locale);
				}
			}
		}
		return findings.sort((a, b) => a.key.localeCompare(b.key) || (a.language ?? '').localeCompare(b.language ?? ''));
	}
};
