import ts from 'typescript';

import {
	ILoaderAnalysisSourceFile, ILoaderDetectionDiagnostic, ILoaderResourceTemplate, ILoaderSourceLocation, ITranslationLoaderAnalysisResult,
	ITranslationLoaderCandidate
} from './loader-detection.interfaces.js';

const HTTP_LOADER_MODULE = '@ngx-translate/http-loader';
const TRANSLATE_CORE_MODULE = '@ngx-translate/core';
const DEFAULT_PREFIX = '/assets/i18n/';
const DEFAULT_SUFFIX = '.json';

interface IImportedSymbol {
	moduleName: string;
	importedName: string;
}

interface IAnalysisContext {
	input: ILoaderAnalysisSourceFile;
	sourceFile: ts.SourceFile;
	imports: Map<string, IImportedSymbol>;
	namespaces: Map<string, string>;
	constantInitializers: Map<string, IConstantDeclaration[]>;
	shadowDeclarations: Map<string, ts.Node[]>;
	functionDeclarations: Map<string, Array<ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression>>;
}

interface IConstantDeclaration {
	declaration: ts.VariableDeclaration;
	initializer: ts.Expression;
}

interface IResolvedExpression {
	expression?: ts.Expression;
	ambiguousNode?: ts.Node;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
	let current = expression;
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

function collectContext(input: ILoaderAnalysisSourceFile): IAnalysisContext {
	const sourceFile = ts.createSourceFile(
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
		functionDeclarations: new Map()
	};

	for (const statement of sourceFile.statements) {
		if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
			const moduleName = statement.moduleSpecifier.text;
			const clause = statement.importClause;
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
	}

	const collectDeclarations = (node: ts.Node): void => {
		if (
			((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) ||
			((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && Boolean(node.name))
		) {
			const name = (node as ts.VariableDeclaration | ts.ParameterDeclaration | ts.FunctionDeclaration | ts.ClassDeclaration).name;
			if (name && ts.isIdentifier(name)) appendMapValue(context.shadowDeclarations, name.text, node);
		}
		if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isConstDeclaration(node)) {
			appendMapValue(context.constantInitializers, node.name.text, { declaration: node, initializer: node.initializer });
			const initializer = unwrapExpression(node.initializer);
			if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
				appendMapValue(context.functionDeclarations, node.name.text, initializer);
			}
		}
		ts.forEachChild(node, collectDeclarations);
	};
	collectDeclarations(sourceFile);
	return context;
}

function appendMapValue<T>(map: Map<string, T[]>, key: string, value: T): void {
	const values = map.get(key) ?? [];
	values.push(value);
	map.set(key, values);
}

function isConstDeclaration(node: ts.VariableDeclaration): boolean {
	return ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0;
}

function declarationScope(node: ts.Node): ts.Node {
	let current = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isBlock(current) || ts.isFunctionLike(current) || ts.isClassLike(current)) return current;
		current = current.parent;
	}
	return current;
}

function isInside(node: ts.Node, possibleAncestor: ts.Node): boolean {
	let current: ts.Node | undefined = node;
	while (current) {
		if (current === possibleAncestor) return true;
		current = current.parent;
	}
	return false;
}

function visibleConstantDeclarations(identifier: ts.Identifier, declarations: IConstantDeclaration[]): IConstantDeclaration[] {
	const visible = declarations.filter(({ declaration }) => isInside(identifier, declarationScope(declaration)));
	if (visible.length < 2) return visible;
	const smallestScopeSize = Math.min(...visible.map(({ declaration }) => declarationScope(declaration).getWidth()));
	return visible.filter(({ declaration }) => declarationScope(declaration).getWidth() === smallestScopeSize);
}

function hasVisibleShadow(identifier: ts.Identifier, context: IAnalysisContext): boolean {
	const declarations = context.shadowDeclarations.get(identifier.text) ?? [];
	return declarations.some((declaration) => declarationScope(declaration) !== context.sourceFile && isInside(identifier, declarationScope(declaration)));
}

