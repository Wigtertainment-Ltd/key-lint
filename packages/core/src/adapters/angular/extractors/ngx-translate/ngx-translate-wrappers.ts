import ts from 'typescript';
import { unwrapExpression } from '../../../../detection/shared/typescript-analysis.util.js';

export interface INgxTranslateWrapper {
	keyArgumentIndex: number;
	interpolation: ts.Expression | { argumentIndex: number; defaultValue?: ts.Expression } | undefined;
}

function isNamedImport(reference: ts.Node, checker: ts.TypeChecker, moduleName: string, exportName: string): boolean {
	const declaration: ts.Declaration | undefined = checker.getSymbolAtLocation(reference)?.declarations?.[0];
	if (!declaration || !ts.isImportSpecifier(declaration) || (declaration.propertyName ?? declaration.name).text !== exportName) {
		return false;
	}

	const moduleSpecifier: ts.Expression = declaration.parent.parent.parent.moduleSpecifier;
	return ts.isStringLiteral(moduleSpecifier) && moduleSpecifier.text === moduleName;
}

/** Resolves the token expression of an Angular inject call, including aliased imports. */
export function getAngularInjectionToken(expression: ts.Expression, checker: ts.TypeChecker): ts.Expression | undefined {
	const call: ts.Expression = unwrapExpression(expression);
	if (!ts.isCallExpression(call) || !isNamedImport(call.expression, checker, '@angular/core', 'inject')) {
		return undefined;
	}
	return call.arguments[0] && unwrapExpression(call.arguments[0]);
}

function isNgxTranslateReceiver(receiver: ts.Expression, checker: ts.TypeChecker): boolean {
	const expression: ts.Expression = unwrapExpression(receiver);
	if (!ts.isPropertyAccessExpression(expression) || expression.expression.kind !== ts.SyntaxKind.ThisKeyword) {
		return false;
	}

	const declaration: ts.Declaration | undefined = checker.getSymbolAtLocation(expression.name)?.valueDeclaration;
	if (!declaration) {
		return false;
	}
	if (ts.isParameter(declaration)) {
		for (const decorator of ts.getDecorators(declaration) ?? []) {
			const call: ts.Expression = unwrapExpression(decorator.expression);
			if (ts.isCallExpression(call) && isNamedImport(call.expression, checker, '@angular/core', 'Inject')) {
				const token: ts.Expression | undefined = call.arguments[0];
				return token !== undefined && isNamedImport(unwrapExpression(token), checker, '@ngx-translate/core', 'TranslateService');
			}
		}
		return declaration.type !== undefined && ts.isTypeReferenceNode(declaration.type) &&
			isNamedImport(declaration.type.typeName, checker, '@ngx-translate/core', 'TranslateService');
	}
	if (!ts.isPropertyDeclaration(declaration) || !declaration.initializer) {
		return false;
	}

	const token: ts.Expression | undefined = getAngularInjectionToken(declaration.initializer, checker);
	return token !== undefined && isNamedImport(token, checker, '@ngx-translate/core', 'TranslateService');
}

function forwardedParameter(method: ts.MethodDeclaration, argument: ts.Expression | undefined, checker: ts.TypeChecker): ts.ParameterDeclaration | undefined {
	const value: ts.Expression | undefined = argument && unwrapExpression(argument);
	if (!value || !ts.isIdentifier(value)) {
		return undefined;
	}
	const parameter: ts.Declaration | undefined = checker.getSymbolAtLocation(value)?.valueDeclaration;
	return parameter && ts.isParameter(parameter) && !parameter.dotDotDotToken && method.parameters.includes(parameter) ? parameter : undefined;
}

function argumentIndex(method: ts.MethodDeclaration, parameter: ts.ParameterDeclaration): number {
	const index: number = method.parameters.indexOf(parameter);
	const firstParameter: ts.BindingName | undefined = method.parameters[0]?.name;
	return firstParameter && ts.isIdentifier(firstParameter) && firstParameter.text === 'this' ? index - 1 : index;
}

function describeWrapper(method: ts.MethodDeclaration, checker: ts.TypeChecker): INgxTranslateWrapper | undefined {
	const statement: ts.Statement | undefined = method.body?.statements[0];
	if (method.body?.statements.length !== 1 || !statement || !ts.isReturnStatement(statement) || !statement.expression) {
		return undefined;
	}

	const call: ts.Expression = unwrapExpression(statement.expression);
	if (!ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== 'instant') {
		return undefined;
	}

	const keyParameter: ts.ParameterDeclaration | undefined = forwardedParameter(method, call.arguments[0], checker);
	if (!keyParameter || !isNgxTranslateReceiver(call.expression.expression, checker)) {
		return undefined;
	}

	const interpolation: ts.Expression | undefined = call.arguments[1];
	const parameter: ts.ParameterDeclaration | undefined = forwardedParameter(method, interpolation, checker);
	return {
		keyArgumentIndex: argumentIndex(method, keyParameter),
		interpolation: parameter ? { argumentIndex: argumentIndex(method, parameter), defaultValue: parameter.initializer } : interpolation
	};
}

/**
 * Identifies direct wrappers of ngx-translate's instant method by the declaration of the receiver and the forwarded parameter.
 * Records the key's argument index and the expression used for interpolation by each verified method.
 */
export function findNgxTranslateWrappers(sourceFile: ts.SourceFile, checker: ts.TypeChecker): ReadonlyMap<ts.MethodDeclaration, INgxTranslateWrapper> {
	const wrappers: Map<ts.MethodDeclaration, INgxTranslateWrapper> = new Map<ts.MethodDeclaration, INgxTranslateWrapper>();
	const visit: (node: ts.Node) => void = (node: ts.Node): void => {
		if (ts.isMethodDeclaration(node) && ts.isClassLike(node.parent)) {
			const wrapper: INgxTranslateWrapper | undefined = describeWrapper(node, checker);
			if (wrapper) {
				wrappers.set(node, wrapper);
			}
		}
		ts.forEachChild(node, visit);
	};

	visit(sourceFile);
	return wrappers;
}
