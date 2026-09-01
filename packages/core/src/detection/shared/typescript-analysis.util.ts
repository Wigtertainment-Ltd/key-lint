import ts from 'typescript';

import { ILoaderAnalysisSourceFile, ILoaderResourceTemplate, ILoaderSourceLocation } from '../loader-detection.interfaces.js';
import { IAnalysisContext, IConstantDeclaration, IImportedSymbol, IResolvedExpression, IStaticExpressionFailure } from './typescript-analysis.interfaces.js';

export function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current: ts.Expression = expression;
	while (
		ts.isParenthesizedExpression(current) ||
		ts.isAsExpression(current) ||
		ts.isTypeAssertionExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isNonNullExpression(current)
	) {
		current = current.expression;
	}
	return current;
}

function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
	const values: T[] = map.get(key) ?? [];
	values.push(value);
	map.set(key, values);
}

function isConstDeclaration(node: ts.VariableDeclaration): boolean {
	return ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

export function collectAnalysisContext(input: ILoaderAnalysisSourceFile): IAnalysisContext {
	const sourceFile: ts.SourceFile = ts.createSourceFile(
		input.filePath,
		input.content,
		ts.ScriptTarget.Latest,
		true,
		input.filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
	);
	const context: IAnalysisContext = {
		input,
		sourceFile,
		imports: new Map(),
		namespaces: new Map(),
		constantInitializers: new Map(),
		shadowDeclarations: new Map(),
		functionDeclarations: new Map(),
		classDeclarations: new Map()
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			const moduleName: string = statement.moduleSpecifier.text;
			const clause: ts.ImportClause | undefined = statement.importClause;
			if (clause?.name) {
				context.imports.set(clause.name.text, { moduleName, importedName: 'default' });
			}
			if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
				for (const element of clause.namedBindings.elements) {
					context.imports.set(element.name.text, {
						moduleName,
						importedName: element.propertyName?.text ?? element.name.text
					});
				}
			} else if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
				context.namespaces.set(clause.namedBindings.name.text, moduleName);
			}
		}
		if (ts.isFunctionDeclaration(statement) && statement.name) {
			appendMapValue(context.functionDeclarations, statement.name.text, statement);
		}
		if (ts.isClassDeclaration(statement) && statement.name) {
			appendMapValue(context.classDeclarations, statement.name.text, statement);
		}
	}

	const collectDeclarations = (node: ts.Node): void => {
		if (
			((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) ||
			((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && Boolean(node.name))
		) {
			const name: ts.BindingName | undefined = (node as ts.VariableDeclaration | ts.ParameterDeclaration | ts.FunctionDeclaration | ts.ClassDeclaration).name;
			if (name && ts.isIdentifier(name)) appendMapValue(context.shadowDeclarations, name.text, node);
		}
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isConstDeclaration(node)) {
			appendMapValue(context.constantInitializers, node.name.text, { declaration: node, initializer: node.initializer });
			const initializer: ts.Expression = unwrapExpression(node.initializer);
			if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
				appendMapValue(context.functionDeclarations, node.name.text, initializer);
			}
		}
		ts.forEachChild(node, collectDeclarations);
	};
	collectDeclarations(sourceFile);
	return context;
}

export function declarationScope(node: ts.Node): ts.Node {
	let current: ts.Node = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isBlock(current) || ts.isFunctionLike(current) || ts.isClassLike(current)) return current;
		current = current.parent;
	}
	return current;
}

export function isInside(node: ts.Node, possibleAncestor: ts.Node): boolean {
	let current: ts.Node | undefined = node;
	while (current) {
		if (current === possibleAncestor) return true;
		current = current.parent;
	}
	return false;
}

