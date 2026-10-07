import ts from 'typescript';

import { ILoaderAnalysisSourceFile, ILoaderResourceTemplate, ILoaderSourceLocation } from '../loader-detection.interfaces.js';
import { IAnalysisContext, IConstantDeclaration, IImportedSymbol, IResolvedExpression, IStaticExpressionFailure } from './typescript-analysis.interfaces.js';

/**
 * Removes parentheses, type assertions, satisfies expressions, and non-null wrappers from an AST expression.
 *
 * @param expression - Expression to inspect without modifying its AST.
 * @returns The innermost expression beneath the supported transparent wrappers.
 */
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

/**
 * Appends a declaration to a keyed collection, allocating its list when missing.
 *
 * @param map - Declaration map updated in place.
 * @param key - Name under which the value is collected.
 * @param value - Value appended in traversal order.
 */
function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
	const values: T[] = map.get(key) ?? [];
	values.push(value);
	map.set(key, values);
}

/**
 * Checks the parent declaration-list flags for a const binding.
 *
 * @param node - Variable declaration with parser-populated parent links.
 * @returns Whether the declaration belongs to a const declaration list.
 */
function isConstDeclaration(node: ts.VariableDeclaration): boolean {
	return ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

/**
 * Parses supplied source text and indexes imports, declarations, constants, and potential shadows.
 * Chooses TSX for filenames ending in `.tsx`; no type checker, module execution, or filesystem loading is used.
 * Imports and named classes/functions are indexed from top-level statements, with const functions also collected recursively.
 *
 * @param input - Source filename and text to analyze.
 * @returns A parent-linked AST and declaration maps for lightweight static resolution.
 */
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

	/**
	 * Walks the AST and records identifier declarations, const initializers, and const function expressions.
	 *
	 * @param node - Current AST node whose declarations and descendants are indexed.
	 */
	const collectDeclarations = (node: ts.Node): void => {
		if (
			((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) ||
			((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && Boolean(node.name))
		) {
			const name: ts.BindingName | undefined = node.name;
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

/**
 * Finds the closest parent block, function-like node, class-like node, or source file.
 * This structural scope heuristic is not a full model of JavaScript binding semantics.
 *
 * @param node - Declaration node with parent links.
 * @returns The nearest enclosing scope used by static visibility checks.
 */
export function declarationScope(node: ts.Node): ts.Node {
	let current: ts.Node = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isBlock(current) || ts.isFunctionLike(current) || ts.isClassLike(current)) return current;
		current = current.parent;
	}
	return current;
}

/**
 * Checks node identity and its parent chain for containment in an AST ancestor.
 *
 * @param node - Node whose ancestry is inspected.
 * @param possibleAncestor - Node to match, including the starting node itself.
 * @returns Whether the candidate occurs in the node's ancestor chain.
 */
export function isInside(node: ts.Node, possibleAncestor: ts.Node): boolean {
	let current: ts.Node | undefined = node;
	while (current) {
		if (current === possibleAncestor) return true;
		current = current.parent;
	}
	return false;
}

/**
 * Filters constant declarations by structural visibility and prefers the smallest enclosing source span.
 * Equal-sized visible scopes remain ambiguous rather than selecting one arbitrarily.
 *
 * @param identifier - Reference site whose enclosing scopes determine visibility.
 * @param declarations - Same-name constants available in the analysis context.
 * @returns Visible declarations in the most narrowly sized scope, or all matches when fewer than two exist.
 */
function visibleConstantDeclarations(identifier: ts.Identifier, declarations: IConstantDeclaration[]): IConstantDeclaration[] {
	const visible: IConstantDeclaration[] = declarations.filter(({ declaration }) => isInside(identifier, declarationScope(declaration)));
	if (visible.length < 2) return visible;
	const smallestScopeSize: number = Math.min(...visible.map(({ declaration }) => declarationScope(declaration).getWidth()));
	return visible.filter(({ declaration }) => declarationScope(declaration).getWidth() === smallestScopeSize);
}

/**
 * Checks whether a non-top-level declaration structurally shadows a referenced import name.
 *
 * @param identifier - Reference site to inspect.
 * @param context - Declaration index for the source file.
 * @returns Whether a same-name declaration encloses the identifier in a non-file scope.
 */
function hasVisibleShadow(identifier: ts.Identifier, context: IAnalysisContext): boolean {
	const declarations: ts.Node[] = context.shadowDeclarations.get(identifier.text) ?? [];
	return declarations.some((declaration) => declarationScope(declaration) !== context.sourceFile && isInside(identifier, declarationScope(declaration)));
}

/**
 * Unwraps an expression and recursively follows unambiguous visible const initializers.
 * Unresolved non-constant identifiers remain expressions; cycles and ambiguous declarations are reported as nodes.
 *
 * @param expression - Expression or identifier reference to resolve.
 * @param context - Source-local constant declarations and scope information.
 * @param seen - Mutable set of followed identifier names used to stop cycles.
 * @returns A resolved AST expression or the node at which resolution became ambiguous.
 */
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

/**
 * Resolves supported named/default imports, namespace members, and const aliases to module-symbol metadata.
 * Applies structural shadow checks without loading imports or using a TypeScript type checker.
 *
 * @param expression - Identifier or namespace property expression to inspect.
 * @param context - Import and declaration indexes for the containing file.
 * @param seen - Mutable alias-name set used to stop recursive cycles.
 * @returns The imported module and symbol name, or `undefined` when resolution is unsupported or shadowed.
 */
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

/**
 * Converts an AST node's start and exclusive end offsets into one-based source coordinates.
 *
 * @param node - Node belonging to the context's source file.
 * @param context - Parsed source and original file metadata.
 * @returns Original file path and the node's start/end line and column range.
 */
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

/**
 * Classifies a URL template by its HTTP(S) prefix without parsing or validating it.
 *
 * @param urlTemplate - Statically discovered endpoint template.
 * @returns Resource metadata marking non-HTTP-prefixed templates as relative and origin-dependent.
 */
export function templateResource(urlTemplate: string): ILoaderResourceTemplate {
	const urlKind: "absolute" | "relative" = /^https?:\/\//i.test(urlTemplate) ? 'absolute' : 'relative';
	return { urlTemplate, urlKind, requiresOrigin: urlKind === 'relative' };
}

/**
 * Classifies unsupported syntax by inspecting its subtree for runtime-dependent constructs.
 * Priority is environment references, conditionals, spreads, calls/tagged templates, then unsupported syntax.
 *
 * @param node - Unresolved syntax to classify.
 * @param context - Source file used to inspect node text.
 * @returns Failure category and the original diagnostic node.
 */
export function classifyStaticExpression(node: ts.Node, context: IAnalysisContext): IStaticExpressionFailure {
	let hasEnvironment: boolean = false;
	let hasConditional: boolean = false;
	let hasSpread: boolean = false;
	let hasTransformation: boolean = false;
	/**
	 * Recursively marks runtime-dependent constructs found in the unresolved subtree.
	 *
	 * @param child - AST node inspected for environment, conditional, merge, or transformation markers.
	 */
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

/**
 * Resolves const aliases to a string literal or a template literal without substitutions.
 * Does not concatenate strings, evaluate calls, or interpolate templates.
 *
 * @param expression - Source expression expected to contain a static string.
 * @param context - Constant and scope information used for resolution.
 * @returns Literal text, including an empty string, or a classified static-resolution failure.
 */
export function resolveStaticString(expression: ts.Expression, context: IAnalysisContext): { value?: string; failure?: IStaticExpressionFailure } {
	const resolved: IResolvedExpression = resolveExpression(expression, context);
	if (resolved.ambiguousNode) return { failure: { kind: 'ambiguous', node: resolved.ambiguousNode } };
	const value: ts.Expression = resolved.expression as ts.Expression;
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return { value: value.text };
	return { failure: classifyStaticExpression(value, context) };
}

/**
 * Extracts an identifier, quoted, or numeric property name without evaluating computed keys.
 *
 * @param property - Object-literal element to inspect.
 * @returns Supported property-name text, or `undefined` for unnamed or computed elements.
 */
export function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
	if (!property.name) return undefined;
	if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) return property.name.text;
	return undefined;
}

/**
 * Finds the last object-literal property with a supported matching name.
 *
 * @param object - Object expression to search without mutating its properties.
 * @param name - Exact, case-sensitive property name.
 * @returns The final matching element, or `undefined` when absent.
 */
export function findProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
	return [...object.properties].reverse().find((property) => propertyName(property) === name);
}

/**
 * Locates the first spread or unsupported property-name form that prevents deterministic field inspection.
 *
 * @param object - Object literal whose elements are inspected in source order.
 * @returns The first unsafe element, or `undefined` when every name is statically recognizable.
 */
export function unsafeObjectElement(object: ts.ObjectLiteralExpression): ts.ObjectLiteralElementLike | undefined {
	return object.properties.find((property) => ts.isSpreadAssignment(property) || propertyName(property) === undefined);
}

/**
 * Resolves an assignment initializer or shorthand property through local const aliases.
 * Other property forms are returned as diagnostic expression nodes without evaluation.
 *
 * @param property - Object-literal element supplying a configuration value.
 * @param context - Declaration and scope information used for resolution.
 * @returns Resolved property expression or ambiguity metadata.
 */
export function propertyExpression(property: ts.ObjectLiteralElementLike, context: IAnalysisContext): IResolvedExpression {
	if (ts.isPropertyAssignment(property)) return resolveExpression(property.initializer, context);
	if (ts.isShorthandPropertyAssignment(property)) return resolveExpression(property.name, context);
	return { expression: property as unknown as ts.Expression };
}

/**
 * Finds the nearest enclosing ternary expression while walking toward the source file.
 * Does not classify enclosing if or switch statements.
 *
 * @param node - Node whose parent chain is searched.
 * @returns The nearest conditional-expression ancestor, or `undefined`.
 */
export function conditionalAncestor(node: ts.Node): ts.ConditionalExpression | undefined {
	let current: ts.Node = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isConditionalExpression(current)) return current;
		current = current.parent;
	}
	return undefined;
}

