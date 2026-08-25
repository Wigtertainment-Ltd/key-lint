import ts from 'typescript';

import {
	ILoaderAnalysisSourceFile,
	ILoaderDetectionDiagnostic,
	ILoaderResourceTemplate,
	ITranslationLoaderAnalysisResult,
	ITranslationLoaderCandidate
} from './loader-detection.interfaces.js';
import { IAnalysisContext, IStaticExpressionFailure } from './shared/typescript-analysis.interfaces.js';
import {
	classifyStaticExpression,
	collectAnalysisContext,
	collectNamedLiteralStringArrays,
	conditionalAncestor,
	findProperty,
	locationOf,
	propertyExpression,
	resolveClassDeclaration,
	resolveExpression,
	resolveImportedSymbol,
	resolveStaticString,
	templateResource,
	uniqueDiagnostics,
	unsafeObjectElement,
	unwrapExpression
} from './shared/typescript-analysis.util.js';

const TRANSLOCO_MODULES = new Set(['@jsverse/transloco', '@ngneat/transloco']);
const ANGULAR_HTTP_MODULE = '@angular/common/http';

interface IRegisteredLoader {
	expression: ts.Expression;
	context: IAnalysisContext;
}

interface IUrlResolution {
	value?: string;
	failure?: IStaticExpressionFailure;
}

function isTranslocoSymbol(expression: ts.Expression, context: IAnalysisContext, importedName: string): boolean {
	const symbol = resolveImportedSymbol(expression, context);
	return Boolean(symbol && TRANSLOCO_MODULES.has(symbol.moduleName) && symbol.importedName === importedName);
}

function diagnosticForFailure(failure: IStaticExpressionFailure, context: IAnalysisContext): ILoaderDetectionDiagnostic {
	const details = {
		environment: ['transloco-http-dynamic-environment', 'dynamic', 'Transloco loader URLs that depend on runtime environment values require explicit configuration.'],
		conditional: ['transloco-http-conditional-url', 'dynamic', 'Conditional Transloco loader URL construction cannot be resolved deterministically.'],
		merge: ['transloco-http-ambiguous-merge', 'ambiguous', 'The order or merge behavior of multiple Transloco HTTP requests is not explicit.'],
		transformation: ['transloco-http-unsupported-transformation', 'unsupported', 'Transformed Transloco loader URL values are not executed or guessed.'],
		unsupported: ['transloco-http-unsupported-expression', 'unsupported', 'Transloco loader URLs must be statically resolvable strings or templates using the locale parameter.'],
		ambiguous: ['transloco-http-ambiguous-reference', 'ambiguous', 'This Transloco loader reference has multiple possible static declarations and was not guessed.']
	} as const;
	const [code, category, message] = details[failure.kind];
	return { code, category, message, location: locationOf(failure.node, context) };
}

function customDiagnostic(
	code: 'transloco-http-unsupported-provider' | 'transloco-http-unsupported-scope' | 'transloco-http-interceptor',
	message: string,
	node: ts.Node,
	context: IAnalysisContext
): ILoaderDetectionDiagnostic {
	return { code, category: 'unsupported', message, location: locationOf(node, context) };
}

function resolveObject(expression: ts.Expression, context: IAnalysisContext): { object?: ts.ObjectLiteralExpression; failure?: IStaticExpressionFailure } {
	const resolved = resolveExpression(expression, context);
	if (resolved.ambiguousNode) return { failure: { kind: 'ambiguous', node: resolved.ambiguousNode } };
	if (resolved.expression && ts.isObjectLiteralExpression(resolved.expression)) return { object: resolved.expression };
	return { failure: classifyStaticExpression(resolved.expression ?? expression, context) };
}

function enclosingCondition(node: ts.Node): ts.Node | undefined {
	const conditional = conditionalAncestor(node);
	if (conditional) return conditional;
	let current = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isIfStatement(current) || ts.isSwitchStatement(current)) return current;
		current = current.parent;
	}
	return undefined;
}