function visibleConstantDeclarations(identifier: ts.Identifier, declarations: IConstantDeclaration[]): IConstantDeclaration[] {
	const visible: IConstantDeclaration[] = declarations.filter(({ declaration }) => isInside(identifier, declarationScope(declaration)));
	if (visible.length < 2) return visible;
	const smallestScopeSize: number = Math.min(...visible.map(({ declaration }) => declarationScope(declaration).getWidth()));
	return visible.filter(({ declaration }) => declarationScope(declaration).getWidth() === smallestScopeSize);
}

function hasVisibleShadow(identifier: ts.Identifier, context: IAnalysisContext): boolean {
	const declarations: ts.Node[] = context.shadowDeclarations.get(identifier.text) ?? [];
	return declarations.some((declaration) => declarationScope(declaration) !== context.sourceFile && isInside(identifier, declarationScope(declaration)));
}

export function resolveExpression(expression: ts.Expression, context: IAnalysisContext, seen = new Set<string>()): IResolvedExpression {
	const unwrapped: ts.Expression = unwrapExpression(expression);
	if (!ts.isIdentifier(unwrapped)) return { expression: unwrapped };
	if (seen.has(unwrapped.text)) return { ambiguousNode: unwrapped };
	const declarations: IConstantDeclaration[] | undefined = context.constantInitializers.get(unwrapped.text);
	if (!declarations) return { expression: unwrapped };
	const visible: IConstantDeclaration[] = visibleConstantDeclarations(unwrapped, declarations);
	if (visible.length !== 1) return { ambiguousNode: unwrapped };
	seen.add(unwrapped.text);
	return resolveExpression(visible[0].initializer, context, seen);
}

export function resolveImportedSymbol(expression: ts.Expression, context: IAnalysisContext, seen = new Set<string>()): IImportedSymbol | undefined {
	const unwrapped: ts.Expression = unwrapExpression(expression);
	if (ts.isIdentifier(unwrapped)) {
		if (seen.has(unwrapped.text)) return undefined;
		const declarations: IConstantDeclaration[] | undefined = context.constantInitializers.get(unwrapped.text);
		const visible: IConstantDeclaration[] = declarations ? visibleConstantDeclarations(unwrapped, declarations) : [];
		if (visible.length === 1) {
			seen.add(unwrapped.text);
			return resolveImportedSymbol(visible[0].initializer, context, seen);
		}
		if (hasVisibleShadow(unwrapped, context)) return undefined;
		return context.imports.get(unwrapped.text);
	}
	if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
		if (hasVisibleShadow(unwrapped.expression, context)) return undefined;
		const moduleName: string | undefined = context.namespaces.get(unwrapped.expression.text);
		if (moduleName) return { moduleName, importedName: unwrapped.name.text };
	}
	return undefined;
}

export function locationOf(node: ts.Node, context: IAnalysisContext): ILoaderSourceLocation {
	const start: ts.LineAndCharacter = context.sourceFile.getLineAndCharacterOfPosition(node.getStart(context.sourceFile));
	const end: ts.LineAndCharacter = context.sourceFile.getLineAndCharacterOfPosition(node.getEnd());
	return {
		filePath: context.input.filePath,
		line: start.line + 1,
		column: start.character + 1,
		endLine: end.line + 1,
		endColumn: end.character + 1
	};
}

export function templateResource(urlTemplate: string): ILoaderResourceTemplate {
	const urlKind: "absolute" | "relative" = /^https?:\/\//i.test(urlTemplate) ? 'absolute' : 'relative';
	return { urlTemplate, urlKind, requiresOrigin: urlKind === 'relative' };
}

