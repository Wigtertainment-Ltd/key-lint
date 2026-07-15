import {
	FileSystemAdapter,
	KeyUsage,
	ProjectContext,
	ScanAdapter
} from '../../core/adapters/scan-adapter.interface';
import { Finding } from '../../core/models/finding.model';
import { TranslationMatrix } from '../../core/models/scan-result.model';

interface PatternDescriptor {
	matchType: string;
	regex: RegExp;
	dynamic: boolean;
	keyCaptureIndex?: number;
	literalKeyExtraction?: boolean;
}

const STATIC_HTML_PATTERNS: PatternDescriptor[] = [
	{
		matchType: 'html-pipe-translate-interpolation',
		regex: /\{\{\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*translate\b[^}]*\}\}/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-pipe-translate-binding',
		regex: /=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-attribute-translate',
		regex: /\btranslate\s*=\s*['"]([A-Za-z0-9_.-]+)['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-bound-translate',
		regex: /\[translate\]\s*=\s*['"]\s*['"`]([A-Za-z0-9_.-]+)['"`]\s*['"]/g,
		dynamic: false,
		keyCaptureIndex: 1
	}
];

const STATIC_TS_PATTERNS: PatternDescriptor[] = [
	{
		matchType: 'ts-translate-method',
		regex: /\b(?:this\.)?[A-Za-z_$][\w$]*(?:translate|i18n|transloco)[\w$]*\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*['"`]([A-Za-z0-9_.-]+)['"`]/gi,
		dynamic: false,
		keyCaptureIndex: 1
	},
	{
		matchType: 'ts-translate-call',
		regex: /\.\s*translate\s*\(([^)]*)\)/g,
		dynamic: false,
		keyCaptureIndex: 1,
		literalKeyExtraction: true
	}
];

const DYNAMIC_PATTERNS: PatternDescriptor[] = [
	{
		matchType: 'ts-dynamic-template-literal',
		regex: /\b(?:this\.)?[A-Za-z_$][\w$]*(?:translate|i18n|transloco)[\w$]*\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*`([^`]*\$\{[^}]+\}[^`]*)`\s*\)/gi,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'ts-dynamic-concat',
		regex: /\b(?:this\.)?[A-Za-z_$][\w$]*(?:translate|i18n|transloco)[\w$]*\s*\.\s*(?:instant|get|stream|translate)\s*\(\s*([^)\n]*\+[^)\n]*)\)/gi,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-translate-binding',
		regex: /\[translate\]\s*=\s*['"]([^'"\n]*\+[^'"\n]*)['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-interpolation',
		regex: /\{\{\s*([^}\n]*\+[^}\n]*?)\s*\|\s*translate\b[^}]*\}\}/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-concat-binding',
		regex: /=\s*['"]\s*([^'"\n]*\+[^'"\n]*?)\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	},
	{
		matchType: 'html-dynamic-pipe-template-literal',
		regex: /=\s*['"]\s*(`[^`]*\$\{[^}]+\}[^`]*`)\s*\|\s*translate\b[^'"\n]*['"]/g,
		dynamic: true,
		keyCaptureIndex: 1
	}
];

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

function getLineColumn(source: string, index: number): { line: number; column: number } {
	let line = 1;
	let column = 1;

	for (let i = 0; i < index; i += 1) {
		if (source[i] === '\n') {
			line += 1;
			column = 1;
			continue;
		}

		column += 1;
	}

	return { line, column };
}