function localeValues(expression: ts.Expression, context: IAnalysisContext): { values: string[]; failures: IStaticExpressionFailure[] } {
	const resolved = resolveExpression(expression, context);
	if (resolved.ambiguousNode) return { values: [], failures: [{ kind: 'ambiguous', node: resolved.ambiguousNode }] };
	const value = resolved.expression as ts.Expression;
	if (!ts.isArrayLiteralExpression(value)) return { values: [], failures: [classifyStaticExpression(value, context)] };
	const values: string[] = [];
	const failures: IStaticExpressionFailure[] = [];
	for (const element of value.elements) {
		if (ts.isSpreadElement(element)) {
			failures.push(classifyStaticExpression(element, context));
			continue;
		}
		const entry = resolveExpression(element, context);
		if (entry.ambiguousNode) {
			failures.push({ kind: 'ambiguous', node: entry.ambiguousNode });
			continue;
		}
		const item = entry.expression as ts.Expression;
		if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) {
			values.push(item.text);
			continue;
		}
		if (ts.isObjectLiteralExpression(item)) {
			const id = findProperty(item, 'id');
			if (id) {
				const idExpression = propertyExpression(id, context);
				if (idExpression.ambiguousNode) failures.push({ kind: 'ambiguous', node: idExpression.ambiguousNode });
				else {
					const idValue = resolveStaticString(idExpression.expression as ts.Expression, context);
					if (idValue.value) values.push(idValue.value);
					else if (idValue.failure) failures.push(idValue.failure);
				}
				continue;
			}
		}
		failures.push(classifyStaticExpression(item, context));
	}
	return { values, failures };
}

function readConfigLocales(object: ts.ObjectLiteralExpression, context: IAnalysisContext, locales: string[], diagnostics: ILoaderDetectionDiagnostic[]): void {
	const property = findProperty(object, 'availableLangs');
	if (!property) return;
	const expression = propertyExpression(property, context);
	if (expression.ambiguousNode) {
		diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: expression.ambiguousNode }, context));
		return;
	}
	const parsed = localeValues(expression.expression as ts.Expression, context);
	for (const value of parsed.values) if (!locales.includes(value)) locales.push(value);
	for (const failure of parsed.failures) diagnostics.push(diagnosticForFailure(failure, context));
}

function collectRegistrations(
	contexts: IAnalysisContext[],
	locales: string[],
	diagnostics: ILoaderDetectionDiagnostic[]
): IRegisteredLoader[] {
	const registrations: IRegisteredLoader[] = [];
	for (const context of contexts) {
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && isTranslocoSymbol(node.expression, context, 'provideTransloco') && node.arguments[0]) {
				const condition = enclosingCondition(node);
				if (condition) {
					diagnostics.push(diagnosticForFailure({ kind: 'conditional', node: condition }, context));
					ts.forEachChild(node, visit);
					return;
				}
				const config = resolveObject(node.arguments[0], context);
				if (config.failure) diagnostics.push(diagnosticForFailure(config.failure, context));
				else if (config.object) {
					const unsafe = unsafeObjectElement(config.object);
					if (unsafe) diagnostics.push(diagnosticForFailure(classifyStaticExpression(unsafe, context), context));
					else {
						readConfigLocales(config.object, context, locales, diagnostics);
						const loader = findProperty(config.object, 'loader');
						if (loader) {
							const value = propertyExpression(loader, context);
							if (value.ambiguousNode) diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: value.ambiguousNode }, context));
							else if (value.expression) registrations.push({ expression: value.expression, context });
						}
					}
				}
			}
			if (ts.isCallExpression(node) && isTranslocoSymbol(node.expression, context, 'translocoConfig') && node.arguments[0]) {
				const config = resolveObject(node.arguments[0], context);
				if (config.object) readConfigLocales(config.object, context, locales, diagnostics);
			}
			if (ts.isObjectLiteralExpression(node)) {
				const provide = findProperty(node, 'provide');
				if (provide) {
					const provided = propertyExpression(provide, context);
					if (provided.expression && isTranslocoSymbol(provided.expression, context, 'TRANSLOCO_LOADER')) {
						const condition = enclosingCondition(node);
						if (condition) {
							diagnostics.push(diagnosticForFailure({ kind: 'conditional', node: condition }, context));
							ts.forEachChild(node, visit);
							return;
						}
						const useClass = findProperty(node, 'useClass');
						if (!useClass) {
							diagnostics.push(customDiagnostic('transloco-http-unsupported-provider', 'Only statically registered Transloco loader classes are analyzed.', node, context));
						} else {
							const value = propertyExpression(useClass, context);
							if (value.ambiguousNode) diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: value.ambiguousNode }, context));
							else if (value.expression) registrations.push({ expression: value.expression, context });
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(context.sourceFile);
	}
	return registrations;
}

