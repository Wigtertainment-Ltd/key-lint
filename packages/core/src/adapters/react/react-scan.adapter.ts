import { IFinding, IFileEvidence } from '../../models/finding.model.js';
import { ITranslationMatrix, ITranslationMatrixRow } from '../../models/scan-result.model.js';
import { ITranslationResource } from '../../models/translation-resource.model.js';
import { normalizePath } from '../../util/path.util.js';
import { readTranslationJson } from '../../util/translation-json.util.js';
import { hasTranslationKey } from '../../util/translation-matrix.util.js';
import { mergeTranslationResources } from '../../util/translation-resource.util.js';
import { IAdapterDetectionResult, IFileSystemAdapter, IKeyUsage, IProjectContext, IScanAdapter, ITranslationWriteTarget } from '../scan-adapter.interface.js';
import { matchesReactDynamicKey, qualifyReactKey, reactResourceIdentity } from './react-key.util.js';
import { extractReactPlaceholders } from './react-interpolation.util.js';
import { reactPlaceholderFindings } from './react-placeholder.rules.js';
import { resolveReactPluralUsages } from './react-plural.rules.js';

function flattenTranslations(content: Record<string, unknown>, prefix: string = ''): Record<string, string> {
	return Object.fromEntries(
		Object.entries(content).flatMap(([key, value]: [string, unknown]): [string, string][] => {
			const path: string = prefix ? `${prefix}.${key}` : key;
			if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
				return Object.entries(flattenTranslations(value as Record<string, unknown>, path));
			}
			return [[path, value === null ? '' : typeof value === 'string' ? value : (JSON.stringify(value) ?? '')]];
		})
	);
}

function matrixFromResources(resources: ITranslationResource[]): ITranslationMatrix {
	const namespaceResources: Map<string, ITranslationResource[]> = new Map<string, ITranslationResource[]>();
	for (const resource of resources) {
		const namespace: string = resource.namespace ?? (resource.origin.type === 'file' ? reactResourceIdentity(resource.origin.path).namespace : 'translation');
		const group: ITranslationResource[] = namespaceResources.get(namespace) ?? [];
		group.push(resource);
		namespaceResources.set(namespace, group);
	}
	const valuesByLocale: Map<string, Record<string, string>> = new Map<string, Record<string, string>>();
	for (const [namespace, group] of namespaceResources) {
		for (const [locale, content] of mergeTranslationResources(group)) {
			const values: Record<string, string> = valuesByLocale.get(locale) ?? {};
			for (const [key, value] of Object.entries(flattenTranslations(content))) {
				values[qualifyReactKey(namespace, key)] = value;
			}
			valuesByLocale.set(locale, values);
		}
	}
	const locales: string[] = [...valuesByLocale.keys()].sort((a: string, b: string): number => a.localeCompare(b));
	const keys: string[] = [...new Set([...valuesByLocale.values()].flatMap((values: Record<string, string>): string[] => Object.keys(values)))].sort(
		(a: string, b: string): number => a.localeCompare(b)
	);
	const rows: ITranslationMatrixRow[] = keys.map((key: string): ITranslationMatrixRow => ({
		key,
		values: Object.fromEntries(locales.map((locale: string): [string, string] => [locale, valuesByLocale.get(locale)?.[key] ?? ''])),
		keyPresence: Object.fromEntries(locales.map((locale: string): [string, boolean] => [locale, Object.hasOwn(valuesByLocale.get(locale) ?? {}, key)])),
		placeholders: Object.fromEntries(locales.map((locale: string): [string, string[]] => [locale, extractReactPlaceholders(valuesByLocale.get(locale)?.[key] ?? '')]))
	}));
	return { locales, rows, totalKeys: keys.length };
}

async function collectFiles(context: IProjectContext, fs: IFileSystemAdapter, includes: string[] = context.config.includeTranslationGlobs): Promise<string[]> {
	const files: string[] = await fs.listFiles(context.projectRoot, includes, context.config.excludeGlobs);
	return files
		.map((file: string): string => normalizePath(file))
		.filter(
			(file: string): boolean =>
				file.toLowerCase().endsWith('.json') && context.config.supportedTranslationExtensions.some((extension: string): boolean => extension.toLowerCase() === '.json')
		)
		.sort((a: string, b: string): number => a.localeCompare(b));
}

