import ts from 'typescript';

import {
	ILoaderAnalysisSourceFile, ILoaderDetectionDiagnostic, ILoaderResourceTemplate, ITranslationLoaderAnalysisResult, ITranslationLoaderCandidate
} from './loader-detection.interfaces.js';
import { IAnalysisContext, IStaticExpressionFailure } from './shared/typescript-analysis.interfaces.js';
import {
	classifyStaticExpression, collectAnalysisContext, collectNamedLiteralStringArrays, conditionalAncestor, findProperty, locationOf, propertyExpression, resolveExpression,
	resolveFactoryDeclarations, resolveImportedSymbol, resolveStaticString, templateResource, uniqueDiagnostics, unsafeObjectElement, unwrapExpression
} from './shared/typescript-analysis.util.js';

const HTTP_LOADER_MODULE = '@ngx-translate/http-loader';
const TRANSLATE_CORE_MODULE = '@ngx-translate/core';
const DEFAULT_PREFIX = '/assets/i18n/';
const DEFAULT_SUFFIX = '.json';

/**
 * Maps a static-resolution failure to ngx-translate-specific diagnostic text and coordinates.
 * @param failure - Classified unsupported or ambiguous syntax.
 * @param context - Source context owning the failure node.
 * @returns A framework-specific diagnostic without evaluating the expression.
 */
function diagnosticForFailure(failure: IStaticExpressionFailure, context: IAnalysisContext): ILoaderDetectionDiagnostic {
	const details = {
		environment: ['ngx-http-dynamic-environment', 'dynamic', 'ngx-translate loader URLs that depend on runtime environment values require explicit configuration.'],
		conditional: ['ngx-http-conditional-url', 'dynamic', 'Conditional ngx-translate loader URL construction cannot be resolved deterministically.'],
		merge: ['ngx-http-ambiguous-merge', 'ambiguous', 'Spread or merged ngx-translate loader configuration may override URL fields and requires explicit configuration.'],
		transformation: ['ngx-http-unsupported-transformation', 'unsupported', 'Transformed ngx-translate loader URL values are not executed or guessed.'],
		unsupported: ['ngx-http-unsupported-expression', 'unsupported', 'ngx-translate loader URL values must be statically resolvable string literals.'],
		ambiguous: ['ngx-http-ambiguous-reference', 'ambiguous', 'This ngx-translate loader reference has multiple possible static declarations and was not guessed.']
	} as const;
	const [code, category, message] = details[failure.kind];
	return { code, category, message, location: locationOf(failure.node, context) };
}

/**
 * Classifies unresolved syntax and creates an ngx-translate diagnostic.
 * @param node - Syntax subtree that could not be resolved.
 * @param context - Source context used for classification and coordinates.
 * @returns The corresponding static-analysis diagnostic.
 */
function diagnosticForExpression(node: ts.Node, context: IAnalysisContext): ILoaderDetectionDiagnostic {
	return diagnosticForFailure(classifyStaticExpression(node, context), context);
}

/**
 * Resolves a static string or converts its resolution failure into an ngx-translate diagnostic.
 * @param expression - Literal or const-aliased string expression.
 * @param context - Source-local declaration information.
 * @returns Literal text or a diagnostic explaining why it could not be resolved.
 */
function resolveString(expression: ts.Expression, context: IAnalysisContext): { value?: string; diagnostic?: ILoaderDetectionDiagnostic } {
	const resolved = resolveStaticString(expression, context);
	return resolved.failure ? { diagnostic: diagnosticForFailure(resolved.failure, context) } : { value: resolved.value };
}

/**
 * Resolves a configuration property's static string value, including shorthand const references.
 * @param property - Object-literal property containing the value.
 * @param context - Declaration and import information for the property.
 * @returns Resolved text or a diagnostic for ambiguous or unsupported syntax.
 */
function resolvePropertyString(property: ts.ObjectLiteralElementLike, context: IAnalysisContext): { value?: string; diagnostic?: ILoaderDetectionDiagnostic } {
	const resolved = propertyExpression(property, context);
	if (resolved.ambiguousNode) return { diagnostic: diagnosticForFailure({ kind: 'ambiguous', node: resolved.ambiguousNode }, context) };
	return resolveString(resolved.expression as ts.Expression, context);
}

/**
 * Parses a modern loader resource as a literal prefix or a static prefix/suffix object.
 * Uses `.json` when the suffix is omitted and rejects spreads or unsupported property names.
 * @param entry - Resource-array entry, optionally reached through const aliases.
 * @param context - Source context used to resolve configuration values.
 * @returns A locale URL template or a diagnostic; does not validate or fetch the URL.
 */
