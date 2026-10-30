import ts from 'typescript';

import {
	ILoaderAnalysisSourceFile, ILoaderDetectionDiagnostic, ILoaderResourceTemplate, ITranslationLoaderAnalysisResult, ITranslationLoaderCandidate
} from './loader-detection.interfaces.js';
import { IAnalysisContext, IStaticExpressionFailure, IImportedSymbol, IResolvedExpression } from './shared/typescript-analysis.interfaces.js';
import {
	classifyStaticExpression, collectAnalysisContext, collectNamedLiteralStringArrays, conditionalAncestor, findProperty, locationOf, propertyExpression, resolveClassDeclaration,
	resolveExpression, resolveImportedSymbol, resolveStaticString, templateResource, uniqueDiagnostics, unsafeObjectElement, unwrapExpression
} from './shared/typescript-analysis.util.js';

const TRANSLOCO_MODULES: Set<string> = new Set<string>(['@jsverse/transloco', '@ngneat/transloco']);
const ANGULAR_HTTP_MODULE: string = '@angular/common/http';

interface IRegisteredLoader {
	expression: ts.Expression;
	context: IAnalysisContext;
}

interface IUrlResolution {
	value?: string;
	failure?: IStaticExpressionFailure;
}

/**
 * Matches a resolved symbol from either supported Transloco package.
 * @param expression - Imported or const-aliased symbol reference.
 * @param context - Source-local import and declaration indexes.
 * @param importedName - Exact exported symbol name required by the caller.
 * @returns Whether the module and imported name match a supported Transloco symbol.
 */
function isTranslocoSymbol(expression: ts.Expression, context: IAnalysisContext, importedName: string): boolean {
	const symbol: IImportedSymbol | undefined = resolveImportedSymbol(expression, context);
	return Boolean(symbol && TRANSLOCO_MODULES.has(symbol.moduleName) && symbol.importedName === importedName);
}

/**
 * Maps a resolution failure to Transloco-specific diagnostic text and source coordinates.
 * @param failure - Classified unsupported or ambiguous syntax.
 * @param context - Source context owning the diagnostic node.
 * @returns A framework-specific analysis diagnostic.
 */
function diagnosticForFailure(failure: IStaticExpressionFailure, context: IAnalysisContext): ILoaderDetectionDiagnostic {
	const details: Record<IStaticExpressionFailure['kind'], readonly [ILoaderDetectionDiagnostic['code'], ILoaderDetectionDiagnostic['category'], string]> = {
		environment: ['transloco-http-dynamic-environment', 'dynamic', 'Transloco loader URLs that depend on runtime environment values require explicit configuration.'],
		conditional: ['transloco-http-conditional-url', 'dynamic', 'Conditional Transloco loader URL construction cannot be resolved deterministically.'],
		merge: ['transloco-http-ambiguous-merge', 'ambiguous', 'The order or merge behavior of multiple Transloco HTTP requests is not explicit.'],
		transformation: ['transloco-http-unsupported-transformation', 'unsupported', 'Transformed Transloco loader URL values are not executed or guessed.'],
		unsupported: ['transloco-http-unsupported-expression', 'unsupported', 'Transloco loader URLs must be statically resolvable strings or templates using the locale parameter.'],
		ambiguous: ['transloco-http-ambiguous-reference', 'ambiguous', 'This Transloco loader reference has multiple possible static declarations and was not guessed.']
	} as const;
	const [code, category, message]: readonly [ILoaderDetectionDiagnostic['code'], ILoaderDetectionDiagnostic['category'], string] = details[failure.kind];
	return { code, category, message, location: locationOf(failure.node, context) };
}

/**
 * Creates a diagnostic for unsupported registration, scope, or interceptor behavior.
 * @param code - Transloco guard or provider failure category.
 * @param message - Human-readable explanation supplied by the caller.
 * @param node - Source node identifying the unsupported construct.
 * @param context - Context used to obtain source coordinates.
 * @returns An unsupported-category diagnostic with a complete source range.
 */