/**
 * Finds structurally visible same-name factory declarations and prefers the smallest enclosing scope span.
 * Returns all equally narrow matches so callers can decide how to handle ambiguity.
 *
 * @param identifier - Factory reference site.
 * @param context - Indexed named and const-assigned functions.
 * @returns Matching declaration nodes without executing their bodies.
 */
export function resolveFactoryDeclarations(identifier: ts.Identifier, context: IAnalysisContext): ts.Node[] {
	const declarations: (ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression)[] = context.functionDeclarations.get(identifier.text) ?? [];
	const visible: (ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression)[] = declarations.filter((declaration) => isInside(identifier, declarationScope(declaration)));
	if (visible.length < 2) return visible;
	const smallestScopeSize: number = Math.min(...visible.map((declaration) => declarationScope(declaration).getWidth()));
	return visible.filter((declaration) => declarationScope(declaration).getWidth() === smallestScopeSize);
}

/**
 * Collects unique non-empty strings from matching, uniquely declared top-level const arrays.
 * Normalizes names by removing underscores and lowercasing; arrays with unsupported entries contribute failures but no values.
 *
 * @param contexts - Parsed source contexts searched in input order.
 * @param namePattern - Pattern applied to normalized names; callers should avoid stateful regex flags.
 * @returns First-seen unique values and classified failures with their source contexts.
 */
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