function resolveExpression(expression: ts.Expression, context: IAnalysisContext, seen = new Set<string>()): IResolvedExpression {
	const unwrapped = unwrapExpression(expression);
	if (!ts.isIdentifier(unwrapped)) {
		return { expression: unwrapped };
	}
	if (seen.has(unwrapped.text)) {
		return { ambiguousNode: unwrapped };
	}
	const declarations = context.constantInitializers.get(unwrapped.text);
	if (!declarations) {
		return { expression: unwrapped };
	}
	const visible = visibleConstantDeclarations(unwrapped, declarations);
	if (visible.length !== 1) {
		return { ambiguousNode: unwrapped };
	}
	seen.add(unwrapped.text);
	return resolveExpression(visible[0].initializer, context, seen);
}

function resolveImportedSymbol(expression: ts.Expression, context: IAnalysisContext, seen = new Set<string>()): IImportedSymbol | undefined {
	const unwrapped = unwrapExpression(expression);
	if (ts.isIdentifier(unwrapped)) {
		if (seen.has(unwrapped.text)) return undefined;
		const declarations = context.constantInitializers.get(unwrapped.text);
		const visible = declarations ? visibleConstantDeclarations(unwrapped, declarations) : [];
		if (visible.length === 1) {
			seen.add(unwrapped.text);
			return resolveImportedSymbol(visible[0].initializer, context, seen);
		}
		if (hasVisibleShadow(unwrapped, context)) return undefined;
		const direct = context.imports.get(unwrapped.text);
		if (direct) return direct;
		return undefined;
	}
	if (ts.isPropertyAccessExpression(unwrapped) && ts.isIdentifier(unwrapped.expression)) {
		if (hasVisibleShadow(unwrapped.expression, context)) return undefined;
		const moduleName = context.namespaces.get(unwrapped.expression.text);
		if (moduleName) return { moduleName, importedName: unwrapped.name.text };
	}
	return undefined;
}

function locationOf(node: ts.Node, context: IAnalysisContext): ILoaderSourceLocation {
	const start = context.sourceFile.getLineAndCharacterOfPosition(node.getStart(context.sourceFile));
	const end = context.sourceFile.getLineAndCharacterOfPosition(node.getEnd());
	return {
		filePath: context.input.filePath,
		line: start.line + 1,
		column: start.character + 1,
		endLine: end.line + 1,
		endColumn: end.character + 1
	};
}

function templateResource(urlTemplate: string): ILoaderResourceTemplate {
	const urlKind = /^https?:\/\//i.test(urlTemplate) ? 'absolute' : 'relative';
	return { urlTemplate, urlKind, requiresOrigin: urlKind === 'relative' };
}

function diagnosticForExpression(expression: ts.Node, context: IAnalysisContext): ILoaderDetectionDiagnostic {
	let hasEnvironment = false;
	let hasConditional = false;
	let hasSpread = false;
	let hasTransformation = false;
	const inspect = (node: ts.Node): void => {
		if (ts.isConditionalExpression(node) || ts.isIfStatement(node) || ts.isSwitchStatement(node)) hasConditional = true;
		if (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) hasSpread = true;
		if (ts.isCallExpression(node) || ts.isTaggedTemplateExpression(node)) hasTransformation = true;
		if ((ts.isIdentifier(node) && /^(environment|env)$/i.test(node.text)) || node.getText(context.sourceFile).includes('process.env')) hasEnvironment = true;
		ts.forEachChild(node, inspect);
	};
	inspect(expression);

	if (hasEnvironment) {
		return {
			code: 'ngx-http-dynamic-environment',
			category: 'dynamic',
			message: 'ngx-translate loader URLs that depend on runtime environment values require explicit configuration.',
			location: locationOf(expression, context)
		};
	}
	if (hasConditional) {
		return {
			code: 'ngx-http-conditional-url',
			category: 'dynamic',
			message: 'Conditional ngx-translate loader URL construction cannot be resolved deterministically.',
			location: locationOf(expression, context)
		};
	}
	if (hasSpread) {
		return {
			code: 'ngx-http-ambiguous-merge',
			category: 'ambiguous',
			message: 'Spread or merged ngx-translate loader configuration may override URL fields and requires explicit configuration.',
			location: locationOf(expression, context)
		};
	}
	if (hasTransformation) {
		return {
			code: 'ngx-http-unsupported-transformation',
			category: 'unsupported',
			message: 'Transformed ngx-translate loader URL values are not executed or guessed.',
			location: locationOf(expression, context)
		};
	}
	return {
		code: 'ngx-http-unsupported-expression',
		category: 'unsupported',
		message: 'ngx-translate loader URL values must be statically resolvable string literals.',
		location: locationOf(expression, context)
	};
}