function customDiagnostic(
	code: 'transloco-http-unsupported-provider' | 'transloco-http-unsupported-scope' | 'transloco-http-interceptor',
	message: string,
	node: ts.Node,
	context: IAnalysisContext
): ILoaderDetectionDiagnostic {
	return { code, category: 'unsupported', message, location: locationOf(node, context) };
}

/**
 * Follows local const aliases and requires the resolved expression to be an object literal.
 * @param expression - Provider or configuration expression to resolve.
 * @param context - Source-local declaration and scope information.
 * @returns The object literal or a classified ambiguity/unsupported failure.
 */
function resolveObject(expression: ts.Expression, context: IAnalysisContext): { object?: ts.ObjectLiteralExpression; failure?: IStaticExpressionFailure } {
	const resolved: IResolvedExpression = resolveExpression(expression, context);
	if (resolved.ambiguousNode) {
		return { failure: { kind: 'ambiguous', node: resolved.ambiguousNode } };
	}
	if (resolved.expression && ts.isObjectLiteralExpression(resolved.expression)) {
		return { object: resolved.expression };
	}
	return { failure: classifyStaticExpression(resolved.expression ?? expression, context) };
}

/**
 * Locates an enclosing ternary, if, or switch construct without evaluating its condition.
 * Ternary ancestors take precedence over if/switch ancestors.
 * @param node - Registration site whose ancestors are inspected.
 * @returns The enclosing conditional construct, or `undefined` when none is found.
 */
function enclosingCondition(node: ts.Node): ts.Node | undefined {
	const conditional: ts.ConditionalExpression | undefined = conditionalAncestor(node);
	if (conditional) {
		return conditional;
	}
	let current: ts.Node = node.parent;
	while (current && !ts.isSourceFile(current)) {
		if (ts.isIfStatement(current) || ts.isSwitchStatement(current)) {
			return current;
		}
		current = current.parent;
	}
	return undefined;
}

/**
 * Extracts literal strings or object-entry IDs from a statically resolved locale array.
 * Supported entries remain available even when other entries produce failures.
 * @param expression - availableLangs-style configuration expression.
 * @param context - Source-local declaration information.
 * @returns Extracted locale strings in entry order and failures for unsupported entries.
 */
function localeValues(expression: ts.Expression, context: IAnalysisContext): { values: string[]; failures: IStaticExpressionFailure[] } {
	const resolved: IResolvedExpression = resolveExpression(expression, context);
	if (resolved.ambiguousNode) {
		return { values: [], failures: [{ kind: 'ambiguous', node: resolved.ambiguousNode }] };
	}
	const value: ts.Expression = resolved.expression!;
	if (!ts.isArrayLiteralExpression(value)) {
		return { values: [], failures: [classifyStaticExpression(value, context)] };
	}
	const values: string[] = [];
	const failures: IStaticExpressionFailure[] = [];
	for (const element of value.elements) {
		if (ts.isSpreadElement(element)) {
			failures.push(classifyStaticExpression(element, context));
			continue;
		}
		const entry: IResolvedExpression = resolveExpression(element, context);
		if (entry.ambiguousNode) {
			failures.push({ kind: 'ambiguous', node: entry.ambiguousNode });
			continue;
		}
		const item: ts.Expression = entry.expression!;
		if (ts.isStringLiteral(item) || ts.isNoSubstitutionTemplateLiteral(item)) {
			values.push(item.text);
			continue;
		}
		if (ts.isObjectLiteralExpression(item)) {
			const id: ts.ObjectLiteralElementLike | undefined = findProperty(item, 'id');
			if (id) {
				const idExpression: IResolvedExpression = propertyExpression(id, context);
				if (idExpression.ambiguousNode) {
					failures.push({ kind: 'ambiguous', node: idExpression.ambiguousNode });
				} else {
					const idValue: { value?: string; failure?: IStaticExpressionFailure } = resolveStaticString(idExpression.expression!, context);
					if (idValue.value) {
						values.push(idValue.value);
					} else if (idValue.failure) {
						failures.push(idValue.failure);
					}
				}
				continue;
			}
		}
		failures.push(classifyStaticExpression(item, context));
	}
	return { values, failures };
}

