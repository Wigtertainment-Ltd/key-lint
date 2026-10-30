import ts from 'typescript';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { canonicalReactKey, escapeReactKey } from './react-key.util.js';
import { IReactTranslationScope, reactResolvedScope, reactScopedKey } from './react-scope.util.js';
import { isReactDefaultArgument, reactPropertyName, resolveReactExpression } from './react-typescript.util.js';

function keyFragments(expression: ts.Expression, checker: ts.TypeChecker): (string | null)[] {
	const value: ts.Expression = resolveReactExpression(expression, checker);
	if (ts.isStringLiteralLike(value)) {
		return [value.text];
	}
	if (ts.isTemplateExpression(value)) {
		return [value.head.text, ...value.templateSpans.flatMap((span: ts.TemplateSpan): (string | null)[] => [...keyFragments(span.expression, checker), span.literal.text])];
	}
	if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left: (string | null)[] = keyFragments(value.left, checker);
		const right: (string | null)[] = keyFragments(value.right, checker);
		return left.some((part: string | null): part is string => part !== null) || right.some((part: string | null): part is string => part !== null)
			? [...left, ...right]
			: [null];
	}
	return [null];
}

function keyAlternatives(expression: ts.Expression, checker: ts.TypeChecker): ts.Expression[] {
	const value: ts.Expression = resolveReactExpression(expression, checker);
	if (ts.isConditionalExpression(value)) {
		return [...keyAlternatives(value.whenTrue, checker), ...keyAlternatives(value.whenFalse, checker)];
	}
	if (ts.isArrayLiteralExpression(value)) {
		return value.elements.flatMap((element: ts.Expression): ts.Expression[] => keyAlternatives(element, checker));
	}
	return [value];
}

function fragmentPatterns(fragments: (string | null)[], scope: IReactTranslationScope): string[] {
	const parts: (string | null)[] = [scope.keyPrefix ? `${scope.keyPrefix}.` : '', ...fragments];
	const first: number = parts.indexOf(null);
	if (first < 0) {
		const key: string = parts.join('');
		return [`^${escapeReactKey(key.includes(':') ? key : `${scope.namespace}:${key}`)}$`];
	}
	const prefix: string = parts.slice(0, first).join('');
	const suffix: string = parts.slice(parts.lastIndexOf(null) + 1).join('');
	if (prefix.includes(':')) {
		return [`^${escapeReactKey(prefix)}.*${escapeReactKey(suffix)}$`];
	}
	return [`^${escapeReactKey(`${scope.namespace}:${prefix}`)}.*${escapeReactKey(suffix)}$`, `^(?=[^:]*:)${escapeReactKey(prefix)}.*${escapeReactKey(suffix)}$`];
}

/** Resolves literal keys and retains bounded patterns for runtime expressions. */
export function reactKeyUsage(
	expression: ts.Expression,
	checker: ts.TypeChecker,
	scope: IReactTranslationScope,
	options: Map<string, ts.Expression>
): Pick<IKeyUsage, 'key' | 'isDynamic' | 'dynamicKeyPatterns'> {
	const alternatives: (string | null)[][] = keyAlternatives(expression, checker).map((value: ts.Expression): (string | null)[] => keyFragments(value, checker));
	const resolvedScope: IReactTranslationScope = reactResolvedScope(checker, scope, options);
	const literals: string[] = alternatives
		.filter((parts: (string | null)[]): boolean => !parts.includes(null))
		.map((parts: (string | null)[]): string => reactScopedKey(parts.join(''), checker, scope, options));
	if (literals.length === alternatives.length && new Set(literals).size === 1) {
		const key: string = literals[0];
		const context: ts.Expression | undefined = options.get('context');
		const value: ts.Expression | undefined = context ? resolveReactExpression(context, checker) : undefined;
		if (!value || isReactDefaultArgument(value) || (ts.isStringLiteralLike(value) && value.text === '')) {
			return { key };
		}
		return { key: expression.getText(), isDynamic: true, dynamicKeyPatterns: [`^${escapeReactKey(canonicalReactKey(key))}(?:_.*)?$`] };
	}
	return {
		key: expression.getText(),
		isDynamic: true,
		dynamicKeyPatterns: [...new Set(alternatives.flatMap((parts: (string | null)[]): string[] => fragmentPatterns(parts, resolvedScope)))]
	};
}

/** Reads known count fields without assuming an unresolved object contains one. */
export function reactCountProperty(expression: ts.Expression | undefined, checker: ts.TypeChecker): ts.Expression | undefined {
	if (!expression) {
		return undefined;
	}
	const value: ts.Expression = resolveReactExpression(expression, checker);
	if (!ts.isObjectLiteralExpression(value)) {
		return undefined;
	}
	let count: ts.Expression | undefined;
	for (const property of value.properties) {
		if (ts.isSpreadAssignment(property)) {
			const nested: ts.Expression | undefined = reactCountProperty(property.expression, checker);
			if (nested || count) {
				count = nested ?? property.expression;
			}
		} else if (property.name && reactPropertyName(property.name, checker) === 'count') {
			if (ts.isPropertyAssignment(property)) {
				count = property.initializer;
			}
			if (ts.isShorthandPropertyAssignment(property)) {
				count = property.name;
			}
		}
	}
	return count;
}

export function reactPluralUsage(options: Map<string, ts.Expression>, checker: ts.TypeChecker): IKeyUsage['plural'] {
	const expression: ts.Expression | undefined = options.get('count');
	if (!expression) {
		return undefined;
	}
	const value: ts.Expression = resolveReactExpression(expression, checker);
	if (isReactDefaultArgument(value) || ts.isStringLiteralLike(value)) {
		return undefined;
	}
	let count: number | 'dynamic' = 'dynamic';
	if (ts.isNumericLiteral(value)) {
		count = Number(value.text);
	}
	if (ts.isPrefixUnaryExpression(value) && ts.isNumericLiteral(value.operand)) {
		if (value.operator === ts.SyntaxKind.MinusToken) {
			count = -Number(value.operand.text);
		}
		if (value.operator === ts.SyntaxKind.PlusToken) {
			count = Number(value.operand.text);
		}
	}
	const ordinal: ts.Expression | undefined = options.get('ordinal');
	const ordinalValue: ts.Expression | undefined = ordinal ? resolveReactExpression(ordinal, checker) : undefined;
	return {
		count,
		...(ordinalValue
			? { ordinal: ordinalValue.kind === ts.SyntaxKind.TrueKeyword ? true : ordinalValue.kind === ts.SyntaxKind.FalseKeyword ? false : ('dynamic' as const) }
			: {})
	};
}