export function classifyStaticExpression(node: ts.Node, context: IAnalysisContext): IStaticExpressionFailure {
	let hasEnvironment: boolean = false;
	let hasConditional: boolean = false;
	let hasSpread: boolean = false;
	let hasTransformation: boolean = false;
	const inspect = (child: ts.Node): void => {
		if (ts.isConditionalExpression(child) || ts.isIfStatement(child) || ts.isSwitchStatement(child)) hasConditional = true;
		if (ts.isSpreadAssignment(child) || ts.isSpreadElement(child)) hasSpread = true;
		if (ts.isCallExpression(child) || ts.isTaggedTemplateExpression(child)) hasTransformation = true;
		if ((ts.isIdentifier(child) && /^(environment|env)$/i.test(child.text)) || child.getText(context.sourceFile).includes('process.env')) hasEnvironment = true;
		ts.forEachChild(child, inspect);
	};
	inspect(node);
	if (hasEnvironment) return { kind: 'environment', node };
	if (hasConditional) return { kind: 'conditional', node };
	if (hasSpread) return { kind: 'merge', node };
	if (hasTransformation) return { kind: 'transformation', node };
	return { kind: 'unsupported', node };
}

export function resolveStaticString(expression: ts.Expression, context: IAnalysisContext): { value?: string; failure?: IStaticExpressionFailure } {
	const resolved: IResolvedExpression = resolveExpression(expression, context);
	if (resolved.ambiguousNode) return { failure: { kind: 'ambiguous', node: resolved.ambiguousNode } };
	const value: ts.Expression = resolved.expression as ts.Expression;
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return { value: value.text };
	return { failure: classifyStaticExpression(value, context) };
}

export function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
	if (!property.name) return undefined;
	if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) return property.name.text;
	return undefined;
}

export function findProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
	return [...object.properties].reverse().find((property) => propertyName(property) === name);
}

export function unsafeObjectElement(object: ts.ObjectLiteralExpression): ts.ObjectLiteralElementLike | undefined {
	return object.properties.find((property) => ts.isSpreadAssignment(property) || propertyName(property) === undefined);
}

export function propertyExpression(property: ts.ObjectLiteralElementLike, context: IAnalysisContext): IResolvedExpression {
	if (ts.isPropertyAssignment(property)) return resolveExpression(property.initializer, context);
	if (ts.isShorthandPropertyAssignment(property)) return resolveExpression(property.name, context);
	return { expression: property as unknown as ts.Expression };
}

export function conditionalAncestor(node: ts.Node): ts.ConditionalExpression | undefined {
	let current: ts.Node = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isConditionalExpression(current)) return current;
		current = current.parent;
	}
	return undefined;
}

export function resolveFactoryDeclarations(identifier: ts.Identifier, context: IAnalysisContext): ts.Node[] {
	const declarations: (ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression)[] = context.functionDeclarations.get(identifier.text) ?? [];
	const visible: (ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression)[] = declarations.filter((declaration) => isInside(identifier, declarationScope(declaration)));
	if (visible.length < 2) return visible;
	const smallestScopeSize: number = Math.min(...visible.map((declaration) => declarationScope(declaration).getWidth()));
	return visible.filter((declaration) => declarationScope(declaration).getWidth() === smallestScopeSize);
}

export function collectNamedLiteralStringArrays(
	contexts: readonly IAnalysisContext[],
	namePattern: RegExp
): { values: string[]; failures: { context: IAnalysisContext; failure: IStaticExpressionFailure }[] } {
	const values: string[] = [];
	const failures: { context: IAnalysisContext; failure: IStaticExpressionFailure }[] = [];
	for (const context of contexts) {
		for (const [name, declarations] of context.constantInitializers) {
			if (!namePattern.test(name.replaceAll('_', '').toLowerCase())) continue;
			const topLevel: IConstantDeclaration[] = declarations.filter(({ declaration }) => declarationScope(declaration) === context.sourceFile);
			if (topLevel.length !== 1) continue;
			const resolved: IResolvedExpression = resolveExpression(topLevel[0].initializer, context);
			if (resolved.ambiguousNode) {
				failures.push({ context, failure: { kind: 'ambiguous', node: resolved.ambiguousNode } });
				continue;
			}
			const expression: ts.Expression | undefined = resolved.expression ? unwrapExpression(resolved.expression) : undefined;
			if (!expression || !ts.isArrayLiteralExpression(expression)) {
				failures.push({ context, failure: classifyStaticExpression(expression ?? topLevel[0].initializer, context) });
				continue;
			}
			const entries: string[] = [];
			let supported: boolean = true;
			for (const element of expression.elements) {
				if (ts.isSpreadElement(element)) {
					failures.push({ context, failure: classifyStaticExpression(element, context) });
					supported = false;
					continue;
				}
				const entry = resolveStaticString(element, context);
				if (entry.failure) {
					failures.push({ context, failure: entry.failure });
					supported = false;
				} else if (entry.value) {
					entries.push(entry.value);
				}
			}
			if (supported) {
				for (const entry of entries) if (!values.includes(entry)) values.push(entry);
			}
		}
	}
	return { values, failures };
}