/**
 * Reads availableLangs and appends first-seen locale values or diagnostic failures.
 * @param object - Resolved Transloco configuration object.
 * @param context - Source context used to resolve its locale expression.
 * @param locales - Locale list updated in place with previously unseen values.
 * @param diagnostics - Diagnostic collector updated for unresolved entries.
 */
function readConfigLocales(object: ts.ObjectLiteralExpression, context: IAnalysisContext, locales: string[], diagnostics: ILoaderDetectionDiagnostic[]): void {
	const property: ts.ObjectLiteralElementLike | undefined = findProperty(object, 'availableLangs');
	if (!property) {
		return;
	}
	const expression: IResolvedExpression = propertyExpression(property, context);
	if (expression.ambiguousNode) {
		diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: expression.ambiguousNode }, context));
		return;
	}
	const parsed: { values: string[]; failures: IStaticExpressionFailure[]; } = localeValues(expression.expression!, context);
	for (const value of parsed.values) {
		if (!locales.includes(value)) {
			locales.push(value);
		}
	}
	for (const failure of parsed.failures) {
		diagnostics.push(diagnosticForFailure(failure, context));
	}
}

/**
 * Finds loader references from provideTransloco and TRANSLOCO_LOADER useClass providers.
 * Reads availableLangs from configuration calls and diagnoses conditional or unsupported registration forms.
 * @param contexts - Source files inspected in input order.
 * @param locales - Mutable collector of discovered configuration locales.
 * @param diagnostics - Mutable collector of registration and locale failures.
 * @returns Registered loader expressions paired with their owning source contexts.
 */
function collectRegistrations(contexts: IAnalysisContext[], locales: string[], diagnostics: ILoaderDetectionDiagnostic[]): IRegisteredLoader[] {
	const registrations: IRegisteredLoader[] = [];
	for (const context of contexts) {
		/**
		 * Walks configuration calls and provider objects to collect loader registrations and locales.
		 * @param node - Current syntax node and descendants to inspect.
		 */
		const visit: (node: ts.Node) => void = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && isTranslocoSymbol(node.expression, context, 'provideTransloco') && node.arguments[0]) {
				const condition: ts.Node | undefined = enclosingCondition(node);
				if (condition) {
					diagnostics.push(diagnosticForFailure({ kind: 'conditional', node: condition }, context));
					ts.forEachChild(node, visit);
					return;
				}
				const config: { object?: ts.ObjectLiteralExpression; failure?: IStaticExpressionFailure; } = resolveObject(node.arguments[0], context);
				if (config.failure) {
					diagnostics.push(diagnosticForFailure(config.failure, context));
				} else if (config.object) {
					const unsafe: ts.ObjectLiteralElementLike | undefined = unsafeObjectElement(config.object);
					if (unsafe) {
						diagnostics.push(diagnosticForFailure(classifyStaticExpression(unsafe, context), context));
					} else {
						readConfigLocales(config.object, context, locales, diagnostics);
						const loader: ts.ObjectLiteralElementLike | undefined = findProperty(config.object, 'loader');
						if (loader) {
							const value: IResolvedExpression = propertyExpression(loader, context);
							if (value.ambiguousNode) {
								diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: value.ambiguousNode }, context));
							} else if (value.expression) {
								registrations.push({ expression: value.expression, context });
							}
						}
					}
				}
			}
			if (ts.isCallExpression(node) && isTranslocoSymbol(node.expression, context, 'translocoConfig') && node.arguments[0]) {
				const config: { object?: ts.ObjectLiteralExpression; failure?: IStaticExpressionFailure; } = resolveObject(node.arguments[0], context);
				if (config.object) {
					readConfigLocales(config.object, context, locales, diagnostics);
				}
			}
			if (ts.isObjectLiteralExpression(node)) {
				const provide: ts.ObjectLiteralElementLike | undefined = findProperty(node, 'provide');
				if (provide) {
					const provided: IResolvedExpression = propertyExpression(provide, context);
					if (provided.expression && isTranslocoSymbol(provided.expression, context, 'TRANSLOCO_LOADER')) {
						const condition: ts.Node | undefined = enclosingCondition(node);
						if (condition) {
							diagnostics.push(diagnosticForFailure({ kind: 'conditional', node: condition }, context));
							ts.forEachChild(node, visit);
							return;
						}
						const useClass: ts.ObjectLiteralElementLike | undefined = findProperty(node, 'useClass');
						if (!useClass) {
							diagnostics.push(customDiagnostic('transloco-http-unsupported-provider', 'Only statically registered Transloco loader classes are analyzed.', node, context));
						} else {
							const value: IResolvedExpression = propertyExpression(useClass, context);
							if (value.ambiguousNode) {
								diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: value.ambiguousNode }, context));
							} else if (value.expression) {
								registrations.push({ expression: value.expression, context });
							}
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

/**
 * Extracts identifier or quoted class-member names without evaluating computed names.
 * @param member - Loader class member to inspect.
 * @returns Supported name text, or `undefined` for an unsupported or unnamed member.
 */
function memberName(member: ts.ClassElement): string | undefined {
	const name: ts.PropertyName | undefined = member.name;
	return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)) ? name.text : undefined;
}