async function readResources(
	files: string[],
	fs: IFileSystemAdapter,
	sourceIndex: number = 0,
	sourceId: string = 'filesystem-1',
	offset: number = 0,
	defaultNamespace: string = 'translation'
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
	const files: string[] = await fs.listFiles(context.projectRoot, context.config.includeSourceGlobs, context.config.excludeGlobs);
	const sources: { filePath: string; content: string }[] = [];
	for (const filePath of files.map((file: string): string => normalizePath(file)).sort((a: string, b: string): number => a.localeCompare(b))) {
		if (/\.[jt]sx?$/.test(filePath)) {
			sources.push({ filePath, content: await fs.readFile(filePath) });
		}
	}
	return sources;
}

async function collectReactResources(context: IProjectContext, fs: IFileSystemAdapter): Promise<ITranslationResource[]> {
	const { detectReactDefaultNamespace }: typeof import('./react-config.analyzer.js') = await import('./react-config.analyzer.js');
	const resources: ITranslationResource[] = [];
	const defaultNamespace: string = detectReactDefaultNamespace(await readProjectSources(context, fs));
	for (const [sourceIndex, source] of (context.config.translationSources ?? [{ type: 'filesystem' as const }]).entries()) {
		if (source.type !== 'filesystem') {
			throw new Error('The React adapter currently supports local JSON translation sources only.');
		}
		const files: string[] = await collectFiles(context, fs, source.includeGlobs ?? context.config.includeTranslationGlobs);
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

	async resolveTranslationWriteTarget(context: IProjectContext, fs: IFileSystemAdapter, locale: string, key: string): Promise<ITranslationWriteTarget> {
		const separator: number = key.indexOf(':');
		const namespace: string = separator < 0 ? 'translation' : key.slice(0, separator);
		const relativeKey: string = separator < 0 ? key : key.slice(separator + 1);
		const resources: ITranslationResource[] = await collectReactResources(context, fs);
		const resource: ITranslationResource | undefined = resources
			.reverse()
			.find(
				(entry: ITranslationResource): boolean =>
					entry.writable && entry.origin.type === 'file' && entry.locale.toLowerCase() === locale.trim().toLowerCase() && entry.namespace === namespace
			);
		if (resource?.origin.type !== 'file') {
			throw new Error(`No translation file found for locale "${locale}" in namespace "${namespace}".`);
		}
		return { filePath: resource.origin.path, key: relativeKey };
	},

	async detect(projectRoot: string, fs: IFileSystemAdapter): Promise<IAdapterDetectionResult> {
		let root: string = normalizePath(projectRoot);
		while (root) {
			const packagePath: string = normalizePath(`${root}/package.json`);
			if (await fs.fileExists(packagePath)) {
				try {
					const manifest: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = JSON.parse(await fs.readFile(packagePath)) as {
						dependencies?: Record<string, string>;
						devDependencies?: Record<string, string>;
					} | null;
					const dependencies: Record<string, string> = { ...manifest?.dependencies, ...manifest?.devDependencies };
					if (dependencies.react && dependencies['react-i18next']) {
						return { supported: true, confidence: 1, resolvedProjectRoot: root, reason: 'Detected React and react-i18next dependencies.' };
					}
				} catch {
					// Unreadable or invalid package metadata is not evidence of a supported project.
				}
			}
			const parent: string = root.slice(0, root.lastIndexOf('/'));
			if (!root.includes('/') || parent === root || /^[A-Za-z]:\/?$/.test(root) || root === '/') {
				break;
			}
			root = parent || '/';
		}
		return { supported: false, confidence: 0, reason: 'No React and react-i18next dependencies found.' };
	},

	collectTranslationFiles: collectFiles,

	collectTranslationResources: collectReactResources,

	async extractDefinedKeys(files: string[], fs: IFileSystemAdapter): Promise<string[]> {
		return matrixFromResources(await readResources(files, fs)).rows.map((row: ITranslationMatrixRow): string => row.key);
	},

	async extractDefinedKeysFromResources(resources: ITranslationResource[]): Promise<string[]> {
		return Promise.resolve(matrixFromResources(resources).rows.map((row: ITranslationMatrixRow): string => row.key));
	},

	async buildTranslationMatrix(files: string[], fs: IFileSystemAdapter): Promise<ITranslationMatrix> {
		return matrixFromResources(await readResources(files, fs));
	},

	async buildTranslationMatrixFromResources(resources: ITranslationResource[]): Promise<ITranslationMatrix> {
		return Promise.resolve(matrixFromResources(resources));
	},

	async extractUsedKeys(context: IProjectContext, fs: IFileSystemAdapter): Promise<IKeyUsage[]> {
		const [{ detectReactDefaultNamespace }, { extractReactUsages }]: [typeof import('./react-config.analyzer.js'), typeof import('./react-usage.extractor.js')] =
			await Promise.all([import('./react-config.analyzer.js'), import('./react-usage.extractor.js')]);
		const sources: { filePath: string; content: string }[] = await readProjectSources(context, fs);
		const defaultNamespace: string = detectReactDefaultNamespace(sources);
		return sources.flatMap(({ filePath, content }: { filePath: string; content: string }): IKeyUsage[] => extractReactUsages(filePath, content, defaultNamespace));
	},

	async runRules({ definedKeys, usedKeys, translationMatrix, baseLocale }: Parameters<IScanAdapter['runRules']>[0]): Promise<IFinding[]> {
		const plural: { usages: IKeyUsage[]; findings: IFinding[]; familyKeys: Set<string> } = resolveReactPluralUsages(this.id, usedKeys, translationMatrix);
		const staticUsages: IKeyUsage[] = plural.usages.filter((usage: IKeyUsage): boolean => !usage.isDynamic);
		const dynamicUsages: IKeyUsage[] = plural.usages.filter((usage: IKeyUsage): boolean | undefined => usage.isDynamic);
		const defined: Set<string> = new Set<string>(definedKeys);
		const usagesByKey: Map<string, IKeyUsage[]> = new Map<string, IKeyUsage[]>();
		for (const usage of staticUsages) {
			const usages: IKeyUsage[] = usagesByKey.get(usage.key) ?? [];
			usages.push(usage);
			usagesByKey.set(usage.key, usages);
		}
		const findings: IFinding[] = [...plural.findings, ...reactPlaceholderFindings(this.id, staticUsages, translationMatrix, baseLocale, plural.familyKeys)];
		const addFinding: (
			key: string,
			status: 'used' | 'unused' | 'missing-in-language' | 'extra-in-language' | 'dynamic-uncertain',
			language?: string,
			usages?: IKeyUsage[]
		) => void = (
			key: string,
			status: 'used' | 'unused' | 'missing-in-language' | 'extra-in-language' | 'dynamic-uncertain',
			language?: string,
			usages: IKeyUsage[] = usagesByKey.get(key) ?? []
		): void => {
			const messages: Record<typeof status, string> = {
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
				evidence: usages.map(({ filePath, line, column, snippet, matchType }: IKeyUsage): IFileEvidence => ({ filePath, line, column, snippet, matchType }))
			});
		};

		for (const key of defined) {
			const dynamic: IKeyUsage[] = dynamicUsages.filter((usage: IKeyUsage): boolean => matchesReactDynamicKey(usage, key));
			if (!usagesByKey.has(key) && dynamic.length > 0) {
				addFinding(key, 'dynamic-uncertain', undefined, dynamic);
			} else {
				addFinding(key, usagesByKey.has(key) ? 'used' : 'unused');
			}
		}
		for (const usage of dynamicUsages) {
			if ([...defined].some((key: string): boolean => matchesReactDynamicKey(usage, key))) {
				continue;
			}
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
			if (defined.has(key)) {
				continue;
			}
			for (const locale of translationMatrix.locales.length > 0 ? translationMatrix.locales : [undefined]) {
				addFinding(key, 'missing-in-language', locale);
			}
		}
		const ordinaryFamilyKeys: Set<string> = new Set<string>(
			usedKeys.filter((usage: IKeyUsage): boolean => !usage.isDynamic && !usage.plural && plural.familyKeys.has(usage.key)).map((usage: IKeyUsage): string => usage.key)
		);
		for (const key of ordinaryFamilyKeys) {
			const row: ITranslationMatrixRow | undefined = translationMatrix.rows.find((item: ITranslationMatrixRow): boolean => item.key === key);
			if (!row) {
				continue;
			}
			for (const locale of translationMatrix.locales) {
				if (!hasTranslationKey(row, locale)) {
					addFinding(
						key,
						'missing-in-language',
						locale,
						usedKeys.filter((usage: IKeyUsage): boolean => !usage.isDynamic && !usage.plural && usage.key === key)
					);
				}
			}
		}
		if (baseLocale) {
			for (const row of translationMatrix.rows) {
				if (plural.familyKeys.has(row.key)) {
					continue;
				}
				for (const locale of translationMatrix.locales.filter((value: string): boolean => value !== baseLocale)) {
					if (hasTranslationKey(row, baseLocale) && !hasTranslationKey(row, locale)) {
						addFinding(row.key, 'missing-in-language', locale);
					}
					if (!hasTranslationKey(row, baseLocale) && hasTranslationKey(row, locale)) {
						addFinding(row.key, 'extra-in-language', locale);
					}
				}
			}
		}
		return Promise.resolve(findings.sort((a: IFinding, b: IFinding): number => a.key.localeCompare(b.key) || (a.language ?? '').localeCompare(b.language ?? '')));
	}
};