function ambiguousDiagnostic(node: ts.Node, context: IAnalysisContext): ILoaderDetectionDiagnostic {
	return {
		code: 'ngx-http-ambiguous-reference',
		category: 'ambiguous',
		message: 'This ngx-translate loader reference has multiple possible static declarations and was not guessed.',
		location: locationOf(node, context)
	};
}

function resolveString(expression: ts.Expression, context: IAnalysisContext): { value?: string; diagnostic?: ILoaderDetectionDiagnostic } {
	const resolved = resolveExpression(expression, context);
	if (resolved.ambiguousNode) return { diagnostic: ambiguousDiagnostic(resolved.ambiguousNode, context) };
	const value = resolved.expression as ts.Expression;
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return { value: value.text };
	return { diagnostic: diagnosticForExpression(value, context) };
}

function propertyName(property: ts.ObjectLiteralElementLike): string | undefined {
	if (!property.name) return undefined;
	if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) return property.name.text;
	return undefined;
}

function findProperty(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
	return [...object.properties].reverse().find((property) => propertyName(property) === name);
}

function unsafeObjectElement(object: ts.ObjectLiteralExpression): ts.ObjectLiteralElementLike | undefined {
	return object.properties.find((property) => ts.isSpreadAssignment(property) || propertyName(property) === undefined);
}

function propertyExpression(property: ts.ObjectLiteralElementLike, context: IAnalysisContext): IResolvedExpression {
	if (ts.isPropertyAssignment(property)) return resolveExpression(property.initializer, context);
	if (ts.isShorthandPropertyAssignment(property)) return resolveExpression(property.name, context);
	return { expression: property as unknown as ts.Expression };
}

function parseResourceEntry(entry: ts.Expression, context: IAnalysisContext): { resource?: ILoaderResourceTemplate; diagnostic?: ILoaderDetectionDiagnostic } {
	const resolved = resolveExpression(entry, context);
	if (resolved.ambiguousNode) return { diagnostic: ambiguousDiagnostic(resolved.ambiguousNode, context) };
	const value = resolved.expression as ts.Expression;
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
		return { resource: templateResource(`${value.text}{locale}${DEFAULT_SUFFIX}`) };
	}
	if (!ts.isObjectLiteralExpression(value)) return { diagnostic: diagnosticForExpression(value, context) };
	const unsafeProperty = unsafeObjectElement(value);
	if (unsafeProperty) return { diagnostic: diagnosticForExpression(unsafeProperty, context) };
	const prefixProperty = findProperty(value, 'prefix');
	if (!prefixProperty) return { diagnostic: diagnosticForExpression(value, context) };
	const prefixResolved = propertyExpression(prefixProperty, context);
	if (prefixResolved.ambiguousNode) return { diagnostic: ambiguousDiagnostic(prefixResolved.ambiguousNode, context) };
	const prefix = resolveString(prefixResolved.expression as ts.Expression, context);
	if (prefix.diagnostic) return { diagnostic: prefix.diagnostic };
	const suffixProperty = findProperty(value, 'suffix');
	let suffixValue = DEFAULT_SUFFIX;
	if (suffixProperty) {
		const suffixResolved = propertyExpression(suffixProperty, context);
		if (suffixResolved.ambiguousNode) return { diagnostic: ambiguousDiagnostic(suffixResolved.ambiguousNode, context) };
		const suffix = resolveString(suffixResolved.expression as ts.Expression, context);
		if (suffix.diagnostic) return { diagnostic: suffix.diagnostic };
		suffixValue = suffix.value as string;
	}
	return { resource: templateResource(`${prefix.value}{locale}${suffixValue}`) };
}