/**
 * Recognizes a direct identifier type reference to Angular's imported HttpClient.
 * @param type - Optional constructor parameter type annotation.
 * @param context - Import metadata for the loader class source.
 * @returns Whether the type resolves to HttpClient from Angular's HTTP package.
 */
function isHttpClientType(type: ts.TypeNode | undefined, context: IAnalysisContext): boolean {
	return Boolean(type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) &&
		resolveImportedSymbol(type.typeName, context)?.moduleName === ANGULAR_HTTP_MODULE &&
		resolveImportedSymbol(type.typeName, context)?.importedName === 'HttpClient');
}

/**
 * Identifies HttpClient constructor parameter properties and fields initialized with Angular inject(HttpClient).
 * Does not infer assignments made in constructor bodies or inherited client members.
 * @param declaration - Registered loader class to inspect.
 * @param context - Import and declaration information owning the class.
 * @returns Supported instance member names whose get calls can be analyzed.
 */
function httpClientMembers(declaration: ts.ClassDeclaration, context: IAnalysisContext): Set<string> {
	const names: Set<string> = new Set<string>();
	for (const member of declaration.members) {
		if (ts.isConstructorDeclaration(member)) {
			for (const parameter of member.parameters) {
				if (
					ts.isIdentifier(parameter.name) &&
					parameter.modifiers?.some(
						(modifier: ts.ModifierLike): boolean =>
							modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.PublicKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword
					) &&
					isHttpClientType(parameter.type, context)
				) {
					names.add(parameter.name.text);
				}
			}
		}
		if (ts.isPropertyDeclaration(member) && member.initializer && memberName(member)) {
			const initializer: ts.Expression = unwrapExpression(member.initializer);
			if (ts.isCallExpression(initializer) && initializer.arguments[0]) {
				const inject: IImportedSymbol | undefined = resolveImportedSymbol(initializer.expression, context);
				const httpClient: IImportedSymbol | undefined = resolveImportedSymbol(initializer.arguments[0], context);
				if (
					inject?.moduleName === '@angular/core' &&
					inject.importedName === 'inject' &&
					httpClient?.moduleName === ANGULAR_HTTP_MODULE &&
					httpClient.importedName === 'HttpClient'
				) {
					names.add(memberName(member)!);
				}
			}
		}
	}
	return names;
}

/**
 * Recognizes a direct this.member.get call on an identified HttpClient member.
 * @param call - Call expression to classify.
 * @param httpMembers - Accepted instance member names.
 * @returns Whether the call has the supported HTTP GET shape.
 */
function isHttpGet(call: ts.CallExpression, httpMembers: Set<string>): boolean {
	const called: ts.Expression = unwrapExpression(call.expression);
	return ts.isPropertyAccessExpression(called) && called.name.text === 'get' &&
		ts.isPropertyAccessExpression(called.expression) && called.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
		httpMembers.has(called.expression.name.text);
}

