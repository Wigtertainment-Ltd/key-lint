import { IKeyUsage } from '../../scan-adapter.interface.js';
import { IPatternDescriptor } from '../../adapter.interfaces.js';
import { parsePlaceholderParameters, splitTopLevel } from '../../../util/placeholder.util.js';

export function getLineColumn(source: string, index: number): { line: number; column: number } {
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

export function extractSnippet(source: string, index: number): string {
	const lineStart = source.lastIndexOf('\n', index - 1) + 1;
	const lineEndIndex = source.indexOf('\n', index);
	const lineEnd = lineEndIndex === -1 ? source.length : lineEndIndex;
	const currentLine = source.slice(lineStart, lineEnd).trim();

	if (currentLine) {
		return currentLine;
	}

	const from = Math.max(0, index - 80);
	const to = Math.min(source.length, index + 120);
	// Collapse each whitespace run so a multi-line fallback snippet remains compact.
	return source.slice(from, to).replace(/\s+/g, ' ').trim();
}

export function firstCallArgument(argumentList: string): string {
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

		if (char === "'" || char === '"' || char === '`') {
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

export function extractCallArgumentList(source: string, openParenIndex: number): string | null {
	let depth = 0;
	let stringDelimiter: string | null = null;

	for (let i = openParenIndex + 1; i < source.length; i += 1) {
		const char = source[i];

		if (stringDelimiter) {
			if (char === stringDelimiter && source[i - 1] !== '\\') {
				stringDelimiter = null;
			}
			continue;
		}

		if (char === "'" || char === '"' || char === '`') {
			stringDelimiter = char;
			continue;
		}

		if (char === '(') {
			depth += 1;
			continue;
		}

		if (char === ')') {
			if (depth === 0) {
				return source.slice(openParenIndex + 1, i);
			}

			depth -= 1;
		}
	}

	return null;
}

function placeholderParametersForPipe(matchSource: string): IKeyUsage['placeholderParameters'] {
	// Capture everything following a supported Angular translation pipe so its first
	// top-level colon argument can be parsed without confusing object-property colons.
	const pipeMatch = /\|\s*(?:translate|transloco)\b([\s\S]*)/i.exec(matchSource);
	if (!pipeMatch) {
		return undefined;
	}

	const suffix = pipeMatch[1] ?? '';
	const parts = splitTopLevel(suffix, ':');
	let parameterSource = parts.length > 1 ? parts[1]?.trim() : undefined;
	if (parameterSource?.startsWith('{')) {
		let depth = 0;
		let stringDelimiter: string | null = null;
		for (let index = 0; index < parameterSource.length; index += 1) {
			const char = parameterSource[index];
			if (stringDelimiter) {
				if (char === stringDelimiter && parameterSource[index - 1] !== '\\') {
					stringDelimiter = null;
				}
				continue;
			}
			if (char === "'" || char === '"' || char === '`') {
				stringDelimiter = char;
				continue;
			}
			if (char === '{') {
				depth += 1;
			}
			if (char === '}') {
				depth -= 1;
				if (depth === 0) {
					parameterSource = parameterSource.slice(0, index + 1);
					break;
				}
			}
		}
	}
	return parsePlaceholderParameters(parameterSource);
}

export function extractMatches(source: string, filePath: string, descriptors: IPatternDescriptor[]): IKeyUsage[] {
	const matches: IKeyUsage[] = [];

	for (const descriptor of descriptors) {
		// Clone the documented expression so each extraction run starts with lastIndex zero.
		const regex = new RegExp(descriptor.regex.source, descriptor.regex.flags);
		let match: RegExpExecArray | null = regex.exec(source);

		while (match) {
			const keyIndex = descriptor.keyCaptureIndex ?? 1;
			const rawKey = match[keyIndex]?.trim();
			const snippet = extractSnippet(source, match.index);
			const isTypeScriptCall = descriptor.matchType.startsWith('ts-') && descriptor.matchType !== 'ts-indirect-key-literal';
			const openParenIndex = isTypeScriptCall ? source.indexOf('(', match.index) : -1;
			const argumentList = openParenIndex === -1 ? null : extractCallArgumentList(source, openParenIndex);
			const callArguments = argumentList === null ? [] : splitTopLevel(argumentList);
			const callParameters = isTypeScriptCall ? parsePlaceholderParameters(callArguments[1]) : undefined;
			const pipeParameters = descriptor.matchType.includes('pipe-') ? placeholderParametersForPipe(match[0]) : undefined;

			if (descriptor.literalKeyExtraction) {
				const argumentSource = firstCallArgument(argumentList ?? '');
				const lineCol = getLineColumn(source, match.index);
				// A plus sign denotes concatenation; an interpolated template contains at least one ${...} expression.
				const isDynamicArgument = /\+/.test(argumentSource) || /`[^`]*\$\{[^}]+\}[^`]*`/.test(argumentSource);

				if (isDynamicArgument) {
					// Remove an optional pair of surrounding backticks while retaining the dynamic expression.
					const cleanedKey = argumentSource.replace(/^`|`$/g, '').trim();
					matches.push({
						key: cleanedKey,
						filePath,
						line: lineCol.line,
						column: lineCol.column,
						snippet,
						matchType: 'ts-dynamic-translate-call',
						isDynamic: true,
						sourceIndex: openParenIndex,
						placeholderParameters: callParameters
					});

					match = regex.exec(source);
					continue;
				}

				// Capture every quoted static translation key in the first call argument.
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
							isDynamic: descriptor.dynamic,
							sourceIndex: openParenIndex,
							placeholderParameters: callParameters
						});
					}

					literalMatch = literalRegex.exec(argumentSource);
				}

				match = regex.exec(source);
				continue;
			}

			if (rawKey) {
				// Remove an optional pair of surrounding backticks from a captured dynamic key.
				const cleanedKey = rawKey.replace(/^`|`$/g, '').trim();
				const lineCol = getLineColumn(source, match.index);
				matches.push({
					key: cleanedKey,
					filePath,
					line: lineCol.line,
					column: lineCol.column,
					snippet,
					matchType: descriptor.matchType,
					isDynamic: descriptor.dynamic,
					sourceIndex: isTypeScriptCall ? openParenIndex : match.index,
					placeholderParameters: callParameters ?? pipeParameters
				});
			}

			match = regex.exec(source);
		}
	}

	return matches;
}