function parseModernCall(call: ts.CallExpression, context: IAnalysisContext): { candidate?: ITranslationLoaderCandidate; diagnostics: ILoaderDetectionDiagnostic[] } {
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	let resources: ILoaderResourceTemplate[] = [];
	if (call.arguments.length > 1) return { diagnostics: [diagnosticForExpression(call.arguments[1], context)] };
	if (call.arguments.length === 0) {
		resources = [templateResource(`${DEFAULT_PREFIX}{locale}${DEFAULT_SUFFIX}`)];
	} else {
		const config = resolveExpression(call.arguments[0], context);
		if (config.ambiguousNode) return { diagnostics: [ambiguousDiagnostic(config.ambiguousNode, context)] };
		if (!config.expression || !ts.isObjectLiteralExpression(config.expression)) {
			return { diagnostics: [diagnosticForExpression(config.expression ?? call.arguments[0], context)] };
		}
		const unsafeProperty = unsafeObjectElement(config.expression);
		if (unsafeProperty) {
			return { diagnostics: [diagnosticForExpression(unsafeProperty, context)] };
		}
		const resourcesProperty = findProperty(config.expression, 'resources');
		if (resourcesProperty) {
			const resolvedResources = propertyExpression(resourcesProperty, context);
			if (resolvedResources.ambiguousNode) return { diagnostics: [ambiguousDiagnostic(resolvedResources.ambiguousNode, context)] };
			const resourceArray = resolvedResources.expression ? unwrapExpression(resolvedResources.expression) : undefined;
			if (!resourceArray || !ts.isArrayLiteralExpression(resourceArray)) {
				return { diagnostics: [diagnosticForExpression(resolvedResources.expression ?? resourcesProperty, context)] };
			}
			if (resourceArray.elements.length === 0) {
				return { diagnostics: [diagnosticForExpression(resourceArray, context)] };
			}
			for (const entry of resourceArray.elements) {
				if (ts.isSpreadElement(entry)) {
					diagnostics.push(diagnosticForExpression(entry, context));
					continue;
				}
				const parsed = parseResourceEntry(entry, context);
				if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
				if (parsed.resource) resources.push(parsed.resource);
			}
		} else {
			const prefixProperty = findProperty(config.expression, 'prefix');
			const suffixProperty = findProperty(config.expression, 'suffix');
			const prefix = prefixProperty ? resolvePropertyString(prefixProperty, context) : { value: DEFAULT_PREFIX };
			const suffix = suffixProperty ? resolvePropertyString(suffixProperty, context) : { value: DEFAULT_SUFFIX };
			if (prefix.diagnostic) diagnostics.push(prefix.diagnostic);
			if (suffix.diagnostic) diagnostics.push(suffix.diagnostic);
			if (!diagnostics.length) resources = [templateResource(`${prefix.value}{locale}${suffix.value}`)];
		}
	}
	if (diagnostics.length || resources.length === 0) return { diagnostics };
	return {
		diagnostics,
		candidate: {
			framework: 'ngx-translate', loader: 'http', api: 'provideTranslateHttpLoader', confidence: 'deterministic',
			resources, locales: [], location: locationOf(call, context)
		}
	};
}

function resolvePropertyString(property: ts.ObjectLiteralElementLike, context: IAnalysisContext): { value?: string; diagnostic?: ILoaderDetectionDiagnostic } {
	const resolved = propertyExpression(property, context);
	if (resolved.ambiguousNode) return { diagnostic: ambiguousDiagnostic(resolved.ambiguousNode, context) };
	return resolveString(resolved.expression as ts.Expression, context);
}