function memberName(member: ts.ClassElement): string | undefined {
	const name = member.name;
	return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

function isHttpClientType(type: ts.TypeNode | undefined, context: IAnalysisContext): boolean {
	return Boolean(type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) &&
		resolveImportedSymbol(type.typeName, context)?.moduleName === ANGULAR_HTTP_MODULE &&
		resolveImportedSymbol(type.typeName, context)?.importedName === 'HttpClient');
}

function httpClientMembers(declaration: ts.ClassDeclaration, context: IAnalysisContext): Set<string> {
	const names = new Set<string>();
	for (const member of declaration.members) {
		if (ts.isConstructorDeclaration(member)) {
			for (const parameter of member.parameters) {
				if (ts.isIdentifier(parameter.name) && parameter.modifiers?.some((modifier) =>
					modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.PublicKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
				) && isHttpClientType(parameter.type, context)) names.add(parameter.name.text);
			}
		}
		if (ts.isPropertyDeclaration(member) && member.initializer && memberName(member)) {
			const initializer = unwrapExpression(member.initializer);
			if (ts.isCallExpression(initializer) && initializer.arguments[0]) {
				const inject = resolveImportedSymbol(initializer.expression, context);
				const httpClient = resolveImportedSymbol(initializer.arguments[0], context);
				if (inject?.moduleName === '@angular/core' && inject.importedName === 'inject' &&
					httpClient?.moduleName === ANGULAR_HTTP_MODULE && httpClient.importedName === 'HttpClient') names.add(memberName(member) as string);
			}
		}
	}
	return names;
}

function isHttpGet(call: ts.CallExpression, httpMembers: Set<string>): boolean {
	const called = unwrapExpression(call.expression);
	return ts.isPropertyAccessExpression(called) && called.name.text === 'get' &&
		ts.isPropertyAccessExpression(called.expression) && called.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
		httpMembers.has(called.expression.name.text);
}

function resolveUrl(expression: ts.Expression, localeName: string, context: IAnalysisContext, seen = new Set<string>()): IUrlResolution {
	const value = unwrapExpression(expression);
	if (ts.isIdentifier(value)) {
		if (value.text === localeName) return { value: '{locale}' };
		if (seen.has(value.text)) return { failure: { kind: 'ambiguous', node: value } };
		const resolved = resolveExpression(value, context);
		if (resolved.ambiguousNode) return { failure: { kind: 'ambiguous', node: resolved.ambiguousNode } };
		if (resolved.expression === value) return { failure: classifyStaticExpression(value, context) };
		seen.add(value.text);
		return resolveUrl(resolved.expression as ts.Expression, localeName, context, seen);
	}
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return { value: value.text };
	if (ts.isTemplateExpression(value)) {
		let result = value.head.text;
		for (const span of value.templateSpans) {
			const part = resolveUrl(span.expression, localeName, context, seen);
			if (part.failure) return part;
			result += `${part.value}${span.literal.text}`;
		}
		return { value: result };
	}
	if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left = resolveUrl(value.left, localeName, context, new Set(seen));
		if (left.failure) return left;
		const right = resolveUrl(value.right, localeName, context, new Set(seen));
		if (right.failure) return right;
		return { value: `${left.value}${right.value}` };
	}
	return { failure: classifyStaticExpression(value, context) };
}

function returnedExpression(method: ts.MethodDeclaration): ts.Expression | undefined {
	if (!method.body) return undefined;
	const returns = method.body.statements.filter(ts.isReturnStatement);
	return returns.length === 1 ? returns[0].expression : undefined;
}

function httpCalls(node: ts.Node, members: Set<string>): ts.CallExpression[] {
	const calls: ts.CallExpression[] = [];
	const visit = (child: ts.Node): void => {
		if (ts.isCallExpression(child) && isHttpGet(child, members)) calls.push(child);
		ts.forEachChild(child, visit);
	};
	visit(node);
	return calls;
}

