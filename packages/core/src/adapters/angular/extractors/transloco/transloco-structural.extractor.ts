import { IKeyUsage } from '../../../scan-adapter.interface.js';
import { extractCallArgumentList, extractSnippet, firstCallArgument, getLineColumn } from '../pattern-matcher.util.js';
import { parsePlaceholderParameters, splitTopLevel } from '../../../../util/placeholder.util.js';

function escapeRegex(text: string): string {
	// Match every regular-expression metacharacter that must be escaped when inserting an alias literally.
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function extractTranslocoStructuralMatches(source: string, filePath: string): IKeyUsage[] {
	const matches: IKeyUsage[] = [];
	const aliasNames = new Set<string>();
	// Capture the complete quoted expression of each *transloco structural directive in group 1.
	const structuralDirectiveRegex: RegExp = /\*transloco\s*=\s*['"]([^'"]*)['"]/g;
	let directiveMatch: RegExpExecArray | null = structuralDirectiveRegex.exec(source);

	while (directiveMatch) {
		const directiveExpression: string = directiveMatch[1] ?? '';
		// Capture every valid JavaScript identifier declared after "let" in group 1.
		const letAliasRegex: RegExp = /\blet\s+([A-Za-z_$][\w$]*)\b/g;
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
		// Match calls to this escaped alias and capture the complete argument list in group 1.
		const aliasCallRegex: RegExp = new RegExp(`\\b${escapeRegex(alias)}\\s*\\(`, 'g');
		let aliasCallMatch: RegExpExecArray | null = aliasCallRegex.exec(source);

		while (aliasCallMatch) {
			const openParenIndex = source.indexOf('(', aliasCallMatch.index);
			const callArgs: string = extractCallArgumentList(source, openParenIndex) ?? '';
			const args = splitTopLevel(callArgs);
			const firstArg: string = firstCallArgument(callArgs);
			const placeholderParameters = parsePlaceholderParameters(args[1]);
			const lineCol = getLineColumn(source, aliasCallMatch.index);
			const snippet: string = extractSnippet(source, aliasCallMatch.index);
			// A plus sign denotes concatenation; an interpolated template contains at least one ${...} expression.
			const isDynamicArgument: boolean = /\+/.test(firstArg) || /`[^`]*\$\{[^}]+\}[^`]*`/.test(firstArg);

			if (isDynamicArgument) {
				matches.push({
					// Remove an optional pair of surrounding backticks while retaining the dynamic expression.
					key: firstArg.replace(/^`|`$/g, '').trim(),
					filePath,
					line: lineCol.line,
					column: lineCol.column,
					snippet,
					matchType: 'html-dynamic-transloco-structural-call',
					isDynamic: true,
					sourceIndex: openParenIndex,
					placeholderParameters
				});
				aliasCallMatch = aliasCallRegex.exec(source);
				continue;
			}

			// Capture every quoted static translation key in the alias call's first argument.
			const literalRegex: RegExp = /['"`]([A-Za-z0-9_.-]+)['"`]/g;
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
						isDynamic: false,
						sourceIndex: openParenIndex,
						placeholderParameters
					});
				}

				literalMatch = literalRegex.exec(firstArg);
			}

			aliasCallMatch = aliasCallRegex.exec(source);
		}
	}

	return matches;
}