function parseLegacyNew(expression: ts.NewExpression, context: IAnalysisContext): { candidate?: ITranslationLoaderCandidate; diagnostics: ILoaderDetectionDiagnostic[] } {
	const args = expression.arguments ?? [];
	if (args.length === 0 || args.length > 3) {
		return { diagnostics: [diagnosticForExpression(args[3] ?? expression, context)] };
	}
	const prefix = args[1] ? resolveString(args[1], context) : { value: DEFAULT_PREFIX };
	const suffix = args[2] ? resolveString(args[2], context) : { value: DEFAULT_SUFFIX };
	const diagnostics = [prefix.diagnostic, suffix.diagnostic].filter((value): value is ILoaderDetectionDiagnostic => Boolean(value));
	if (diagnostics.length) return { diagnostics };
	return {
		diagnostics: [],
		candidate: {
			framework: 'ngx-translate', loader: 'http', api: 'TranslateHttpLoader', confidence: 'deterministic',
			resources: [templateResource(`${prefix.value}{locale}${suffix.value}`)], locales: [], location: locationOf(expression, context)
		}
	};
}

function extractLiteralLocales(contexts: IAnalysisContext[], diagnostics: ILoaderDetectionDiagnostic[]): string[] {
	const locales: string[] = [];
	const addLocale = (value: string): void => {
		if (value && !locales.includes(value)) locales.push(value);
	};
	for (const context of contexts) {
		for (const [name, declarations] of context.constantInitializers) {
			const normalizedName = name.replaceAll('_', '').toLowerCase();
			if (!/^(supported|available|app)?(locales|languages|langs)$/.test(normalizedName)) continue;
			const topLevelDeclarations = declarations.filter(({ declaration }) => declarationScope(declaration) === context.sourceFile);
			if (topLevelDeclarations.length !== 1) continue;
			const initializer = topLevelDeclarations[0].initializer;
			const resolved = resolveExpression(initializer, context);
			if (resolved.ambiguousNode) {
				diagnostics.push(ambiguousDiagnostic(resolved.ambiguousNode, context));
				continue;
			}
			const expression = resolved.expression ? unwrapExpression(resolved.expression) : undefined;
			if (!expression || !ts.isArrayLiteralExpression(expression)) {
				diagnostics.push(diagnosticForExpression(expression ?? initializer, context));
				continue;
			}
			const values: string[] = [];
			let supported = true;
			for (const element of expression.elements) {
				if (ts.isSpreadElement(element)) {
					diagnostics.push(diagnosticForExpression(element, context));
					supported = false;
					continue;
				}
				const resolvedLocale = resolveString(element, context);
				if (resolvedLocale.diagnostic) {
					diagnostics.push(resolvedLocale.diagnostic);
					supported = false;
				} else {
					values.push(resolvedLocale.value as string);
				}
			}
			if (supported) values.forEach(addLocale);
		}
		const visitProviderLocales = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === TRANSLATE_CORE_MODULE && symbol.importedName === 'provideTranslateService' && node.arguments[0]) {
					const config = resolveExpression(node.arguments[0], context);
					if (config.ambiguousNode) {
						diagnostics.push(ambiguousDiagnostic(config.ambiguousNode, context));
					} else if (config.expression && ts.isObjectLiteralExpression(config.expression)) {
						for (const propertyName of ['lang', 'fallbackLang']) {
							const property = findProperty(config.expression, propertyName);
							if (!property) continue;
							const locale = resolvePropertyString(property, context);
							if (locale.diagnostic) diagnostics.push(locale.diagnostic);
							if (locale.value) addLocale(locale.value);
						}
					}
				}
			}
			ts.forEachChild(node, visitProviderLocales);
		};
		visitProviderLocales(context.sourceFile);
	}
	return locales;
}

function containsImportedLegacyNew(node: ts.Node, context: IAnalysisContext): boolean {
	let found = false;
	const visit = (child: ts.Node): void => {
		if (ts.isNewExpression(child)) {
			const symbol = resolveImportedSymbol(child.expression, context);
			if (symbol?.moduleName === HTTP_LOADER_MODULE && symbol.importedName === 'TranslateHttpLoader') found = true;
		}
		if (!found) ts.forEachChild(child, visit);
	};
	visit(node);
	return found;
}