function parseResourceEntry(entry: ts.Expression, context: IAnalysisContext): { resource?: ILoaderResourceTemplate; diagnostic?: ILoaderDetectionDiagnostic } {
	const resolved = resolveExpression(entry, context);
	if (resolved.ambiguousNode) return { diagnostic: diagnosticForFailure({ kind: 'ambiguous', node: resolved.ambiguousNode }, context) };
	const value = resolved.expression as ts.Expression;
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
		return { resource: templateResource(`${value.text}{locale}${DEFAULT_SUFFIX}`) };
	}
	if (!ts.isObjectLiteralExpression(value)) return { diagnostic: diagnosticForExpression(value, context) };
	const unsafeProperty = unsafeObjectElement(value);
	if (unsafeProperty) return { diagnostic: diagnosticForExpression(unsafeProperty, context) };
	const prefixProperty = findProperty(value, 'prefix');
	if (!prefixProperty) return { diagnostic: diagnosticForExpression(value, context) };
	const prefix = resolvePropertyString(prefixProperty, context);
	if (prefix.diagnostic) return { diagnostic: prefix.diagnostic };
	const suffixProperty = findProperty(value, 'suffix');
	const suffix = suffixProperty ? resolvePropertyString(suffixProperty, context) : { value: DEFAULT_SUFFIX };
	if (suffix.diagnostic) return { diagnostic: suffix.diagnostic };
	return { resource: templateResource(`${prefix.value}{locale}${suffix.value}`) };
}

/**
 * Parses provideTranslateHttpLoader defaults or one static configuration object.
 * Supports ordered resource arrays or prefix/suffix fields and suppresses the candidate if any resource is unsupported.
 * @param call - Recognized modern HTTP loader call.
 * @param context - Source context owning the call.
 * @returns A deterministic candidate with initially empty locales, or analysis diagnostics.
 */