function extractSnippet(source: string, index: number): string {
	const lineStart = source.lastIndexOf('\n', index - 1) + 1;
	const lineEndIndex = source.indexOf('\n', index);
	const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
	const currentLine = source.slice(lineStart, lineEnd).trim();

	if (currentLine) {
		return currentLine;
	}

	const from = Math.max(0, index - 80);
	const to = Math.min(source.length, index + 120);
	return source.slice(from, to).replace(/\s+/g, ' ').trim();
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

function firstCallArgument(argumentList: string): string {
	let depth = 0;
	let stringDelimiter: string | null = null;

	for (let i = 0; i < argumentList.length; i += 1) {
		const char = argumentList[i];

		if (stringDelimiter) {
			if (char === stringDelimiter && argumentList[i - 1] !== '\\') {
				stringDelimiter = null;
			}
			continue;
		}

		if (char === '\'' || char === '"' || char === '`') {
			stringDelimiter = char;
			continue;
		}

		if (char === '(' || char === '[' || char === '{') {
			depth += 1;
			continue;
		}

		if (char === ')' || char === ']' || char === '}') {
			depth -= 1;
			continue;
		}

		if (char === ',' && depth === 0) {
			return argumentList.slice(0, i);
		}
	}

	return argumentList;
}

function leadingLiteralPrefix(expression: string): string | null {
	const match = /['"`]([A-Za-z0-9_.-]*)['"`]/.exec(expression);
	if (!match) {
		return null;
	}

	const prefix = match[1];
	return prefix.endsWith('.') ? prefix : null;
}

function extractMatches(source: string, filePath: string, descriptors: PatternDescriptor[]): KeyUsage[] {	const matches: KeyUsage[] = [];

	for (const descriptor of descriptors) {
		const regex = new RegExp(descriptor.regex.source, descriptor.regex.flags);
		let match: RegExpExecArray | null = regex.exec(source);

		while (match) {
			const keyIndex = descriptor.keyCaptureIndex ?? 1;
			const rawKey = match[keyIndex]?.trim();
			const snippet = extractSnippet(source, match.index);

			if (descriptor.literalKeyExtraction) {
				const argumentSource = firstCallArgument(match[keyIndex] ?? '');
				const lineCol = getLineColumn(source, match.index);
				const isDynamicArgument = /\+/.test(argumentSource) || /`[^`]*\$\{[^}]+\}[^`]*`/.test(argumentSource);

				if (isDynamicArgument) {
					matches.push({
						key: argumentSource.trim(),
						filePath,
						line: lineCol.line,
						column: lineCol.column,
						snippet,
						matchType: 'ts-dynamic-translate-call',
						isDynamic: true
					});

					match = regex.exec(source);
					continue;
				}

				const literalRegex = /['"`]([A-Za-z0-9_.-]+)['"`]/g;
				let literalMatch: RegExpExecArray | null = literalRegex.exec(argumentSource);

				while (literalMatch) {
					const literalKey = literalMatch[1]?.trim();
					if (literalKey) {
						matches.push({
							key: literalKey,
							filePath,
							line: lineCol.line,
							column: lineCol.column,
							snippet,
							matchType: descriptor.matchType,
							isDynamic: descriptor.dynamic
						});
					}

					literalMatch = literalRegex.exec(argumentSource);
				}

				match = regex.exec(source);
				continue;
			}

			if (rawKey) {
				const lineCol = getLineColumn(source, match.index);
				matches.push({
					key: rawKey,
					filePath,
					line: lineCol.line,
					column: lineCol.column,
					snippet,
					matchType: descriptor.matchType,
					isDynamic: descriptor.dynamic
				});
			}

			match = regex.exec(source);
		}
	}

	return matches;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function flattenTranslationValueObject(
	value: unknown,
	prefix = '',
	collector: Record<string, string>
): void {
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

interface AngularMarkers {
	root: string;
	hasAngularJson: boolean;
	hasNxJson: boolean;
	hasWorkspaceJson: boolean;
	hasProjectJson: boolean;
	hasPackageJson: boolean;
	hasAngularDependency: boolean;
}

async function readPackageJsonDependencies(
	root: string,
	fs: FileSystemAdapter
): Promise<{ hasPackageJson: boolean; hasAngularDependency: boolean }> {
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

function scoreMarkers(markers: AngularMarkers): number {
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

function buildReason(markers: AngularMarkers): string {
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

export const angularScanAdapter: ScanAdapter = {
	id: 'angular',
	framework: 'angular',
	capabilities: {
		templateParsing: true,
		typescriptParsing: true,
		translationFormats: ['json']
	},

	async detect(projectRoot: string, fs: FileSystemAdapter) {
		const normalizedStart = normalizePath(projectRoot);
		const candidates = collectCandidateRoots(normalizedStart);

		let best: { markers: AngularMarkers; confidence: number } | null = null;

		for (const root of candidates) {
			const [hasAngularJson, hasNxJson, hasWorkspaceJson, hasProjectJson, packageInfo] = await Promise.all([
				fs.fileExists(joinPath(root, 'angular.json')),
				fs.fileExists(joinPath(root, 'nx.json')),
				fs.fileExists(joinPath(root, 'workspace.json')),
				fs.fileExists(joinPath(root, 'project.json')),
				readPackageJsonDependencies(root, fs)
			]);

			const markers: AngularMarkers = {
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

	async collectTranslationFiles(context: ProjectContext, fs: FileSystemAdapter) {
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

	async extractDefinedKeys(translationFiles: string[], fs: FileSystemAdapter) {
		const allKeys: string[] = [];

		for (const filePath of translationFiles) {
			try {
				const raw = await fs.readFile(filePath);
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				allKeys.push(...flattenTranslationObject(parsed));
			} catch {
				// Parse errors are handled as findings later when rule pipeline carries parse diagnostics.
			}
		}

		return uniqueSorted(allKeys);
	},

	async buildTranslationMatrix(translationFiles: string[], fs: FileSystemAdapter): Promise<TranslationMatrix> {
		const localeToValues = new Map<string, Record<string, string>>();

		for (const filePath of translationFiles) {
			try {
				const raw = await fs.readFile(filePath);
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				const locale = inferLocaleFromTranslationFile(filePath);
				const flattened: Record<string, string> = {};
				flattenTranslationValueObject(parsed, '', flattened);

				const existing = localeToValues.get(locale) ?? {};
				localeToValues.set(locale, {
					...existing,
					...flattened
				});
			} catch {
				// Invalid translation files are ignored here and reflected by findings/rule checks.
			}
		}

		const locales = uniqueSorted([...localeToValues.keys()]);
		const allKeys = uniqueSorted(
			locales.flatMap((locale) => Object.keys(localeToValues.get(locale) ?? {}))
		);

		const rows = allKeys.map((key) => {
			const values: Record<string, string> = {};
			for (const locale of locales) {
				const localeValues = localeToValues.get(locale) ?? {};
				values[locale] = localeValues[key] ?? '';
			}

			return { key, values };
		});

		return {
			locales,
			rows,
			totalKeys: rows.length
		};
	},

	async extractUsedKeys(context: ProjectContext, fs: FileSystemAdapter) {
		const sourceFiles = await fs.listFiles(
			context.projectRoot,
			context.config.includeSourceGlobs,
			context.config.excludeGlobs
		);

		const used: KeyUsage[] = [];

		for (const filePath of sourceFiles.map((file) => normalizePath(file)).sort((a, b) => a.localeCompare(b))) {
			if (matchesAny(filePath, context.config.excludeGlobs)) {
				continue;
			}

			const source = await fs.readFile(filePath);
			const descriptors = filePath.endsWith('.html')
				? [...STATIC_HTML_PATTERNS, ...DYNAMIC_PATTERNS]
				: [...STATIC_TS_PATTERNS, ...STATIC_HTML_PATTERNS, ...DYNAMIC_PATTERNS];
			used.push(...extractMatches(source, filePath, descriptors));
		}

		return used;
	},

	async runRules(input: { definedKeys: string[]; usedKeys: KeyUsage[]; context: ProjectContext }) {
		const findings: Finding[] = [];
		const staticUsage = new Set<string>();
		const dynamicUsage = new Map<string, KeyUsage>();
		const dynamicPrefixes = new Map<string, KeyUsage>();
		const allDefined = new Set(input.definedKeys);

		for (const usage of input.usedKeys) {
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

		const matchDynamicPrefix = (key: string): KeyUsage | undefined => {
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

		for (const usedKey of uniqueSorted([...staticUsage])) {
			if (allDefined.has(usedKey)) {
				continue;
			}

			const evidence = input.usedKeys.filter((usage) => !usage.isDynamic && usage.key === usedKey);
			findings.push({
				id: `missing:${usedKey}`,
				adapterId: this.id,
				key: usedKey,
				status: 'missing-in-language',
				severity: 'error',
				message: `Key "${usedKey}" is used but not present in discovered translation files.`,
				evidence: evidence.map((usage) => ({
					filePath: usage.filePath,
					line: usage.line,
					column: usage.column,
					snippet: usage.snippet,
					matchType: usage.matchType
				}))
			});
		}

		return findings.sort((a, b) => a.key.localeCompare(b.key));
	}
};
