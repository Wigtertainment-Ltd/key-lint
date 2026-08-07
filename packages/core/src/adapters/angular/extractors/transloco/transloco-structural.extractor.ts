import { IKeyUsage } from '../../../scan-adapter.interface.js';
import { extractSnippet, firstCallArgument, getLineColumn } from '../pattern-matcher.util.js';

function escapeRegex(text: string): string {
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
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
