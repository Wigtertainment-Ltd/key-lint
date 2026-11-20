import ts from 'typescript';
import { unwrapExpression } from '../../../../detection/shared/typescript-analysis.util.js';
import { IPlaceholderParameterUsage, parsePlaceholderParameters, splitTopLevel } from '../../../../util/placeholder.util.js';
import { IKeyUsage } from '../../../scan-adapter.interface.js';
import { extractSnippet, getLineColumn } from '../pattern-matcher.util.js';

function literalResultKeys(expression: ts.Expression): string[] {
	const result: ts.Expression = unwrapExpression(expression);
	if (ts.isConditionalExpression(result)) {
		return [...literalResultKeys(result.whenTrue), ...literalResultKeys(result.whenFalse)];
	}
	return ts.isStringLiteralLike(result) && /^[A-Za-z0-9_.-]+$/.test(result.text) ? [result.text] : [];
}

/** Extracts literal results from parenthesized ternaries passed to the ngx-translate pipe in property bindings. */
export function extractNgxTranslateConditionalBindings(source: string, filePath: string): IKeyUsage[] {
	const usages: IKeyUsage[] = [];
	const bindingPattern: RegExp = /<!--[\s\S]*?-->|\[[\w.:-]+\]\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
	for (const match of source.matchAll(bindingPattern)) {
		const binding: string | undefined = match[1] ?? match[2];
		if (!binding?.includes('?') || !binding.includes('|')) {
			continue;
		}

		const parts: string[] = splitTopLevel(binding, '|');
		const operand: string = parts[0];
		const pipe: string = parts[1] ?? '';
		// Angular applies the pipe to the whole ternary when the ternary is parenthesized.
		if (!operand.startsWith('(') || !/^translate\s*(?::|$)/.test(pipe)) {
			continue;
		}

		const parsed: ts.SourceFile = ts.createSourceFile('binding.ts', operand, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
		const statement: ts.Statement | undefined = parsed.statements[0];
		if (parsed.statements.length !== 1 || !statement || !ts.isExpressionStatement(statement) || !ts.isParenthesizedExpression(statement.expression)) {
			continue;
		}
		const conditional: ts.Expression = unwrapExpression(statement.expression);
		if (!ts.isConditionalExpression(conditional)) {
			continue;
		}

		const sourceIndex: number = match.index;
		const location: { line: number; column: number } = getLineColumn(source, sourceIndex);
		const snippet: string = extractSnippet(source, sourceIndex);
		const placeholderParameters: IPlaceholderParameterUsage = parsePlaceholderParameters(splitTopLevel(pipe, ':')[1]);
		for (const key of literalResultKeys(conditional)) {
			usages.push({ key, filePath, ...location, snippet, matchType: 'html-pipe-translate-binding', isDynamic: false, sourceIndex, placeholderParameters });
		}
	}
	return usages;
}
