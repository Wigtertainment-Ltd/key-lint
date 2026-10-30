import ts from 'typescript';
import { IPlaceholderParameterUsage } from '../../util/placeholder.util.js';
import { isReactDefaultArgument, reactPropertyName, resolveReactExpression } from './react-typescript.util.js';

export function mergeReactParameters(groups: IPlaceholderParameterUsage[]): IPlaceholderParameterUsage {
	const names: Set<string> = new Set<string>();
	const prefixes: Set<string> = new Set<string>();
	for (const group of groups) {
		if (group.kind === 'dynamic') {
			for (const name of names) {
				if (name.includes('.')) {
					names.delete(name);
					prefixes.add(name.split('.')[0]);
				}
			}
		}
		for (const root of group.names.filter((name: string): boolean => !name.includes('.'))) {
			for (const name of names) {
				if (name === root || name.startsWith(`${root}.`)) {
					names.delete(name);
				}
			}
			for (const prefix of prefixes) {
				if (prefix === root || prefix.startsWith(`${root}.`)) {
					prefixes.delete(prefix);
				}
			}
		}
		group.names.forEach((name: string): Set<string> => names.add(name));
		group.dynamicPrefixes?.forEach((prefix: string): Set<string> => prefixes.add(prefix));
	}
	return {
		kind: groups.some((group: IPlaceholderParameterUsage): boolean => group.kind === 'dynamic')
			? 'dynamic'
			: groups.some((group: IPlaceholderParameterUsage): boolean => group.kind === 'static')
				? 'static'
				: 'absent',
		names: [...names].sort((a: string, b: string): number => a.localeCompare(b)),
		...(prefixes.size ? { dynamicPrefixes: [...prefixes].sort((a: string, b: string): number => a.localeCompare(b)) } : {})
	};
}

/** Extracts parameter paths without evaluating values; unresolved nested objects retain their path prefix. */
export function readReactParameters(expression: ts.Expression | undefined, checker: ts.TypeChecker, seen: Set<ts.Node> = new Set<ts.Node>()): IPlaceholderParameterUsage {
	if (!expression) {
		return { kind: 'absent', names: [] };
	}
	const value: ts.Expression = resolveReactExpression(expression, checker);
	if (isReactDefaultArgument(value)) {
		return { kind: 'absent', names: [] };
	}
	if (!ts.isObjectLiteralExpression(value) || seen.has(value)) {
		return { kind: 'dynamic', names: [] };
	}
	const ancestors: Set<ts.Node> = new Set(seen).add(value);
	const groups: IPlaceholderParameterUsage[] = [{ kind: 'static', names: [] }];
	for (const property of value.properties) {
		if (ts.isSpreadAssignment(property)) {
			groups.push(readReactParameters(property.expression, checker, ancestors));
			continue;
		}
		const name: string | undefined = property.name ? reactPropertyName(property.name, checker) : undefined;
		if (name === undefined || (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))) {
			groups.push({ kind: 'dynamic', names: [] });
			continue;
		}
		const child: ts.Expression = resolveReactExpression(ts.isPropertyAssignment(property) ? property.initializer : property.name, checker);
		if (ts.isObjectLiteralExpression(child) && !ancestors.has(child)) {
			const nested: IPlaceholderParameterUsage = readReactParameters(child, checker, ancestors);
			groups.push({
				kind: nested.kind,
				names: [name, ...nested.names.map((path: string): string => `${name}.${path}`)],
				dynamicPrefixes: nested.kind === 'dynamic' ? [name] : nested.dynamicPrefixes?.map((path: string): string => `${name}.${path}`)
			});
		} else {
			const literal: boolean =
				ts.isStringLiteralLike(child) ||
				ts.isNumericLiteral(child) ||
				[ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(child.kind);
			groups.push({ kind: 'static', names: [name], ...(!literal ? { dynamicPrefixes: [name] } : {}) });
		}
	}
	return mergeReactParameters(groups);
}

export function readReactInterpolationParameters(expression: ts.Expression | undefined, checker: ts.TypeChecker, options: Map<string, ts.Expression>): IPlaceholderParameterUsage {
	const replacement: ts.Expression | undefined = options.get('replace');
	const value: ts.Expression | undefined = replacement ? resolveReactExpression(replacement, checker) : undefined;
	const usesReplacement: boolean | undefined =
		value &&
		!isReactDefaultArgument(value) &&
		!ts.isStringLiteralLike(value) &&
		value.kind !== ts.SyntaxKind.FalseKeyword &&
		!(ts.isNumericLiteral(value) && Number(value.text) === 0);
	return readReactParameters(usesReplacement ? replacement : expression, checker);
}
