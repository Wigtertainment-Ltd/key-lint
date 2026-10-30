import ts from 'typescript';

import { unwrapExpression } from '../../detection/shared/typescript-analysis.util.js';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { readReactInterpolationParameters } from './react-placeholder.util.js';
import { IReactTranslationScope, reactCallOptions } from './react-scope.util.js';
import { reactKeyUsage, reactPluralUsage } from './react-key-usage.util.js';
import { extractReactTrans } from './react-trans.extractor.js';
import {
	IReactImports,
	isReactDefaultArgument,
	matchesReactImport,
	parseReactSource,
	readReactOptions,
	readReactString,
	readReactStringList,
	resolveReactExpression
} from './react-typescript.util.js';

function collectImports(sourceFile: ts.SourceFile, checker: ts.TypeChecker): IReactImports {
	const hooks = new Set<ts.Symbol>();
	const components = new Set<ts.Symbol>();
	const namespaces = new Set<ts.Symbol>();

	for (const statement of sourceFile.statements) {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'react-i18next') continue;
		const clause = statement.importClause;
		if (!clause || clause.isTypeOnly) continue;
		const bindings = clause.namedBindings;
		if (bindings && ts.isNamedImports(bindings)) {
			for (const element of bindings.elements) {
				const symbol = checker.getSymbolAtLocation(element.name);
				if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'useTranslation' && symbol) hooks.add(symbol);
				if (!element.isTypeOnly && (element.propertyName ?? element.name).text === 'Trans' && symbol) components.add(symbol);
			}
		} else if (bindings && ts.isNamespaceImport(bindings)) {
			const symbol = checker.getSymbolAtLocation(bindings.name);
			if (symbol) namespaces.add(symbol);
		}
	}

	return { hooks, components, namespaces };
}

function hookScope(call: ts.CallExpression, checker: ts.TypeChecker, defaultNamespace: string): IReactTranslationScope {
	const namespace = call.arguments[0] ? resolveReactExpression(call.arguments[0], checker) : undefined;
	const options = readReactOptions(call.arguments[1], checker);
	const prefix = options.get('keyPrefix');
	return {
		namespace: !namespace || isReactDefaultArgument(namespace) ? defaultNamespace : readReactStringList(namespace, checker)[0] || defaultNamespace,
		keyPrefix: !prefix || isReactDefaultArgument(resolveReactExpression(prefix, checker)) ? '' : readReactString(prefix, checker)
	};
}

function collectBindings(
	node: ts.Node,
	checker: ts.TypeChecker,
	hooks: Set<ts.Symbol>,
	namespaces: Set<ts.Symbol>,
	defaultNamespace: string,
	translators = new Map<ts.Symbol, IReactTranslationScope>()
): Map<ts.Symbol, IReactTranslationScope> {
	if (ts.isVariableDeclaration(node) && node.initializer && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
		const initializer = unwrapExpression(node.initializer);
		if (ts.isCallExpression(initializer) && matchesReactImport(initializer.expression, checker, hooks, namespaces, 'useTranslation')) {
			const scope = hookScope(initializer, checker, defaultNamespace);
			const elements = ts.isObjectBindingPattern(node.name)
				? node.name.elements.filter((element) => (element.propertyName ?? element.name).getText() === 't')
				: ts.isArrayBindingPattern(node.name)
					? node.name.elements.slice(0, 1)
					: [];
			for (const element of elements) {
				if (!ts.isBindingElement(element) || element.dotDotDotToken || !ts.isIdentifier(element.name)) continue;
				const symbol = checker.getSymbolAtLocation(element.name);
				if (symbol) translators.set(symbol, scope);
			}
		}
	}
	ts.forEachChild(node, (child) => {
		collectBindings(child, checker, hooks, namespaces, defaultNamespace, translators);
	});
	return translators;
}

function collectCalls(
	node: ts.Node,
	checker: ts.TypeChecker,
	translators: Map<ts.Symbol, IReactTranslationScope>,
	imports: IReactImports,
	defaultNamespace: string,
	usages: IKeyUsage[] = []
): IKeyUsage[] {
	if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
		const usage = extractReactTrans(node, checker, imports, translators, defaultNamespace);
		if (usage) usages.push(usage);
	}
	if (ts.isCallExpression(node)) {
		const callee = unwrapExpression(node.expression);
		const symbol = checker.getSymbolAtLocation(callee);
		const scope = symbol ? translators.get(symbol) : undefined;
		const argument = node.arguments[0] ? unwrapExpression(node.arguments[0]) : undefined;
		if (ts.isIdentifier(callee) && scope && argument) {
			const sourceFile = node.getSourceFile();
			const sourceIndex = node.getStart(sourceFile);
			const { line, character } = sourceFile.getLineAndCharacterOfPosition(sourceIndex);
			const parameters = reactCallOptions(node, checker);
			const options = readReactOptions(parameters, checker);
			usages.push({
				...reactKeyUsage(argument, checker, scope, options),
				plural: reactPluralUsage(options, checker),
				filePath: sourceFile.fileName,
				line: line + 1,
				column: character + 1,
				sourceIndex,
				snippet: node.getText(sourceFile),
				matchType: 'react-hook-t',
				placeholderParameters: readReactInterpolationParameters(parameters, checker, options)
			});
		}
	}
	ts.forEachChild(node, (child) => {
		collectCalls(child, checker, translators, imports, defaultNamespace, usages);
	});
	return usages;
}

/** Extracts static hook calls with their namespace and keyPrefix scope. */
export function extractReactUsages(filePath: string, source: string, defaultNamespace = 'translation'): IKeyUsage[] {
	const { sourceFile, checker } = parseReactSource(filePath, source);
	const imports = collectImports(sourceFile, checker);
	const translators = collectBindings(sourceFile, checker, imports.hooks, imports.namespaces, defaultNamespace);
	return collectCalls(sourceFile, checker, translators, imports, defaultNamespace);
}