/**
 * Builds a static URL template from literals, const aliases, templates, and plus expressions.
 * Replaces the locale parameter with `{locale}` and reports unsupported expressions or alias cycles.
 * @param expression - HTTP GET URL expression to inspect without execution.
 * @param localeName - Identifier of the getTranslation locale parameter.
 * @param context - Source-local constant declarations used for resolution.
 * @param seen - Mutable identifier-name set for detecting recursive alias cycles.
 * @returns Resolved template text or a classified static-resolution failure.
 */
function resolveUrl(expression: ts.Expression, localeName: string, context: IAnalysisContext, seen: Set<string> = new Set<string>()): IUrlResolution {
	const value: ts.Expression = unwrapExpression(expression);
	if (ts.isIdentifier(value)) {
		if (value.text === localeName) {
			return { value: '{locale}' };
		}
		if (seen.has(value.text)) {
			return { failure: { kind: 'ambiguous', node: value } };
		}
		const resolved: IResolvedExpression = resolveExpression(value, context);
		if (resolved.ambiguousNode) {
			return { failure: { kind: 'ambiguous', node: resolved.ambiguousNode } };
		}
		if (resolved.expression === value) {
			return { failure: classifyStaticExpression(value, context) };
		}
		seen.add(value.text);
		return resolveUrl(resolved.expression!, localeName, context, seen);
	}
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
		return { value: value.text };
	}
	if (ts.isTemplateExpression(value)) {
		let result: string = value.head.text;
		for (const span of value.templateSpans) {
			const part: IUrlResolution = resolveUrl(span.expression, localeName, context, seen);
			if (part.failure) {
				return part;
			}
			result += `${part.value}${span.literal.text}`;
		}
		return { value: result };
	}
	if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
		const left: IUrlResolution = resolveUrl(value.left, localeName, context, new Set(seen));
		if (left.failure) {
			return left;
		}
		const right: IUrlResolution = resolveUrl(value.right, localeName, context, new Set(seen));
		if (right.failure) {
			return right;
		}
		return { value: `${left.value}${right.value}` };
	}
	return { failure: classifyStaticExpression(value, context) };
}

/**
 * Selects the expression of a method's sole top-level return statement.
 * @param method - Method whose immediate body statements are inspected.
 * @returns Its return expression, or `undefined` for missing bodies or zero/multiple top-level returns.
 */
function returnedExpression(method: ts.MethodDeclaration): ts.Expression | undefined {
	if (!method.body) {
		return undefined;
	}
	const returns: ts.ReturnStatement[] = method.body.statements.filter(ts.isReturnStatement);
	return returns.length === 1 ? returns[0].expression : undefined;
}

/**
 * Collects direct HTTP GET calls throughout a syntax subtree, including nested descendants.
 * @param node - Loader body or subtree to inspect.
 * @param members - Identified HttpClient instance member names.
 * @returns Recognized GET call nodes in traversal order.
 */
function httpCalls(node: ts.Node, members: Set<string>): ts.CallExpression[] {
	const calls: ts.CallExpression[] = [];
	/**
	 * Traverses descendants and appends recognized HTTP GET call nodes.
	 * @param child - Current syntax node being inspected.
	 */
	const visit: (child: ts.Node) => void = (child: ts.Node): void => {
		if (ts.isCallExpression(child) && isHttpGet(child, members)) {
			calls.push(child);
		}
		ts.forEachChild(child, visit);
	};
	visit(node);
	return calls;
}

/**
 * Recognizes the supported forkJoin(array).pipe(map(array-destructuring-to-object-spreads)) merge shape.
 * Requires all discovered GET calls and matching spread order to make resource precedence explicit.
 * @param expression - Returned loader expression containing the merge.
 * @param calls - All recognized HTTP GET call nodes in the method body.
 * @param context - Import metadata used to verify RxJS forkJoin and map.
 * @returns Calls in explicit array order, or `undefined` when the merge shape is unsupported.
 */
