import { IKeyUsage } from '../../scan-adapter.interface.js';

function escapeRegex(text: string): string {
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
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

export function extractTranslocoStructuralMatches(source: string, filePath: string): IKeyUsage[] {
	const matches: IKeyUsage[] = [];
	const aliasNames = new Set<string>();
	const structuralDirectiveRegex = /\*transloco\s*=\s*['"]([^'"]*)['"]/g;
	let directiveMatch: RegExpExecArray | null = structuralDirectiveRegex.exec(source);

	while (directiveMatch) {
		const directiveExpression = directiveMatch[1] ?? '';
		const letAliasRegex = /\blet\s+([A-Za-z_$][\w$]*)\b/g;
		let aliasMatch: RegExpExecArray | null = letAliasRegex.exec(directiveExpression);

		while (aliasMatch) {
			const alias = aliasMatch[1]?.trim();
			if (alias) {
				aliasNames.add(alias);
			}

			aliasMatch = letAliasRegex.exec(directiveExpression);
		}

		directiveMatch = structuralDirectiveRegex.exec(source);
	}

	for (const alias of aliasNames) {
		const aliasCallRegex = new RegExp(`\\b${escapeRegex(alias)}\\s*\\(([^)]*)\\)`, 'g');
		let aliasCallMatch: RegExpExecArray | null = aliasCallRegex.exec(source);

		while (aliasCallMatch) {
			const callArgs = aliasCallMatch[1] ?? '';
			const firstArg = firstCallArgument(callArgs);
			const lineCol = getLineColumn(source, aliasCallMatch.index);
			const snippet = extractSnippet(source, aliasCallMatch.index);
			const isDynamicArgument = /\+/.test(firstArg) || /`[^`]*\$\{[^}]+\}[^`]*`/.test(firstArg);

			if (isDynamicArgument) {
				matches.push({
					key: firstArg.replace(/^`|`$/g, '').trim(),
					filePath,
					line: lineCol.line,
					column: lineCol.column,
					snippet,
					matchType: 'html-dynamic-transloco-structural-call',
					isDynamic: true
				});
				aliasCallMatch = aliasCallRegex.exec(source);
				continue;
			}

			const literalRegex = /['"`]([A-Za-z0-9_.-]+)['"`]/g;
			let literalMatch: RegExpExecArray | null = literalRegex.exec(firstArg);

			while (literalMatch) {
				const literalKey = literalMatch[1]?.trim();
				if (literalKey) {
					matches.push({
						key: literalKey,
						filePath,
						line: lineCol.line,
						column: lineCol.column,
						snippet,
						matchType: 'html-transloco-structural-call',
						isDynamic: false
					});
				}

				literalMatch = literalRegex.exec(firstArg);
			}

			aliasCallMatch = aliasCallRegex.exec(source);
		}
	}

	return matches;
}