function conditionalAncestor(node: ts.Node): ts.ConditionalExpression | undefined {
	let current = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isConditionalExpression(current)) return current;
		current = current.parent;
	}
	return undefined;
}

function resolveFactoryDeclarations(identifier: ts.Identifier, context: IAnalysisContext): ts.Node[] {
	const declarations = context.functionDeclarations.get(identifier.text) ?? [];
	const visible = declarations.filter((declaration) => isInside(identifier, declarationScope(declaration)));
	if (visible.length < 2) return visible;
	const smallestScopeSize = Math.min(...visible.map((declaration) => declarationScope(declaration).getWidth()));
	return visible.filter((declaration) => declarationScope(declaration).getWidth() === smallestScopeSize);
}

function diagnoseArbitraryFactories(context: IAnalysisContext, diagnostics: ILoaderDetectionDiagnostic[]): void {
	const visit = (node: ts.Node): void => {
		if (ts.isObjectLiteralExpression(node)) {
			const provide = findProperty(node, 'provide');
			const useFactory = findProperty(node, 'useFactory');
			if (provide && useFactory) {
				const provided = propertyExpression(provide, context).expression;
				const symbol = provided ? resolveImportedSymbol(provided, context) : undefined;
				if (symbol?.moduleName === TRANSLATE_CORE_MODULE && symbol.importedName === 'TranslateLoader') {
					const factoryExpression = propertyExpression(useFactory, context).expression;
					let factories: ts.Node[] = factoryExpression ? [factoryExpression] : [];
					if (factoryExpression && ts.isIdentifier(factoryExpression)) factories = resolveFactoryDeclarations(factoryExpression, context);
					if (!factories.some((factory) => containsImportedLegacyNew(factory, context))) {
						diagnostics.push({
							code: 'ngx-http-unsupported-factory', category: 'unsupported',
							message: 'Custom ngx-translate loader factories are not executed; configure the endpoint explicitly.',
							location: locationOf(factoryExpression ?? useFactory, context)
						});
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(context.sourceFile);
}

export function analyzeNgxTranslateHttpLoaders(files: readonly ILoaderAnalysisSourceFile[]): ITranslationLoaderAnalysisResult {
	const contexts = files.map(collectContext);
	const candidates: ITranslationLoaderCandidate[] = [];
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	const locales = extractLiteralLocales(contexts, diagnostics);

	for (const context of contexts) {
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === HTTP_LOADER_MODULE && symbol.importedName === 'provideTranslateHttpLoader') {
					const conditional = conditionalAncestor(node);
					const parsed = conditional
						? { diagnostics: [diagnosticForExpression(conditional, context)] }
						: parseModernCall(node, context);
					if (parsed.candidate) candidates.push({ ...parsed.candidate, locales: [...locales] });
					diagnostics.push(...parsed.diagnostics);
				}
			}
			if (ts.isNewExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === HTTP_LOADER_MODULE && symbol.importedName === 'TranslateHttpLoader') {
					const conditional = conditionalAncestor(node);
					const parsed = conditional
						? { diagnostics: [diagnosticForExpression(conditional, context)] }
						: parseLegacyNew(node, context);
					if (parsed.candidate) candidates.push({ ...parsed.candidate, locales: [...locales] });
					diagnostics.push(...parsed.diagnostics);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(context.sourceFile);
		diagnoseArbitraryFactories(context, diagnostics);
	}

	const seenDiagnostics = new Set<string>();
	const uniqueDiagnostics = diagnostics.filter((diagnostic) => {
		const key = `${diagnostic.code}:${diagnostic.location.filePath}:${diagnostic.location.line}:${diagnostic.location.column}:${diagnostic.location.endLine}:${diagnostic.location.endColumn}`;
		if (seenDiagnostics.has(key)) return false;
		seenDiagnostics.add(key);
		return true;
	});
	return { candidates, diagnostics: uniqueDiagnostics };
}
