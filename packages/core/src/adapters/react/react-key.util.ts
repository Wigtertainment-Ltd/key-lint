import { inferLocaleFromTranslationFile, normalizePath } from '../../util/path.util.js';
import { escapeRegex } from '../../util/glob.util.js';
import { IKeyUsage } from '../scan-adapter.interface.js';

export function canonicalReactKey(key: string): string {
	return key.includes(':') ? key : `translation:${key}`;
}

export function matchesReactDynamicKey(usage: IKeyUsage, key: string): boolean {
	if (!usage.dynamicKeyPatterns) return usage.isDynamic === true;
	const base = usage.plural ? reactPluralKey(key)?.base : undefined;
	return usage.dynamicKeyPatterns.some((pattern) => {
		const regex = new RegExp(pattern, 's');
		return regex.test(canonicalReactKey(key)) || (base !== undefined && regex.test(canonicalReactKey(base)));
	});
}

export function escapeReactKey(value: string): string {
	return escapeRegex(value).replace(/\*/g, '\\*');
}

export function qualifyReactKey(namespace: string, key: string): string {
	return namespace === 'translation' ? key : `${namespace}:${key}`;
}

export function reactPluralKey(key: string): { base: string; ordinal: boolean; category: Intl.LDMLPluralRule } | undefined {
	const match = /^(.*?)(_ordinal)?_(zero|one|two|few|many|other)$/.exec(key);
	return match ? { base: match[1], ordinal: Boolean(match[2]), category: match[3] as Intl.LDMLPluralRule } : undefined;
}

/** Recognizes locale/namespace.json directories and legacy locale.json files. */
export function reactResourceIdentity(filePath: string, defaultNamespace = 'translation'): { locale: string; namespace: string } {
	const parts = normalizePath(filePath).split('/');
	const parent = parts.at(-2) ?? '';
	const filename = parts.at(-1) ?? '';
	if (/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(parent)) {
		return { locale: parent, namespace: filename.replace(/\.json$/i, '') };
	}
	return { locale: inferLocaleFromTranslationFile(filePath), namespace: defaultNamespace };
}
