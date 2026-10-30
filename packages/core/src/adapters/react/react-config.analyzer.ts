import ts from 'typescript';
import { ILoaderAnalysisSourceFile } from '../../detection/loader-detection.interfaces.js';
import { isReactDefaultArgument, parseReactSource, readReactOptions, readReactString, readReactStringList, resolveReactExpression } from './react-typescript.util.js';

function isI18nextImport(expression: ts.Expression, checker: ts.TypeChecker, importedName: 'default' | 'init'): boolean {
	const value: ts.Expression = resolveReactExpression(expression, checker);
	const symbol: ts.Symbol | undefined = checker.getSymbolAtLocation(value);
	return (
		symbol?.declarations?.some((declaration: ts.Declaration): boolean => {
			const statement: ts.ImportDeclaration | undefined = ts.findAncestor(declaration, ts.isImportDeclaration);
			if (!statement || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'i18next' || statement.importClause?.isTypeOnly) {
				return false;
			}
			if (ts.isImportSpecifier(declaration)) {
				return !declaration.isTypeOnly && (declaration.propertyName ?? declaration.name).text === importedName;
			}
			return importedName === 'default' && (ts.isImportClause(declaration) || ts.isNamespaceImport(declaration));
		}) ?? false
	);
}

function isI18nextInit(call: ts.CallExpression, checker: ts.TypeChecker): boolean {
	if (ts.isIdentifier(call.expression)) {
		return isI18nextImport(call.expression, checker, 'init');
	}
	if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'init') {
		return false;
	}
	let receiver: ts.Expression = resolveReactExpression(call.expression.expression, checker);
	while (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression) && receiver.expression.name.text === 'use') {
		receiver = resolveReactExpression(receiver.expression.expression, checker);
	}
	return isI18nextImport(receiver, checker, 'default');
}

function defaultNamespaceOf(call: ts.CallExpression, checker: ts.TypeChecker): string {
	const argument: ts.Expression | undefined = call.arguments[0] ? resolveReactExpression(call.arguments[0], checker) : undefined;
	if (argument && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
		return 'translation';
	}
	const options: Map<string, ts.Expression> = readReactOptions(call.arguments[0], checker);
	const explicit: ts.Expression | undefined = options.get('defaultNS');
	if (explicit && !isReactDefaultArgument(resolveReactExpression(explicit, checker))) {
		return readReactString(explicit, checker);
	}
	const ns: ts.Expression | undefined = options.get('ns');
	if (!ns) {
		return 'translation';
	}
	const namespaces: string[] = readReactStringList(ns, checker);
	return namespaces.includes('translation') ? 'translation' : (namespaces[0] ?? 'translation');
}

function collectDefaultNamespaces(node: ts.Node, checker: ts.TypeChecker, namespaces: Set<string>): void {
	if (ts.isCallExpression(node) && isI18nextInit(node, checker)) {
		namespaces.add(defaultNamespaceOf(node, checker));
	}
	ts.forEachChild(node, (child: ts.Node): undefined => {
		collectDefaultNamespaces(child, checker, namespaces);
	});
}

/** Resolves the singleton i18next default namespace from static initialization options. */
export function detectReactDefaultNamespace(sources: readonly ILoaderAnalysisSourceFile[]): string {
	const namespaces: Set<string> = new Set<string>();
	for (const { filePath, content } of sources) {
		const { sourceFile, checker }: { sourceFile: ts.SourceFile; checker: ts.TypeChecker } = parseReactSource(filePath, content);
		collectDefaultNamespaces(sourceFile, checker, namespaces);
	}
	if (namespaces.size > 1) {
		throw new Error('Conflicting i18next default namespaces were found; a single default namespace cannot be determined statically.');
	}
	return [...namespaces][0] ?? 'translation';
}
