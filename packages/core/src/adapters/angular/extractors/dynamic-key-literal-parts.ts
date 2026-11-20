import ts from 'typescript';
import { unwrapExpression } from '../../../detection/shared/typescript-analysis.util.js';

function appendLiteralParts(expression: ts.Expression, parts: string[]): void {
	const value: ts.Expression = unwrapExpression(expression);
	if (ts.isStringLiteralLike(value)) {
		parts[parts.length - 1] += value.text;
	} else if (ts.isTemplateExpression(value)) {
		parts[parts.length - 1] += value.head.text;
		for (const span of value.templateSpans) {
			parts.push(span.literal.text);
		}
	} else if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		appendLiteralParts(value.left, parts);
		appendLiteralParts(value.right, parts);
	} else {
		parts.push('');
	}
}

/** Reads the fixed parts of a key expression, with an unknown span between each pair of parts. */
export function readDynamicKeyLiteralParts(expression: string): string[] {
	const source: string = `(${expression})`;
	const parsed: ts.SourceFile = ts.createSourceFile('translation-key.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
	const statement: ts.Statement | undefined = parsed.statements[0];
	if (parsed.statements.length !== 1 || !statement || !ts.isExpressionStatement(statement) ||
		!ts.isParenthesizedExpression(statement.expression) || statement.end !== source.length) {
		return [];
	}

	const parts: string[] = [''];
	appendLiteralParts(statement.expression, parts);
	return parts.some((part: string): boolean => part.length > 0) ? parts : [];
}

/** Matches the whole key, allowing unknown text between non-overlapping literal parts. */
export function matchesDynamicKeyLiteralParts(key: string, parts: readonly string[]): boolean {
	if (parts.length === 1) {
		return key === parts[0];
	}
	const prefix: string = parts[0];
	const suffix: string = parts[parts.length - 1];
	const suffixStart: number = key.length - suffix.length;
	if (prefix.length > suffixStart || !key.startsWith(prefix) || !key.endsWith(suffix)) {
		return false;
	}

	let offset: number = prefix.length;
	for (let index: number = 1; index < parts.length - 1; index += 1) {
		const part: string = parts[index];
		const start: number = key.indexOf(part, offset);
		if (start < 0 || start + part.length > suffixStart) {
			return false;
		}
		offset = start + part.length;
	}
	return true;
}
