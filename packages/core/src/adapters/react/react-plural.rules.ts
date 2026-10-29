import { IFinding } from '../../models/finding.model.js';
import { ITranslationMatrix } from '../../models/scan-result.model.js';
import { hasTranslationKey } from '../../util/translation-matrix.util.js';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { escapeReactKey, matchesReactDynamicKey, reactPluralKey } from './react-key.util.js';

function pluralRules(locale: string, ordinal = false): Intl.PluralRules | undefined {
	const language = locale === 'dev' ? 'en' : locale.replaceAll('_', '-');
	try {
		if (Intl.PluralRules.supportedLocalesOf([language]).length === 0) return undefined;
		return new Intl.PluralRules(language, { type: ordinal ? 'ordinal' : 'cardinal' });
	} catch {
		return undefined;
	}
}

export function reactPluralRowApplies(key: string, locale: string): boolean {
	const match = reactPluralKey(key);
	if (!match || (match.category === 'zero' && !match.ordinal)) return true;
	const rules = pluralRules(locale, match.ordinal);
	return rules?.resolvedOptions().pluralCategories.includes(match.category) ?? false;
}

function familyPattern(base: string): string {
	const qualified = base.includes(':') ? base : `translation:${base}`;
	return `^${escapeReactKey(qualified)}(?:_(?:ordinal_)?(?:zero|one|two|few|many|other))?$`;
}

function missingPluralFinding(adapterId: string, usage: IKeyUsage, key: string, locale: string): IFinding {
	return {
		id: `missing-in-language:${key}:${locale}`,
		adapterId,
		key,
		status: 'missing-in-language',
		severity: 'error',
		language: locale,
		message: `Plural key "${key}" is required by a count-based lookup but missing in locale "${locale}".`,
		evidence: [{ filePath: usage.filePath, line: usage.line, column: usage.column, snippet: usage.snippet, matchType: usage.matchType }]
	};
}

function pluralCandidates(base: string, count: number, ordinal: boolean, rule: Intl.PluralRules, cardinal: Intl.PluralRules, has: (key: string) => boolean): string[] {
	const suffix = rule.select(count);
	return [
		...(!ordinal && count === 0 && has(`${base}_zero`) ? [`${base}_zero`] : []),
		`${base}_${ordinal ? 'ordinal_' : ''}${suffix}`,
		...(ordinal ? [`${base}_${cardinal.select(count)}`] : []),
		base
	];
}

function resolveLocaleUsage(
	key: string,
	plural: NonNullable<IKeyUsage['plural']>,
	locale: string,
	has: (key: string) => boolean
): { keys: string[]; missing: string[]; uncertain: boolean } {
	const ordinal = plural.ordinal === true;
	const rule = pluralRules(locale, ordinal);
	const cardinal = pluralRules(locale);
	if (!rule || !cardinal || plural.ordinal === 'dynamic') return { keys: [], missing: [], uncertain: true };
	if (typeof plural.count === 'number') {
		const candidates = pluralCandidates(key, plural.count, ordinal, rule, cardinal, has);
		const selected = candidates.find(has);
		return { keys: selected ? [selected] : [], missing: selected ? [] : [candidates[0]], uncertain: false };
	}
	const keys: string[] = [];
	const missing: string[] = [];
	let uncertain = false;
	for (const category of rule.resolvedOptions().pluralCategories) {
		const variant = `${key}_${ordinal ? 'ordinal_' : ''}${category}`;
		if (has(variant)) keys.push(variant);
		else if (has(key)) keys.push(key);
		else if (ordinal && cardinal.resolvedOptions().pluralCategories.some((suffix) => has(`${key}_${suffix}`))) uncertain = true;
		else missing.push(variant);
	}
	if (!ordinal && has(`${key}_zero`)) keys.push(`${key}_zero`);
	return { keys: [...new Set(keys)], missing, uncertain };
}

/** Resolves count-based lookups per locale and excludes plural families from flat cross-locale comparison. */
export function resolveReactPluralUsages(
	adapterId: string,
	usages: IKeyUsage[],
	matrix: ITranslationMatrix
): { usages: IKeyUsage[]; findings: IFinding[]; familyKeys: Set<string> } {
	const resolved: IKeyUsage[] = [];
	const findings = new Map<string, IFinding>();
	const rows = new Map(matrix.rows.map((row) => [row.key, row]));
	const families = new Set(usages.filter((usage) => usage.plural && !usage.isDynamic).map((usage) => usage.key));
	for (const usage of usages.filter((item) => item.plural && item.isDynamic)) {
		for (const row of matrix.rows) {
			const base = reactPluralKey(row.key)?.base;
			if (base && matchesReactDynamicKey(usage, base)) families.add(base);
		}
	}
	const familyKeys = new Set(matrix.rows.filter((row) => families.has(row.key) || families.has(reactPluralKey(row.key)?.base ?? '')).map((row) => row.key));
	for (const usage of usages) {
		if (!usage.plural || usage.isDynamic) {
			resolved.push(usage);
			continue;
		}
		if (matrix.locales.length === 0) {
			resolved.push({ ...usage, isDynamic: true, dynamicKeyPatterns: [familyPattern(usage.key)] });
		}
		for (const locale of matrix.locales) {
			const has = (key: string): boolean => {
				const row = rows.get(key);
				return row !== undefined && hasTranslationKey(row, locale);
			};
			const result = resolveLocaleUsage(usage.key, usage.plural, locale, has);
			for (const key of result.keys) resolved.push({ ...usage, key, locale });
			if (result.uncertain) resolved.push({ ...usage, locale, isDynamic: true, dynamicKeyPatterns: [familyPattern(usage.key)] });
			for (const key of result.missing) {
				const finding = missingPluralFinding(adapterId, usage, key, locale);
				const existing = findings.get(finding.id);
				if (existing) existing.evidence.push(...finding.evidence);
				else findings.set(finding.id, finding);
			}
		}
	}
	return { usages: resolved, findings: [...findings.values()], familyKeys };
}
