import { IAutoHttpTranslationSourceConfig, IHttpTranslationSourceConfig, ITranslationSourceConfig } from '../config/config.interfaces.js';
import { parseScannerConfigOverrides } from '../config/scanner-config.js';
import { ILoaderDetectionDiagnostic, ITranslationLoaderCandidate } from './loader-detection.interfaces.js';

export type AutoHttpResolutionErrorCode = 'auto-http-no-candidate' | 'auto-http-multiple-candidates' | 'auto-http-selection-invalid' | 'auto-http-origin-required' | 'auto-http-locales-required' | 'auto-http-invalid-url';

export class AutoHttpResolutionError extends Error {
	/**
	 * Creates a resolution failure retaining analysis evidence for manual selection or diagnostics.
	 *
	 * @param code - Machine-readable resolution failure category.
	 * @param message - Human-readable explanation supplied by the caller.
	 * @param candidates - Detected candidates retained by reference; defaults to an empty list.
	 * @param diagnostics - Analysis diagnostics retained by reference; defaults to an empty list.
	 */
	constructor(
		readonly code: AutoHttpResolutionErrorCode,
		message: string,
		readonly candidates: readonly ITranslationLoaderCandidate[] = [],
		readonly diagnostics: readonly ILoaderDetectionDiagnostic[] = []
	) {
		super(message);
		this.name = 'AutoHttpResolutionError';
	}
}

export interface IAutoHttpProjectAnalysis {
	candidates: ITranslationLoaderCandidate[];
	diagnostics: ILoaderDetectionDiagnostic[];
	sourceFiles: string[];
}

export interface IResolvedAutoHttpSource {
	sourceIndex: number;
	candidateIndex: number;
	candidate: ITranslationLoaderCandidate;
	sources: IHttpTranslationSourceConfig[];
}

export interface IExpandedAutoHttpSources {
	translationSources: ITranslationSourceConfig[];
	resolved: IResolvedAutoHttpSource[];
}

/**
 * Supplies an explicit HTTP configuration example for automatic-resolution failures.
 *
 * @returns A human-readable fallback instruction with a sample source definition.
 */
function manualFallback(): string {
	return 'Use an explicit HTTP source as a fallback, for example: { "type": "http", "id": "translations", "urlTemplate": "https://example.com/i18n/{locale}.json", "locales": ["en"] }.';
}

/**
 * Formats the starting location of a detected loader.
 *
 * @param candidate - Loader candidate carrying source coordinates.
 * @returns File path, one-based line, and column separated by colons.
 */
function candidateLocation(candidate: ITranslationLoaderCandidate): string {
	return `${candidate.location.filePath}:${candidate.location.line}:${candidate.location.column}`;
}

/**
 * Formats the starting location of an analysis diagnostic.
 *
 * @param diagnostic - Diagnostic carrying source coordinates.
 * @returns File path, one-based line, and column separated by colons.
 */
function diagnosticLocation(diagnostic: ILoaderDetectionDiagnostic): string {
	return `${diagnostic.location.filePath}:${diagnostic.location.line}:${diagnostic.location.column}`;
}

/**
 * Removes fragments and redacts query values while preserving a locale placeholder for display.
 * Resolves non-HTTP-prefixed inputs against a dummy origin and displays only their path and query.
 * Does not validate credentials or redact user information in absolute HTTP(S) templates.
 *
 * @param value - Absolute or relative URL template to format.
 * @returns A display template with a redacted query, or `[invalid URL]` when parsing fails.
 */
export function redactAutoHttpUrlTemplate(value: string): string {
	const marker = '__KEYLINT_LOCALE__';
	const absolute = /^https?:\/\//i.test(value);
	try {
		const url = new URL(value.replace('{locale}', marker), absolute ? undefined : 'https://keylint.invalid');
		if (url.search) url.search = '?[redacted]';
		url.hash = '';
		const result = absolute ? url.toString() : `${url.pathname}${url.search}`;
		return result.replace(marker, '{locale}');
	} catch {
		return '[invalid URL]';
	}
}

/**
 * Formats a numbered loader candidate with its framework, API, location, and redacted endpoints.
 *
 * @param candidate - Detected loader to describe.
 * @param index - Zero-based candidate position, displayed as a one-based selection number.
 * @returns A single-line description suitable for selection diagnostics.
 */
export function formatAutoHttpCandidate(candidate: ITranslationLoaderCandidate, index: number): string {
	return `${index + 1}. ${candidate.framework}/${candidate.api} at ${candidateLocation(candidate)} -> ${candidate.resources.map((resource) => redactAutoHttpUrlTemplate(resource.urlTemplate)).join(', ')}`;
}

/**
 * Resolves a detected template into an absolute, credential-free HTTP(S) URL without requesting it.
 * Protects the locale placeholder during URL serialization and uses the configured origin when required.
 *
 * @param resource - Detected template and its origin requirement.
 * @param source - Auto-HTTP overrides supplying a relative URL's origin.
 * @param candidate - Candidate supplying diagnostic coordinates.
 * @param analysis - Candidate and diagnostic evidence attached to resolution failures.
 * @returns The absolute URL template with its locale placeholder restored.
 * @throws {AutoHttpResolutionError} When an origin is required, URL parsing fails, or scheme or credentials are invalid.
 */