function explicitMultiRequestOrder(expression: ts.Expression, calls: ts.CallExpression[], context: IAnalysisContext): ts.CallExpression[] | undefined {
	const outer = unwrapExpression(expression);
	if (!ts.isCallExpression(outer) || !ts.isPropertyAccessExpression(outer.expression) || outer.expression.name.text !== 'pipe' || outer.arguments.length !== 1) return undefined;
	const forkJoin = unwrapExpression(outer.expression.expression);
	if (!ts.isCallExpression(forkJoin) || !isRxjsSymbol(forkJoin.expression, context, 'forkJoin') || forkJoin.arguments.length !== 1) return undefined;
	const array = unwrapExpression(forkJoin.arguments[0]);
	if (!ts.isArrayLiteralExpression(array) || array.elements.some(ts.isSpreadElement)) return undefined;
	const orderedCalls = array.elements.map((element) => unwrapExpression(element)).filter(ts.isCallExpression);
	if (orderedCalls.length !== calls.length || orderedCalls.some((call) => !calls.includes(call))) return undefined;
	const mapCall = unwrapExpression(outer.arguments[0]);
	if (!ts.isCallExpression(mapCall) || !isRxjsSymbol(mapCall.expression, context, 'map') || mapCall.arguments.length !== 1) return undefined;
	const mapper = unwrapExpression(mapCall.arguments[0]);
	if ((!ts.isArrowFunction(mapper) && !ts.isFunctionExpression(mapper)) || mapper.parameters.length !== 1 || !ts.isArrayBindingPattern(mapper.parameters[0].name)) return undefined;
	const bindings = mapper.parameters[0].name.elements;
	if (bindings.length !== orderedCalls.length || bindings.some(ts.isOmittedExpression)) return undefined;
	const body = unwrapExpression(mapper.body as ts.Expression);
	if (!ts.isObjectLiteralExpression(body) || body.properties.length !== bindings.length || body.properties.some((property) => !ts.isSpreadAssignment(property))) return undefined;
	const bindingNames = bindings.map((binding) => !ts.isOmittedExpression(binding) && ts.isIdentifier(binding.name) ? binding.name.text : undefined);
	const spreadNames = body.properties.map((property) => ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) ? property.expression.text : undefined);
	if (bindingNames.some((name, index) => name !== spreadNames[index])) return undefined;
	return orderedCalls;
}

function isRxjsSymbol(expression: ts.Expression, context: IAnalysisContext, importedName: string): boolean {
	const symbol = resolveImportedSymbol(expression, context);
	return Boolean(symbol && (symbol.moduleName === 'rxjs' || symbol.moduleName === 'rxjs/operators') && symbol.importedName === importedName);
}

function analyzeLoaderClass(
	declaration: ts.ClassDeclaration,
	context: IAnalysisContext,
	locales: string[]
): { candidate?: ITranslationLoaderCandidate; diagnostics: ILoaderDetectionDiagnostic[] } {
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	const methods = declaration.members.filter((member): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && memberName(member) === 'getTranslation');
	if (methods.length !== 1 || methods[0].parameters.length !== 1 || !ts.isIdentifier(methods[0].parameters[0].name)) {
		return { diagnostics: [customDiagnostic('transloco-http-unsupported-provider', 'The registered Transloco loader must expose one statically analyzable getTranslation(locale) method.', declaration, context)] };
	}
	const method = methods[0];
	const conditional = method.body?.statements.find((statement) => ts.isIfStatement(statement) || ts.isSwitchStatement(statement));
	if (conditional) return { diagnostics: [diagnosticForFailure({ kind: 'conditional', node: conditional }, context)] };
	const returned = returnedExpression(method);
	const members = httpClientMembers(declaration, context);
	if (!returned || members.size === 0) {
		return { diagnostics: [customDiagnostic('transloco-http-unsupported-provider', 'The registered Transloco loader must directly use Angular HttpClient in getTranslation(locale).', method, context)] };
	}
	const calls = httpCalls(method.body as ts.Block, members);
	if (calls.length === 0) return { diagnostics: [customDiagnostic('transloco-http-unsupported-provider', 'No direct Angular HttpClient.get() call was found in the registered Transloco loader.', returned, context)] };
	let orderedCalls: ts.CallExpression[];
	if (calls.length === 1 && unwrapExpression(returned) === calls[0]) orderedCalls = calls;
	else {
		const explicit = explicitMultiRequestOrder(returned, calls, context);
		if (!explicit) return { diagnostics: [diagnosticForFailure({ kind: 'merge', node: returned }, context)] };
		orderedCalls = explicit;
	}
	const resources: ILoaderResourceTemplate[] = [];
	for (const call of orderedCalls) {
		if (call.arguments.length === 0) {
			diagnostics.push(diagnosticForFailure({ kind: 'unsupported', node: call }, context));
			continue;
		}
		const url = resolveUrl(call.arguments[0], methods[0].parameters[0].name.text, context);
		if (url.failure) diagnostics.push(diagnosticForFailure(url.failure, context));
		else if (url.value && url.value.includes('{locale}')) resources.push(templateResource(url.value));
		else diagnostics.push(diagnosticForFailure({ kind: 'unsupported', node: call.arguments[0] }, context));
	}
	if (diagnostics.length || resources.length !== orderedCalls.length) return { diagnostics };
	return {
		diagnostics,
		candidate: {
			framework: 'transloco', loader: 'http', api: 'TranslocoLoader', confidence: 'deterministic',
			resources, locales: [...locales], location: locationOf(method, context)
		}
	};
}