function explicitMultiRequestOrder(expression: ts.Expression, calls: ts.CallExpression[], context: IAnalysisContext): ts.CallExpression[] | undefined {
	const outer: ts.Expression = unwrapExpression(expression);
	if (!ts.isCallExpression(outer) || !ts.isPropertyAccessExpression(outer.expression) || outer.expression.name.text !== 'pipe' || outer.arguments.length !== 1) {
		return undefined;
	}
	const forkJoin: ts.Expression = unwrapExpression(outer.expression.expression);
	if (!ts.isCallExpression(forkJoin) || !isRxjsSymbol(forkJoin.expression, context, 'forkJoin') || forkJoin.arguments.length !== 1) {
		return undefined;
	}
	const array: ts.Expression = unwrapExpression(forkJoin.arguments[0]);
	if (!ts.isArrayLiteralExpression(array) || array.elements.some(ts.isSpreadElement)) {
		return undefined;
	}
	const orderedCalls: ts.CallExpression[] = array.elements.map((element: ts.Expression): ts.Expression => unwrapExpression(element)).filter(ts.isCallExpression);
	if (orderedCalls.length !== calls.length || orderedCalls.some((call: ts.CallExpression): boolean => !calls.includes(call))) {
		return undefined;
	}
	const mapCall: ts.Expression = unwrapExpression(outer.arguments[0]);
	if (!ts.isCallExpression(mapCall) || !isRxjsSymbol(mapCall.expression, context, 'map') || mapCall.arguments.length !== 1) {
		return undefined;
	}
	const mapper: ts.Expression = unwrapExpression(mapCall.arguments[0]);
	if ((!ts.isArrowFunction(mapper) && !ts.isFunctionExpression(mapper)) || mapper.parameters.length !== 1 || !ts.isArrayBindingPattern(mapper.parameters[0].name)) {
		return undefined;
	}
	const bindings: ts.NodeArray<ts.ArrayBindingElement> = mapper.parameters[0].name.elements;
	if (bindings.length !== orderedCalls.length || bindings.some(ts.isOmittedExpression)) {
		return undefined;
	}
	const body: ts.Expression = unwrapExpression(mapper.body as ts.Expression);
	if (
		!ts.isObjectLiteralExpression(body) ||
		body.properties.length !== bindings.length ||
		body.properties.some((property: ts.ObjectLiteralElementLike): boolean => !ts.isSpreadAssignment(property))
	) {
		return undefined;
	}
	const bindingNames: (string | undefined)[] = bindings.map(
		(binding: ts.ArrayBindingElement): string | undefined => !ts.isOmittedExpression(binding) && ts.isIdentifier(binding.name) ? binding.name.text : undefined
	);
	const spreadNames: (string | undefined)[] = body.properties.map(
		(property: ts.ObjectLiteralElementLike): string | undefined => ts.isSpreadAssignment(property) && ts.isIdentifier(property.expression) ? property.expression.text : undefined
	);
	if (bindingNames.some((name: string | undefined, index: number): boolean => name !== spreadNames[index])) {
		return undefined;
	}
	return orderedCalls;
}

/**
 * Matches an imported symbol from rxjs or rxjs/operators, including supported const aliases.
 * @param expression - Operator or combinator reference to resolve.
 * @param context - Source-local import metadata.
 * @param importedName - Exact exported symbol name required.
 * @returns Whether the resolved import matches the requested RxJS symbol.
 */
function isRxjsSymbol(expression: ts.Expression, context: IAnalysisContext, importedName: string): boolean {
	const symbol: IImportedSymbol | undefined = resolveImportedSymbol(expression, context);
	return Boolean(symbol && (symbol.moduleName === 'rxjs' || symbol.moduleName === 'rxjs/operators') && symbol.importedName === importedName);
}

