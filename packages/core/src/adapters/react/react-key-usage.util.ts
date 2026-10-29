import ts from 'typescript';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { canonicalReactKey, escapeReactKey } from './react-key.util.js';
import { IReactTranslationScope, reactResolvedScope, reactScopedKey } from './react-scope.util.js';
import { isReactDefaultArgument, reactPropertyName, resolveReactExpression } from './react-typescript.util.js';

function keyFragments(expression: ts.Expression, checker: ts.TypeChecker): (string | null)[] {
	const value = resolveReactExpression(expression, checker);
	if (ts.isStringLiteralLike(value)) return [value.text];
	if (ts.isTemplateExpression(value)) {
		return [value.head.text, ...value.templateSpans.flatMap((span) => [...keyFragments(span.expression, checker), span.literal.text])];
	}
	if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = keyFragments(value.left, checker);
		const right = keyFragments(value.right, checker);
		return left.some((part) => part !== null) || right.some((part) => part !== null) ? [...left, ...right] : [null];
	}
	return [null];
}

function keyAlternatives(expression: ts.Expression, checker: ts.TypeChecker): ts.Expression[] {
	const value = resolveReactExpression(expression, checker);
	if (ts.isConditionalExpression(value)) return [...keyAlternatives(value.whenTrue, checker), ...keyAlternatives(value.whenFalse, checker)];
	if (ts.isArrayLiteralExpression(value)) return value.elements.flatMap((element) => keyAlternatives(element, checker));
	return [value];
}

function fragmentPatterns(fragments: (string | null)[], scope: IReactTranslationScope): string[] {
	const parts = [scope.keyPrefix ? `${scope.keyPrefix}.` : '', ...fragments];
	const first = parts.indexOf(null);
	if (first < 0) {
		const key = parts.join('');
		return [`^${escapeReactKey(key.includes(':') ? key : `${scope.namespace}:${key}`)}$`];
	}
	const prefix = parts.slice(0, first).join('');
	const suffix = parts.slice(parts.lastIndexOf(null) + 1).join('');
	if (prefix.includes(':')) return [`^${escapeReactKey(prefix)}.*${escapeReactKey(suffix)}$`];
	return [`^${escapeReactKey(`${scope.namespace}:${prefix}`)}.*${escapeReactKey(suffix)}$`, `^(?=[^:]*:)${escapeReactKey(prefix)}.*${escapeReactKey(suffix)}$`];
}

/** Resolves literal keys and retains bounded patterns for runtime expressions. */
export function reactKeyUsage(
	expression: ts.Expression,
	checker: ts.TypeChecker,
	scope: IReactTranslationScope,
	options: Map<string, ts.Expression>
): Pick<IKeyUsage, 'key' | 'isDynamic' | 'dynamicKeyPatterns'> {
	const alternatives = keyAlternatives(expression, checker).map((value) => keyFragments(value, checker));
	const resolvedScope = reactResolvedScope(checker, scope, options);
	const literals = alternatives.filter((parts) => !parts.includes(null)).map((parts) => reactScopedKey(parts.join(''), checker, scope, options));
	if (literals.length === alternatives.length && new Set(literals).size === 1) {
		const key = literals[0];
		const context = options.get('context');
		const value = context ? resolveReactExpression(context, checker) : undefined;
		if (!value || isReactDefaultArgument(value) || (ts.isStringLiteralLike(value) && value.text === '')) return { key };
		return { key: expression.getText(), isDynamic: true, dynamicKeyPatterns: [`^${escapeReactKey(canonicalReactKey(key))}(?:_.*)?$`] };
	}
	return {
		key: expression.getText(),
		isDynamic: true,
		dynamicKeyPatterns: [...new Set(alternatives.flatMap((parts) => fragmentPatterns(parts, resolvedScope)))]
	};
}

/** Reads known count fields without assuming an unresolved object contains one. */
export function reactCountProperty(expression: ts.Expression | undefined, checker: ts.TypeChecker): ts.Expression | undefined {
	if (!expression) return undefined;
	const value = resolveReactExpression(expression, checker);
	if (!ts.isObjectLiteralExpression(value)) return undefined;
	let count: ts.Expression | undefined;
	for (const property of value.properties) {
		if (ts.isSpreadAssignment(property)) {
			const nested = reactCountProperty(property.expression, checker);
			if (nested || count) count = nested ?? property.expression;
		} else if (property.name && reactPropertyName(property.name, checker) === 'count') {
			if (ts.isPropertyAssignment(property)) count = property.initializer;
			if (ts.isShorthandPropertyAssignment(property)) count = property.name;
		}
	}
	return count;
}

export function reactPluralUsage(options: Map<string, ts.Expression>, checker: ts.TypeChecker): IKeyUsage['plural'] {
	const expression = options.get('count');
	if (!expression) return undefined;
	const value = resolveReactExpression(expression, checker);
	if (isReactDefaultArgument(value) || ts.isStringLiteralLike(value)) return undefined;
	let count: number | 'dynamic' = 'dynamic';
	if (ts.isNumericLiteral(value)) count = Number(value.text);
	if (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) {
		if (value.operator === ts.SyntaxKind.MinusToken) count = -Number(value.operand.text);
		if (value.operator === ts.SyntaxKind.PlusToken) count = Number(value.operand.text);
	}
	const ordinal = options.get('ordinal');
	const ordinalValue = ordinal ? resolveReactExpression(ordinal, checker) : undefined;
	return {
		count,
		...(ordinalValue
			? { ordinal: ordinalValue.kind === ts.SyntaxKind.TrueKeyword ? true : ordinalValue.kind === ts.SyntaxKind.FalseKeyword ? false : ('dynamic' as const) }
			: {})
	};
}
