import { IKeyUsage } from '../../scan-adapter.interface.js';
import { extractSnippet, getLineColumn } from './pattern-matcher.util.js';

/** Collects known keys from HTML attribute values, quoted binding literals, and template text. */
export function extractHtmlIndirectKeys(source: string, filePath: string, definedKeys: ReadonlySet<string>): IKeyUsage[] {
	const usages: IKeyUsage[] = [];
	const recordKey: (key: string, sourceIndex: number) => void = (key: string, sourceIndex: number): void => {
		if (definedKeys.has(key)) {
			usages.push({
				key, filePath, sourceIndex, ...getLineColumn(source, sourceIndex), snippet: extractSnippet(source, sourceIndex),
				matchType: 'html-indirect-key-literal', isDynamic: true
			});
		}
	};

	const htmlParts: RegExp = /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?[A-Za-z][\w.:-]*((?:[^"'<>]|"[^"]*"|'[^']*')*)>|([^<]+)/gd;
	const attributes: RegExp = /=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/gd;
	const quotedLiterals: RegExp = /"[^"]*"|'[^']*'|\x60[^\x60]*\x60/g;
	const textTokens: RegExp = /[\p{L}\p{M}\p{N}_.-]+/gu;

	for (const part of source.matchAll(htmlParts)) {
		const attributeRange: [number, number] | undefined = part.indices?.[1];
		if (attributeRange) {
			for (const attribute of part[1].matchAll(attributes)) {
				const valueRange: [number, number] | undefined = attribute.indices?.[1] ?? attribute.indices?.[2] ?? attribute.indices?.[3];
				if (!valueRange) {
					continue;
				}
				const value: string = part[1].slice(valueRange[0], valueRange[1]);
				const valueOffset: number = attributeRange[0] + valueRange[0];
				recordKey(value, valueOffset);
				for (const literal of value.matchAll(quotedLiterals)) {
					recordKey(literal[0].slice(1, -1), valueOffset + literal.index + 1);
				}
			}
		} else if (part[2] !== undefined) {
			for (const token of part[2].matchAll(textTokens)) {
				recordKey(token[0], part.index + token.index);
			}
		}
	}
	return usages;
}