function findGuards(contexts: IAnalysisContext[], diagnostics: ILoaderDetectionDiagnostic[]): boolean {
	let hasInterceptor = false;
	for (const context of contexts) {
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && isTranslocoSymbol(node.expression, context, 'provideTranslocoScope')) {
				diagnostics.push(customDiagnostic('transloco-http-unsupported-scope', 'Scoped Transloco loaders compose paths at runtime and require explicit configuration.', node, context));
			}
			if (ts.isObjectLiteralExpression(node)) {
				const provide = findProperty(node, 'provide');
				const expression = provide ? propertyExpression(provide, context).expression : undefined;
				if (expression && isTranslocoSymbol(expression, context, 'TRANSLOCO_SCOPE')) {
					diagnostics.push(customDiagnostic('transloco-http-unsupported-scope', 'Scoped Transloco loaders compose paths at runtime and require explicit configuration.', node, context));
				}
				if (expression) {
					const symbol = resolveImportedSymbol(expression, context);
					if (symbol?.moduleName === ANGULAR_HTTP_MODULE && symbol.importedName === 'HTTP_INTERCEPTORS') {
						hasInterceptor = true;
						diagnostics.push(customDiagnostic('transloco-http-interceptor', 'Angular HTTP interceptors may alter Transloco request URLs; automatic detection is disabled.', node, context));
					}
				}
			}
			if (ts.isCallExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === ANGULAR_HTTP_MODULE && symbol.importedName === 'withInterceptors') {
					hasInterceptor = true;
					diagnostics.push(customDiagnostic('transloco-http-interceptor', 'Angular HTTP interceptors may alter Transloco request URLs; automatic detection is disabled.', node, context));
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(context.sourceFile);
	}
	return hasInterceptor;
}

export function analyzeTranslocoHttpLoaders(files: readonly ILoaderAnalysisSourceFile[]): ITranslationLoaderAnalysisResult {
	const contexts = files.map(collectAnalysisContext);
	const candidates: ITranslationLoaderCandidate[] = [];
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	const locales = collectNamedLiteralStringArrays(contexts, /^(supported|available|app)?(locales|languages|langs)$/);
	const localeValues = [...locales.values];
	for (const failure of locales.failures) diagnostics.push(diagnosticForFailure(failure.failure, failure.context));
	const registrations = collectRegistrations(contexts, localeValues, diagnostics);
	const hasInterceptor = findGuards(contexts, diagnostics);
	if (!hasInterceptor) {
		for (const registration of registrations) {
			const resolved = resolveClassDeclaration(registration.expression, registration.context, contexts);
			if (resolved.ambiguousNode) diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: resolved.ambiguousNode }, registration.context));
			else if (!resolved.declaration || !resolved.context) {
				diagnostics.push(customDiagnostic('transloco-http-unsupported-provider', 'The registered Transloco loader class could not be resolved from the supplied project files.', registration.expression, registration.context));
			} else {
				const result = analyzeLoaderClass(resolved.declaration, resolved.context, localeValues);
				if (result.candidate) candidates.push(result.candidate);
				diagnostics.push(...result.diagnostics);
			}
		}
	}
	return { candidates, diagnostics: uniqueDiagnostics(diagnostics) };
}