/**
 * Analyzes a registered class's getTranslation(locale) method for supported direct HTTP requests.
 * Requires one identifier parameter, a single usable return, recognized client members, and static locale templates.
 * Multiple requests require the explicitly supported merge shape; no loader code is executed.
 * @param declaration - Resolved registered loader class.
 * @param context - Source and import indexes owning the class.
 * @param locales - Project-wide locale values copied into a successful candidate.
 * @returns A deterministic loader candidate or diagnostics explaining unsupported method behavior.
 */
function analyzeLoaderClass(
	declaration: ts.ClassDeclaration,
	context: IAnalysisContext,
	locales: string[]
): { candidate?: ITranslationLoaderCandidate; diagnostics: ILoaderDetectionDiagnostic[] } {
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	const methods: ts.MethodDeclaration[] = declaration.members.filter(
		(member: ts.ClassElement): member is ts.MethodDeclaration => ts.isMethodDeclaration(member) && memberName(member) === 'getTranslation'
	);
	if (methods.length !== 1 || methods[0].parameters.length !== 1 || !ts.isIdentifier(methods[0].parameters[0].name)) {
		return { diagnostics: [customDiagnostic('transloco-http-unsupported-provider', 'The registered Transloco loader must expose one statically analyzable getTranslation(locale) method.', declaration, context)] };
	}
	const method: ts.MethodDeclaration = methods[0];
	const conditional: ts.IfStatement | ts.SwitchStatement | undefined = method.body?.statements.find(
		(statement: ts.Statement): statement is ts.IfStatement | ts.SwitchStatement => ts.isIfStatement(statement) || ts.isSwitchStatement(statement)
	);
	if (conditional) {
		return { diagnostics: [diagnosticForFailure({ kind: 'conditional', node: conditional }, context)] };
	}
	const returned: ts.Expression | undefined = returnedExpression(method);
	const members: Set<string> = httpClientMembers(declaration, context);
	if (!returned || members.size === 0) {
		return { diagnostics: [customDiagnostic('transloco-http-unsupported-provider', 'The registered Transloco loader must directly use Angular HttpClient in getTranslation(locale).', method, context)] };
	}
	const calls: ts.CallExpression[] = httpCalls(method.body!, members);
	if (calls.length === 0) {
		return {
			diagnostics: [
				customDiagnostic('transloco-http-unsupported-provider', 'No direct Angular HttpClient.get() call was found in the registered Transloco loader.', returned, context)
			]
		};
	}
	let orderedCalls: ts.CallExpression[];
	if (calls.length === 1 && unwrapExpression(returned) === calls[0]) {
		orderedCalls = calls;
	} else {
		const explicit: ts.CallExpression[] | undefined = explicitMultiRequestOrder(returned, calls, context);
		if (!explicit) {
			return { diagnostics: [diagnosticForFailure({ kind: 'merge', node: returned }, context)] };
		}
		orderedCalls = explicit;
	}
	const resources: ILoaderResourceTemplate[] = [];
	for (const call of orderedCalls) {
		if (call.arguments.length === 0) {
			diagnostics.push(diagnosticForFailure({ kind: 'unsupported', node: call }, context));
			continue;
		}
		const url: IUrlResolution = resolveUrl(call.arguments[0], methods[0].parameters[0].name.text, context);
		if (url.failure) {
			diagnostics.push(diagnosticForFailure(url.failure, context));
		} else if (url.value?.includes('{locale}')) {
			resources.push(templateResource(url.value));
		} else {
			diagnostics.push(diagnosticForFailure({ kind: 'unsupported', node: call.arguments[0] }, context));
		}
	}
	if (diagnostics.length || resources.length !== orderedCalls.length) {
		return { diagnostics };
	}
	return {
		diagnostics,
		candidate: {
			framework: 'transloco', loader: 'http', api: 'TranslocoLoader', confidence: 'deterministic',
			resources, locales: [...locales], location: locationOf(method, context)
		}
	};
}

/**
 * Reports Transloco scope registrations and recognized Angular HTTP interceptor configuration.
 * Interceptors disable all loader candidates because they may alter request URLs at runtime.
 * @param contexts - Supplied source contexts to inspect.
 * @param diagnostics - Diagnostic list updated with guard findings.
 * @returns Whether a recognized HTTP interceptor configuration was found.
 */