function resolvedTemplate(resource: ITranslationLoaderCandidate['resources'][number], source: IAutoHttpTranslationSourceConfig, candidate: ITranslationLoaderCandidate, analysis: IAutoHttpProjectAnalysis): string {
	if (resource.requiresOrigin && !source.origin) {
		throw new AutoHttpResolutionError('auto-http-origin-required', `The detected relative translation URL "${redactAutoHttpUrlTemplate(resource.urlTemplate)}" at ${candidateLocation(candidate)} requires an origin in the auto-http source. No request was made. ${manualFallback()}`, analysis.candidates, analysis.diagnostics);
	}
	const marker = '__KEYLINT_LOCALE__';
	const input = resource.urlTemplate.replace('{locale}', marker);
	let parsed: URL;
	try {
		parsed = resource.requiresOrigin ? new URL(input, source.origin) : new URL(input);
	} catch {
		throw new AutoHttpResolutionError('auto-http-invalid-url', `The detected translation URL at ${candidateLocation(candidate)} could not be resolved safely. No request was made. ${manualFallback()}`, analysis.candidates, analysis.diagnostics);
	}
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
		throw new AutoHttpResolutionError('auto-http-invalid-url', `The detected translation URL at ${candidateLocation(candidate)} is not a credential-free HTTP(S) URL. No request was made. ${manualFallback()}`, analysis.candidates, analysis.diagnostics);
	}
	return parsed.toString().replace(marker, '{locale}');
}

/**
 * Expands a selected loader candidate into explicit HTTP sources without network access.
 * Source locales override detected locales when non-empty; resource order determines generated ID suffixes.
 * Final scanner-schema validation is left to the caller or expansion helper.
 *
 * @param source - Auto-HTTP source overrides for ID, origin, locales, and environment headers.
 * @param sourceIndex - Original source position used for metadata and fallback IDs.
 * @param candidateIndex - Zero-based index into the analysis candidate list.
 * @param analysis - Detected candidates and diagnostic evidence.
 * @returns The selected candidate and its generated HTTP source definitions.
 * @throws {AutoHttpResolutionError} When selection, locales, origin, or endpoint resolution is invalid.
 */
export function resolveAutoHttpCandidate(source: IAutoHttpTranslationSourceConfig, sourceIndex: number, candidateIndex: number, analysis: IAutoHttpProjectAnalysis): IResolvedAutoHttpSource {
	const candidate = analysis.candidates[candidateIndex];
	if (!candidate) throw new AutoHttpResolutionError('auto-http-selection-invalid', `The selected auto-http candidate ${candidateIndex + 1} does not exist. No request was made.`, analysis.candidates, analysis.diagnostics);
	const locales = source.locales?.length ? source.locales : candidate.locales;
	if (locales.length === 0) {
		throw new AutoHttpResolutionError('auto-http-locales-required', `The detected loader at ${candidateLocation(candidate)} has no static locales. Configure locales in the auto-http source before continuing. No request was made. ${manualFallback()}`, analysis.candidates, analysis.diagnostics);
	}
	const baseId = source.id ?? `auto-http-${sourceIndex + 1}`;
	const sources = candidate.resources.map((resource, resourceIndex): IHttpTranslationSourceConfig => ({
		type: 'http',
		id: candidate.resources.length === 1 ? baseId : `${baseId}-${resourceIndex + 1}`,
		urlTemplate: resolvedTemplate(resource, source, candidate, analysis),
		locales: [...locales],
		...(source.headersFromEnv ? { headersFromEnv: { ...source.headersFromEnv } } : {})
	}));
	return { sourceIndex, candidateIndex, candidate, sources };
}

/**
 * Replaces auto-HTTP entries with selected explicit HTTP sources while preserving configured order.
 * Selects the sole candidate automatically; multiple candidates require a per-source selection.
 * Validates the complete expanded list and retains non-auto source objects by reference.
 *
 * @param translationSources - Ordered configuration sources to expand.
 * @param analysis - Static loader analysis shared by the auto-HTTP sources.
 * @param selections - Optional map from original source indices to zero-based candidate indices.
 * @returns Expanded sources and resolution records identifying each selected candidate.
 * @throws {AutoHttpResolutionError} When candidates are absent, ambiguous, or cannot be resolved.
 * @throws {ScannerConfigError} When the expanded sources violate the scanner configuration schema.
 */
export function expandAutoHttpTranslationSources(translationSources: readonly ITranslationSourceConfig[], analysis: IAutoHttpProjectAnalysis, selections: ReadonlyMap<number, number> = new Map<number, number>()): IExpandedAutoHttpSources {
	const expanded: ITranslationSourceConfig[] = [];
	const resolved: IResolvedAutoHttpSource[] = [];
	for (const [sourceIndex, source] of translationSources.entries()) {
		if (source.type !== 'auto-http') {
			expanded.push(source);
			continue;
		}
		if (analysis.candidates.length === 0) {
			const locations = analysis.diagnostics.map((diagnostic) => `${diagnostic.code} at ${diagnosticLocation(diagnostic)}`).join('; ');
			throw new AutoHttpResolutionError('auto-http-no-candidate', `No compatible static ngx-translate or Transloco HTTP loader candidate was found. No request was made.${locations ? ` Diagnostics: ${locations}.` : ''} ${manualFallback()}`, analysis.candidates, analysis.diagnostics);
		}
		const selected = selections.get(sourceIndex);
		if (selected === undefined && analysis.candidates.length > 1) {
			throw new AutoHttpResolutionError('auto-http-multiple-candidates', `Multiple compatible translation loader candidates were found; the CLI will not guess. No request was made:\n${analysis.candidates.map(formatAutoHttpCandidate).join('\n')}\n${manualFallback()}`, analysis.candidates, analysis.diagnostics);
		}
		const item = resolveAutoHttpCandidate(source, sourceIndex, selected ?? 0, analysis);
		resolved.push(item);
		expanded.push(...item.sources);
	}
	parseScannerConfigOverrides({ translationSources: expanded });
	return { translationSources: expanded, resolved };
}
