import { IKeyUsage } from '../../scan-adapter.interface.js';
import { IPatternDescriptor } from '../../adapter.interfaces.js';
import { parsePlaceholderParameters, splitTopLevel, IPlaceholderParameterUsage } from '../../../util/placeholder.util.js';

/**
 * Converts a source character offset to a one-based line and column by counting newline characters.
 * Columns count UTF-16 code units; the offset is expected to be within the source.
 *
 * @param source - Complete source text containing the offset.
 * @param index - Zero-based character offset to locate.
 * @returns One-based line and column coordinates.
 */
export function getLineColumn(source: string, index: number): { line: number; column: number } {
	let line: number = 1;
	let column: number = 1;

	for (let i: number = 0; i < index; i += 1) {
		if (source[i] === '\n') {
			line += 1;
			column = 1;
			continue;
		}

		column += 1;
	}

	return { line, column };
}

/**
 * Extracts the trimmed source line containing an offset for diagnostic evidence.
 * For a blank line, uses a bounded surrounding slice with collapsed whitespace instead.
 *
 * @param source - Complete source text.
 * @param index - Zero-based character offset identifying the evidence location.
 * @returns A compact source snippet, which may be empty for whitespace-only input.
 */
export function extractSnippet(source: string, index: number): string {
	const lineStart: number = source.lastIndexOf('\n', index - 1) + 1;
	const lineEndIndex: number = source.indexOf('\n', index);
	const lineEnd: number = lineEndIndex === -1 ? source.length : lineEndIndex;
	const currentLine: string = source.slice(lineStart, lineEnd).trim();

	if (currentLine) {
		return currentLine;
	}

	const from: number = Math.max(0, index - 80);
	const to: number = Math.min(source.length, index + 120);
	// Collapse each whitespace run so a multi-line fallback snippet remains compact.
	return source.slice(from, to).replace(/\s+/g, ' ').trim();
}

/**
 * Finds the first call argument using lightweight quote and bracket-depth tracking.
 * Does not parse comments, regular-expression literals, or full JavaScript syntax.
 *
 * @param argumentList - Argument text without the call's surrounding parentheses.
 * @returns Text before the first top-level comma, or the entire input when none occurs; whitespace is preserved.
 */
export function firstCallArgument(argumentList: string): string {
	let depth: number = 0;
	let stringDelimiter: string | null = null;

	for (let i: number = 0; i < argumentList.length; i += 1) {
		const char: string = argumentList[i];

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

/**
 * Scans from a call's opening parenthesis to its matching closing parenthesis.
 * Tracks nested parentheses and quoted strings without performing full syntax parsing.
 *
 * @param source - Complete source text containing the call.
 * @param openParenIndex - Zero-based index of the opening parenthesis.
 * @returns Argument text without outer parentheses, or `null` when no matching close is found.
 */
export function extractCallArgumentList(source: string, openParenIndex: number): string | null {
	let depth: number = 0;
	let stringDelimiter: string | null = null;

	for (let i: number = openParenIndex + 1; i < source.length; i += 1) {
		const char: string = source[i];

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

/**
 * Classifies the first colon argument following a translate or transloco pipe.
 * Truncates object-like arguments at their matching closing brace before placeholder analysis.
 *
 * @param matchSource - Source fragment captured by a pipe pattern.
 * @returns Placeholder-parameter metadata, or `undefined` when no supported pipe is present.
 */
function placeholderParametersForPipe(matchSource: string): IKeyUsage['placeholderParameters'] {
	// Capture everything following a supported Angular translation pipe so its first
	// top-level colon argument can be parsed without confusing object-property colons.
	const pipeMatch: RegExpExecArray | null = /\|\s*(?:translate|transloco)\b([\s\S]*)/i.exec(matchSource);
	if (!pipeMatch) {
		return undefined;
	}

	const suffix: string = pipeMatch[1] ?? '';
	const parts: string[] = splitTopLevel(suffix, ':');
	let parameterSource: string | undefined = parts.length > 1 ? parts[1]?.trim() : undefined;
	if (parameterSource?.startsWith('{')) {
		let depth: number = 0;
		let stringDelimiter: string | null = null;
		for (let index: number = 0; index < parameterSource.length; index += 1) {
			const char: string = parameterSource[index];
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

/**
 * Applies translation patterns and builds usage evidence with locations and parameter metadata.
 * Clones each regular expression to reset its state; descriptors must support advancing repeated matches.
 * Literal-call patterns inspect the first argument, while concatenations and interpolated templates are marked dynamic.
 * This heuristic scan does not resolve symbols, evaluate expressions, or deduplicate overlapping descriptors.
 *
 * @param source - Template or TypeScript text to scan.
 * @param filePath - Source path copied into every evidence record.
 * @param descriptors - Ordered pattern definitions and capture/extraction instructions.
 * @returns Usage records in descriptor and match order, potentially containing duplicates.
 */
export function extractMatches(source: string, filePath: string, descriptors: IPatternDescriptor[]): IKeyUsage[] {
	const matches: IKeyUsage[] = [];

	for (const descriptor of descriptors) {
		// Clone the documented expression so each extraction run starts with lastIndex zero.
		const regex: RegExp = new RegExp(descriptor.regex.source, descriptor.regex.flags);
		let match: RegExpExecArray | null = regex.exec(source);

		while (match) {
			const keyIndex: number = descriptor.keyCaptureIndex ?? 1;
			const rawKey: string = match[keyIndex]?.trim();
			const snippet: string = extractSnippet(source, match.index);
			const isTypeScriptCall: boolean = descriptor.matchType.startsWith('ts-') && descriptor.matchType !== 'ts-indirect-key-literal';
			const openParenIndex: number = isTypeScriptCall ? source.indexOf('(', match.index) : -1;
			const argumentList: string | null = openParenIndex === -1 ? null : extractCallArgumentList(source, openParenIndex);
			const callArguments: string[] = argumentList === null ? [] : splitTopLevel(argumentList);
			const callParameters: IPlaceholderParameterUsage | undefined = isTypeScriptCall ? parsePlaceholderParameters(callArguments[1]) : undefined;
			const pipeParameters: IPlaceholderParameterUsage | undefined = descriptor.matchType.includes('pipe-') ? placeholderParametersForPipe(match[0]) : undefined;

			if (descriptor.literalKeyExtraction) {
				const argumentSource: string = firstCallArgument(argumentList ?? '');
				const lineCol: { line: number; column: number; } = getLineColumn(source, match.index);
				// A plus sign denotes concatenation; an interpolated template contains at least one ${...} expression.
				const isDynamicArgument: boolean = argumentSource.includes('+') || /`[^`]*\$\{[^}]+\}[^`]*`/.test(argumentSource);

				if (isDynamicArgument) {
					// Remove an optional pair of surrounding backticks while retaining the dynamic expression.
					const cleanedKey: string = argumentSource.replace(/^`|`$/g, '').trim();
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
				const literalRegex: RegExp = /['"`]([A-Za-z0-9_.-]+)['"`]/g;
				let literalMatch: RegExpExecArray | null = literalRegex.exec(argumentSource);

				while (literalMatch) {
					const literalKey: string = literalMatch[1]?.trim();
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
				const cleanedKey: string = rawKey.replace(/^`|`$/g, '').trim();
				const lineCol: { line: number; column: number; } = getLineColumn(source, match.index);
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