function findGuards(contexts: IAnalysisContext[], diagnostics: ILoaderDetectionDiagnostic[]): boolean {
	let hasInterceptor: boolean = false;
	for (const context of contexts) {
		/**
		 * Walks source syntax to identify scope providers and supported interceptor registrations.
		 * @param node - Current node and subtree being inspected.
		 */
		const visit: (node: ts.Node) => void = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && isTranslocoSymbol(node.expression, context, 'provideTranslocoScope')) {
				diagnostics.push(customDiagnostic('transloco-http-unsupported-scope', 'Scoped Transloco loaders compose paths at runtime and require explicit configuration.', node, context));
			}
			if (ts.isObjectLiteralExpression(node)) {
				const provide: ts.ObjectLiteralElementLike | undefined = findProperty(node, 'provide');
				const expression: ts.Expression | undefined = provide ? propertyExpression(provide, context).expression : undefined;
				if (expression && isTranslocoSymbol(expression, context, 'TRANSLOCO_SCOPE')) {
					diagnostics.push(customDiagnostic('transloco-http-unsupported-scope', 'Scoped Transloco loaders compose paths at runtime and require explicit configuration.', node, context));
				}
				if (expression) {
					const symbol: IImportedSymbol | undefined = resolveImportedSymbol(expression, context);
					if (symbol?.moduleName === ANGULAR_HTTP_MODULE && symbol.importedName === 'HTTP_INTERCEPTORS') {
						hasInterceptor = true;
						diagnostics.push(customDiagnostic('transloco-http-interceptor', 'Angular HTTP interceptors may alter Transloco request URLs; automatic detection is disabled.', node, context));
					}
				}
			}
			if (ts.isCallExpression(node)) {
				const symbol: IImportedSymbol | undefined = resolveImportedSymbol(node.expression, context);
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

/**
 * Detects statically registered Transloco HTTP loader classes from supplied project source text.
 * Resolves supported local class imports and locale metadata, analyzes constrained GET/merge shapes,
 * and suppresses candidates when recognized HTTP interceptors are present. Performs no runtime I/O or execution.
 * @param files - Source filenames and content from the caller.
 * @returns Supported candidates and diagnostics deduplicated by code and complete source range.
 */
export function analyzeTranslocoHttpLoaders(files: readonly ILoaderAnalysisSourceFile[]): ITranslationLoaderAnalysisResult {
	const contexts: IAnalysisContext[] = files.map(collectAnalysisContext);
	const candidates: ITranslationLoaderCandidate[] = [];
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	const locales: ReturnType<typeof collectNamedLiteralStringArrays> = collectNamedLiteralStringArrays(contexts, /^(supported|available|app)?(locales|languages|langs)$/);
	const localeValues: string[] = [...locales.values];
	for (const failure of locales.failures) {
		diagnostics.push(diagnosticForFailure(failure.failure, failure.context));
	}
	const registrations: IRegisteredLoader[] = collectRegistrations(contexts, localeValues, diagnostics);
	const hasInterceptor: boolean = findGuards(contexts, diagnostics);
	if (!hasInterceptor) {
		for (const registration of registrations) {
			const resolved: ReturnType<typeof resolveClassDeclaration> = resolveClassDeclaration(registration.expression, registration.context, contexts);
			if (resolved.ambiguousNode) {
				diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: resolved.ambiguousNode }, registration.context));
			} else if (!resolved.declaration || !resolved.context) {
				diagnostics.push(
					customDiagnostic(
						'transloco-http-unsupported-provider',
						'The registered Transloco loader class could not be resolved from the supplied project files.',
						registration.expression,
						registration.context
					)
				);
			} else {
				const result: ReturnType<typeof analyzeLoaderClass> = analyzeLoaderClass(resolved.declaration, resolved.context, localeValues);
				if (result.candidate) {
					candidates.push(result.candidate);
				}
				diagnostics.push(...result.diagnostics);
			}
		}
	}
	return { candidates, diagnostics: uniqueDiagnostics(diagnostics) };
}