function resolvePathSegments(value: string): string {
	const parts: string[] = [];
	for (const part of value.replaceAll('\\', '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return parts.join('/');
}

function resolveLocalModulePath(fromFile: string, moduleName: string, contexts: readonly IAnalysisContext[]): IAnalysisContext | undefined {
	if (!moduleName.startsWith('.')) return undefined;
	const directory: string = resolvePathSegments(fromFile).split('/').slice(0, -1).join('/');
	const base: string = resolvePathSegments(`${directory}/${moduleName}`);
	const candidates: string[] = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
	return contexts.find((context) => candidates.includes(resolvePathSegments(context.input.filePath)));
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

export function resolveClassDeclaration(
	expression: ts.Expression,
	context: IAnalysisContext,
	contexts: readonly IAnalysisContext[]
): { declaration?: ts.ClassDeclaration; context?: IAnalysisContext; ambiguousNode?: ts.Node } {
	const resolved: IResolvedExpression = resolveExpression(expression, context);
	if (resolved.ambiguousNode) return { ambiguousNode: resolved.ambiguousNode };
	const value: ts.Expression = resolved.expression as ts.Expression;
	if (ts.isIdentifier(value)) {
		const localClasses: ts.ClassDeclaration[] = context.classDeclarations.get(value.text) ?? [];
		if (localClasses.length === 1) return { declaration: localClasses[0], context };
		if (localClasses.length > 1) return { ambiguousNode: value };
		const imported: IImportedSymbol | undefined = context.imports.get(value.text);
		if (!imported) return {};
		const target: IAnalysisContext | undefined = resolveLocalModulePath(context.input.filePath, imported.moduleName, contexts);
		if (!target) return {};
		const classes: ts.ClassDeclaration[] = imported.importedName === 'default'
			? [...target.classDeclarations.values()].flat().filter((candidate) => hasModifier(candidate, ts.SyntaxKind.DefaultKeyword))
			: target.classDeclarations.get(imported.importedName) ?? [];
		if (classes.length === 1) return { declaration: classes[0], context: target };
		if (classes.length > 1) return { ambiguousNode: value };
		return {};
	}
	if (ts.isPropertyAccessExpression(value) && ts.isIdentifier(value.expression)) {
		const moduleName: string | undefined = context.namespaces.get(value.expression.text);
		if (!moduleName) return {};
		const target: IAnalysisContext | undefined = resolveLocalModulePath(context.input.filePath, moduleName, contexts);
		const classes: ts.ClassDeclaration[] = target?.classDeclarations.get(value.name.text) ?? [];
		if (classes.length === 1 && target) return { declaration: classes[0], context: target };
		if (classes.length > 1) return { ambiguousNode: value };
	}
	return {};
}

export function uniqueDiagnostics<T extends { code: string; location: ILoaderSourceLocation }>(diagnostics: readonly T[]): T[] {
	const seen: Set<string> = new Set<string>();
	return diagnostics.filter((diagnostic) => {
		const location: ILoaderSourceLocation = diagnostic.location;
		const key: string = `${diagnostic.code}:${location.filePath}:${location.line}:${location.column}:${location.endLine}:${location.endColumn}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
