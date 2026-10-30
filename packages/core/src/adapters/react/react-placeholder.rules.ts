import { IFinding } from '../../models/finding.model.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { hasTranslationKey } from '../../util/translation-matrix.util.js';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { reactPluralRowApplies } from './react-plural.rules.js';

function usagePlaceholderFindings(adapterId: string, usage: IKeyUsage, required: string[]): IFinding[] {
	const parameters = usage.placeholderParameters ?? { kind: 'absent', names: [] };
	const missing = required.filter((name) => !parameters.names.includes(name));
	const uncertain = (name: string): boolean => parameters.kind === 'dynamic' || (parameters.dynamicPrefixes ?? []).some((prefix) => name.startsWith(`${prefix}.`));
	const groups = [
		{ status: 'placeholder-missing' as const, severity: 'error' as const, names: missing.filter((name) => !uncertain(name)) },
		{ status: 'placeholder-uncertain' as const, severity: 'warning' as const, names: missing.filter(uncertain) }
	];
	return groups
		.filter((group) => group.names.length > 0)
		.map(({ status, severity, names }) => ({
			id: `${status}:${usage.key}:${usage.filePath}:${usage.sourceIndex ?? `${usage.line ?? 0}:${usage.column ?? 0}`}${usage.locale ? `:${usage.locale}` : ''}`,
			adapterId,
			...(usage.locale ? { language: usage.locale } : {}),
			key: usage.key,
			status,
			severity,
			message:
				status === 'placeholder-missing'
					? `Key "${usage.key}" is used without required placeholder(s): ${names.join(', ')}.`
					: `Required placeholder(s) for key "${usage.key}" cannot be verified statically: ${names.join(', ')}.`,
			evidence: [{ filePath: usage.filePath, line: usage.line, column: usage.column, snippet: usage.snippet, matchType: usage.matchType }],
			placeholderDetails: { required, provided: parameters.names, missing: names }
		}));
}

/** Checks source parameters against the base locale and compares placeholder contracts across locales. */
export function reactPlaceholderFindings(adapterId: string, usages: IKeyUsage[], matrix: ITranslationMatrix, baseLocale?: string, pluralKeys?: Set<string>): IFinding[] {
	if (!baseLocale) return [];
	const findings: IFinding[] = [];
	for (const row of matrix.rows) {
		for (const usage of usages.filter((item) => !item.isDynamic && item.key === row.key)) {
			const locale = usage.locale ?? baseLocale;
			if (hasTranslationKey(row, locale)) findings.push(...usagePlaceholderFindings(adapterId, usage, row.placeholders?.[locale] ?? []));
		}
		if (!hasTranslationKey(row, baseLocale)) continue;
		const required = row.placeholders?.[baseLocale] ?? [];
		for (const locale of matrix.locales) {
			if (locale === baseLocale || !hasTranslationKey(row, locale)) continue;
			if (pluralKeys?.has(row.key) && (!reactPluralRowApplies(row.key, baseLocale) || !reactPluralRowApplies(row.key, locale))) continue;
			const actual = row.placeholders?.[locale] ?? [];
			if (required.length === actual.length && required.every((name) => actual.includes(name))) continue;
			findings.push({
				id: `placeholder-mismatch:${row.key}:${locale}`,
				adapterId,
				key: row.key,
				status: 'placeholder-mismatch',
				severity: 'error',
				language: locale,
				message: `Key "${row.key}" uses placeholder(s) [${actual.join(', ')}] in locale "${locale}", but base locale "${baseLocale}" requires [${required.join(', ')}].`,
				evidence: [],
				placeholderDetails: { required, expected: required, actual }
			});
		}
	}
	return findings;
}