/**
 * Normalizes separators and collapses dot segments for comparing supplied source-module paths.
 * Removes empty segments, including a leading slash; does not perform filesystem resolution.
 *
 * @param value - Path text used in local module lookup.
 * @returns Slash-separated comparison path after dot-segment reduction.
 */
function resolvePathSegments(value: string): string {
	const parts: string[] = [];
	for (const part of value.replaceAll('\\', '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') parts.pop();
		else parts.push(part);
	}
	return parts.join('/');
}

/**
 * Resolves a relative import against supplied TS/TSX files and index-file candidates.
 * Does not support package imports, path aliases, module re-exports, or reading additional files.
 *
 * @param fromFile - Importing source path.
 * @param moduleName - Module specifier, which must begin with a dot.
 * @param contexts - Available source contexts searched in their input order.
 * @returns The first matching context, or `undefined` when no supplied file matches.
 */
function resolveLocalModulePath(fromFile: string, moduleName: string, contexts: readonly IAnalysisContext[]): IAnalysisContext | undefined {
	if (!moduleName.startsWith('.')) return undefined;
	const directory: string = resolvePathSegments(fromFile).split('/').slice(0, -1).join('/');
	const base: string = resolvePathSegments(`${directory}/${moduleName}`);
	const candidates: string[] = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
	return contexts.find((context) => candidates.includes(resolvePathSegments(context.input.filePath)));
}

/**
 * Checks whether a node supports modifiers and has the requested modifier kind.
 *
 * @param node - Syntax node to inspect.
 * @param kind - Modifier syntax kind to match.
 * @returns Whether the modifier is present.
 */
function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
	return ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some((modifier) => modifier.kind === kind));
}

/**
 * Resolves local or relatively imported loader classes using supplied declaration indexes.
 * Supports const aliases, named/default imports, and direct namespace members; does not use type checking or module execution.
 *
 * @param expression - Loader class reference to resolve.
 * @param context - Source context containing the reference.
 * @param contexts - Available local module contexts.
 * @returns The class and owning context, an ambiguous node, or an empty result when unresolved.
 */
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

/**
 * Removes diagnostics sharing the same code, file path, and complete source range.
 * Message and category do not affect identity, and the first original record is retained.
 *
 * @param diagnostics - Ordered diagnostic records to deduplicate.
 * @returns A new array of original diagnostic objects in first-seen order.
 */
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
