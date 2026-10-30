import ts from 'typescript';
import { IPlaceholderParameterUsage } from '../../util/placeholder.util.js';
import { isReactDefaultArgument, reactPropertyName, resolveReactExpression } from './react-typescript.util.js';

export function mergeReactParameters(groups: IPlaceholderParameterUsage[]): IPlaceholderParameterUsage {
	const names = new Set<string>();
	const prefixes = new Set<string>();
	for (const group of groups) {
		if (group.kind === 'dynamic') {
			for (const name of names) {
				if (name.includes('.')) {
					names.delete(name);
					prefixes.add(name.split('.')[0]);
				}
			}
		}
		for (const root of group.names.filter((name) => !name.includes('.'))) {
			for (const name of names) if (name === root || name.startsWith(`${root}.`)) names.delete(name);
			for (const prefix of prefixes) if (prefix === root || prefix.startsWith(`${root}.`)) prefixes.delete(prefix);
		}
		group.names.forEach((name) => names.add(name));
		group.dynamicPrefixes?.forEach((prefix) => prefixes.add(prefix));
	}
	return {
		kind: groups.some((group) => group.kind === 'dynamic') ? 'dynamic' : groups.some((group) => group.kind === 'static') ? 'static' : 'absent',
		names: [...names].sort((a, b) => a.localeCompare(b)),
		...(prefixes.size ? { dynamicPrefixes: [...prefixes].sort((a, b) => a.localeCompare(b)) } : {})
	};
}

/** Extracts parameter paths without evaluating values; unresolved nested objects retain their path prefix. */
export function readReactParameters(expression: ts.Expression | undefined, checker: ts.TypeChecker, seen = new Set<ts.Node>()): IPlaceholderParameterUsage {
	if (!expression) return { kind: 'absent', names: [] };
	const value = resolveReactExpression(expression, checker);
	if (isReactDefaultArgument(value)) return { kind: 'absent', names: [] };
	if (!ts.isObjectLiteralExpression(value) || seen.has(value)) return { kind: 'dynamic', names: [] };
	const ancestors = new Set(seen).add(value);
	const groups: IPlaceholderParameterUsage[] = [{ kind: 'static', names: [] }];
	for (const property of value.properties) {
		if (ts.isSpreadAssignment(property)) {
			groups.push(readReactParameters(property.expression, checker, ancestors));
			continue;
		}
		const name = property.name ? reactPropertyName(property.name, checker) : undefined;
		if (name === undefined || (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property))) {
			groups.push({ kind: 'dynamic', names: [] });
			continue;
		}
		const child = resolveReactExpression(ts.isPropertyAssignment(property) ? property.initializer : property.name, checker);
		if (ts.isObjectLiteralExpression(child) && !ancestors.has(child)) {
			const nested = readReactParameters(child, checker, ancestors);
			groups.push({
				kind: nested.kind,
				names: [name, ...nested.names.map((path) => `${name}.${path}`)],
				dynamicPrefixes: nested.kind === 'dynamic' ? [name] : nested.dynamicPrefixes?.map((path) => `${name}.${path}`)
			});
		} else {
			const literal =
				ts.isStringLiteralLike(child) ||
				ts.isNumericLiteral(child) ||
				[ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(child.kind);
			groups.push({ kind: 'static', names: [name], ...(!literal ? { dynamicPrefixes: [name] } : {}) });
		}
	}
	return mergeReactParameters(groups);
}

export function readReactInterpolationParameters(expression: ts.Expression | undefined, checker: ts.TypeChecker, options: Map<string, ts.Expression>): IPlaceholderParameterUsage {
	const replacement = options.get('replace');
	const value = replacement ? resolveReactExpression(replacement, checker) : undefined;
	const usesReplacement =
		value &&
		!isReactDefaultArgument(value) &&
		!ts.isStringLiteralLike(value) &&
		value.kind !== ts.SyntaxKind.FalseKeyword &&
		!(ts.isNumericLiteral(value) && Number(value.text) === 0);
	return readReactParameters(usesReplacement ? replacement : expression, checker);
}
