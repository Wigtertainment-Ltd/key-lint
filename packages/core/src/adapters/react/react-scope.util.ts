import ts from 'typescript';
import { qualifyReactKey } from './react-key.util.js';
import { isReactDefaultArgument, readReactString, resolveReactExpression } from './react-typescript.util.js';

export interface IReactTranslationScope {
	namespace: string;
	keyPrefix: string;
}

export function reactCallOptions(call: ts.CallExpression, checker: ts.TypeChecker): ts.Expression | undefined {
	const second: ts.Expression | undefined = call.arguments[1] ? resolveReactExpression(call.arguments[1], checker) : undefined;
	return second && ts.isStringLiteralLike(second) ? call.arguments[2] : call.arguments[1];
}

export function reactResolvedScope(checker: ts.TypeChecker, scope: IReactTranslationScope, options: Map<string, ts.Expression>): IReactTranslationScope {
	const ns: ts.Expression | undefined = options.get('ns');
	const prefix: ts.Expression | undefined = options.get('keyPrefix');
	const namespace: string = !ns || isReactDefaultArgument(resolveReactExpression(ns, checker)) ? scope.namespace : readReactString(ns, checker) || scope.namespace;
	const keyPrefix: string = !prefix || isReactDefaultArgument(resolveReactExpression(prefix, checker)) ? scope.keyPrefix : readReactString(prefix, checker);
	return { namespace, keyPrefix };
}

export function reactScopedKey(key: string, checker: ts.TypeChecker, scope: IReactTranslationScope, options: Map<string, ts.Expression>): string {
	const { namespace, keyPrefix }: IReactTranslationScope = reactResolvedScope(checker, scope, options);
	const fullKey: string = keyPrefix ? `${keyPrefix}.${key}` : key;
	const separator: number = fullKey.indexOf(':');
	return separator < 0 ? qualifyReactKey(namespace, fullKey) : qualifyReactKey(fullKey.slice(0, separator), fullKey.slice(separator + 1));
}
