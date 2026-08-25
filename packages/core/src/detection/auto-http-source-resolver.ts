import { IAutoHttpTranslationSourceConfig, IHttpTranslationSourceConfig, ITranslationSourceConfig } from '../config/config.interfaces.js';
import { parseScannerConfigOverrides } from '../config/scanner-config.js';
import { ILoaderDetectionDiagnostic, ITranslationLoaderCandidate } from './loader-detection.interfaces.js';

export type AutoHttpResolutionErrorCode = 'auto-http-no-candidate' | 'auto-http-multiple-candidates' | 'auto-http-selection-invalid' | 'auto-http-origin-required' | 'auto-http-locales-required' | 'auto-http-invalid-url';

export class AutoHttpResolutionError extends Error {
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

function manualFallback(): string {
	return 'Use an explicit HTTP source as a fallback, for example: { "type": "http", "id": "translations", "urlTemplate": "https://example.com/i18n/{locale}.json", "locales": ["en"] }.';
}

function candidateLocation(candidate: ITranslationLoaderCandidate): string {
	return `${candidate.location.filePath}:${candidate.location.line}:${candidate.location.column}`;
}

function diagnosticLocation(diagnostic: ILoaderDetectionDiagnostic): string {
	return `${diagnostic.location.filePath}:${diagnostic.location.line}:${diagnostic.location.column}`;
}

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

export function formatAutoHttpCandidate(candidate: ITranslationLoaderCandidate, index: number): string {
	return `${index + 1}. ${candidate.framework}/${candidate.api} at ${candidateLocation(candidate)} -> ${candidate.resources.map((resource) => redactAutoHttpUrlTemplate(resource.urlTemplate)).join(', ')}`;
}

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