function parseModernCall(call: ts.CallExpression, context: IAnalysisContext): { candidate?: ITranslationLoaderCandidate; diagnostics: ILoaderDetectionDiagnostic[] } {
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	let resources: ILoaderResourceTemplate[] = [];
	if (call.arguments.length > 1) return { diagnostics: [diagnosticForExpression(call.arguments[1], context)] };
	if (call.arguments.length === 0) {
		resources = [templateResource(`${DEFAULT_PREFIX}{locale}${DEFAULT_SUFFIX}`)];
	} else {
		const config = resolveExpression(call.arguments[0], context);
		if (config.ambiguousNode) return { diagnostics: [diagnosticForFailure({ kind: 'ambiguous', node: config.ambiguousNode }, context)] };
		if (!config.expression || !ts.isObjectLiteralExpression(config.expression)) {
			return { diagnostics: [diagnosticForExpression(config.expression ?? call.arguments[0], context)] };
		}
		const unsafeProperty = unsafeObjectElement(config.expression);
		if (unsafeProperty) return { diagnostics: [diagnosticForExpression(unsafeProperty, context)] };
		const resourcesProperty = findProperty(config.expression, 'resources');
		if (resourcesProperty) {
			const resolvedResources = propertyExpression(resourcesProperty, context);
			if (resolvedResources.ambiguousNode) return { diagnostics: [diagnosticForFailure({ kind: 'ambiguous', node: resolvedResources.ambiguousNode }, context)] };
			const resourceArray = resolvedResources.expression ? unwrapExpression(resolvedResources.expression) : undefined;
			if (!resourceArray || !ts.isArrayLiteralExpression(resourceArray) || resourceArray.elements.length === 0) {
				return { diagnostics: [diagnosticForExpression(resourceArray ?? resourcesProperty, context)] };
			}
			for (const entry of resourceArray.elements) {
				if (ts.isSpreadElement(entry)) diagnostics.push(diagnosticForExpression(entry, context));
				else {
					const parsed = parseResourceEntry(entry, context);
					if (parsed.diagnostic) diagnostics.push(parsed.diagnostic);
					if (parsed.resource) resources.push(parsed.resource);
				}
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

/**
 * Parses TranslateHttpLoader construction with a client argument and optional static prefix/suffix.
 * Accepts one to three arguments without evaluating or validating the client expression.
 * @param expression - Recognized legacy loader construction.
 * @param context - Source context used to resolve URL fragments.
 * @returns A candidate using omitted-fragment defaults, or diagnostics for unsupported arguments.
 */
function parseLegacyNew(expression: ts.NewExpression, context: IAnalysisContext): { candidate?: ITranslationLoaderCandidate; diagnostics: ILoaderDetectionDiagnostic[] } {
	const args = expression.arguments ?? [];
	if (args.length === 0 || args.length > 3) return { diagnostics: [diagnosticForExpression(args[3] ?? expression, context)] };
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

/**
 * Collects named locale arrays and static lang/fallbackLang fields in imported provideTranslateService calls.
 * @param contexts - Source files searched in input order.
 * @param diagnostics - Mutable collector for unsupported locale expressions.
 * @returns Non-empty locale strings deduplicated in first-seen order, without locale-schema validation.
 */
function extractLiteralLocales(contexts: IAnalysisContext[], diagnostics: ILoaderDetectionDiagnostic[]): string[] {
	const locales: string[] = [];
	/**
	 * Adds a non-empty locale only when not previously collected.
	 * @param value - Literal locale string to append.
	 */
	const addLocale = (value: string): void => { if (value && !locales.includes(value)) locales.push(value); };
	const namedArrays = collectNamedLiteralStringArrays(contexts, /^(supported|available|app)?(locales|languages|langs)$/);
	namedArrays.values.forEach(addLocale);
	for (const { context, failure } of namedArrays.failures) diagnostics.push(diagnosticForFailure(failure, context));
	for (const context of contexts) {
		/**
		 * Walks service configuration calls and appends static locale values or diagnostics.
		 * @param node - Current source node and subtree to inspect.
		 */
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === TRANSLATE_CORE_MODULE && symbol.importedName === 'provideTranslateService' && node.arguments[0]) {
					const config = resolveExpression(node.arguments[0], context);
					if (config.ambiguousNode) diagnostics.push(diagnosticForFailure({ kind: 'ambiguous', node: config.ambiguousNode }, context));
					else if (config.expression && ts.isObjectLiteralExpression(config.expression)) {
						for (const name of ['lang', 'fallbackLang']) {
							const property = findProperty(config.expression, name);
							if (!property) continue;
							const locale = resolvePropertyString(property, context);
							if (locale.diagnostic) diagnostics.push(locale.diagnostic);
							if (locale.value) addLocale(locale.value);
						}
					}
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(context.sourceFile);
	}
	return locales;
}

/**
 * Searches a subtree for construction of the imported ngx-translate HTTP loader.
 * @param node - Factory or expression subtree to inspect.
 * @param context - Import metadata used to distinguish genuine loader symbols.
 * @returns Whether a recognized TranslateHttpLoader construction occurs anywhere in the subtree.
 */
function containsImportedLegacyNew(node: ts.Node, context: IAnalysisContext): boolean {
	let found = false;
	/**
	 * Visits descendants until an imported legacy HTTP loader construction is found.
	 * @param child - AST node being checked.
	 */
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

/**
 * Reports TranslateLoader useFactory providers that lack recognized legacy HTTP loader construction.
 * Inspects visible factory bodies without calling them.
 * @param context - Source file and declaration indexes to inspect.
 * @param diagnostics - Diagnostic list updated in place.
 */
function diagnoseArbitraryFactories(context: IAnalysisContext, diagnostics: ILoaderDetectionDiagnostic[]): void {
	/**
	 * Walks provider objects and diagnoses unsupported custom translation factories.
	 * @param node - Current source node and descendants.
	 */
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

/**
 * Detects imported modern and legacy ngx-translate HTTP loaders using source-only TypeScript analysis.
 * Resolves supported literal/const configurations, attaches project-wide literal locales, and rejects
 * calls under ternary ancestors. Does not execute factories, fetch endpoints, or use a type checker.
 * @param files - Source filenames and content supplied by the caller.
 * @returns Detected candidates and diagnostics deduplicated by code and source range.
 */
export function analyzeNgxTranslateHttpLoaders(files: readonly ILoaderAnalysisSourceFile[]): ITranslationLoaderAnalysisResult {
	const contexts = files.map(collectAnalysisContext);
	const candidates: ITranslationLoaderCandidate[] = [];
	const diagnostics: ILoaderDetectionDiagnostic[] = [];
	const locales = extractLiteralLocales(contexts, diagnostics);
	for (const context of contexts) {
		/**
		 * Visits imported loader calls and constructions to collect candidates or diagnostics.
		 * @param node - Current node in the source-file traversal.
		 */
		const visit = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === HTTP_LOADER_MODULE && symbol.importedName === 'provideTranslateHttpLoader') {
					const conditional = conditionalAncestor(node);
					const parsed = conditional ? { diagnostics: [diagnosticForExpression(conditional, context)] } : parseModernCall(node, context);
					if (parsed.candidate) candidates.push({ ...parsed.candidate, locales: [...locales] });
					diagnostics.push(...parsed.diagnostics);
				}
			}
			if (ts.isNewExpression(node)) {
				const symbol = resolveImportedSymbol(node.expression, context);
				if (symbol?.moduleName === HTTP_LOADER_MODULE && symbol.importedName === 'TranslateHttpLoader') {
					const conditional = conditionalAncestor(node);
					const parsed = conditional ? { diagnostics: [diagnosticForExpression(conditional, context)] } : parseLegacyNew(node, context);
					if (parsed.candidate) candidates.push({ ...parsed.candidate, locales: [...locales] });
					diagnostics.push(...parsed.diagnostics);
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(context.sourceFile);
		diagnoseArbitraryFactories(context, diagnostics);
	}
	return { candidates, diagnostics: uniqueDiagnostics(diagnostics) };
}
