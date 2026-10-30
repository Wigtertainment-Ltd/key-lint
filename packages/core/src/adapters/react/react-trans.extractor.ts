import ts from 'typescript';
import { IKeyUsage } from '../scan-adapter.interface.js';
import { IPlaceholderParameterUsage } from '../../util/placeholder.util.js';
import { mergeReactParameters, readReactInterpolationParameters, readReactParameters } from './react-placeholder.util.js';
import { IReactTranslationScope } from './react-scope.util.js';
import { reactCountProperty, reactKeyUsage, reactPluralUsage } from './react-key-usage.util.js';
import { IReactImports, matchesReactImport, readReactOptions, readReactString, resolveReactExpression } from './react-typescript.util.js';

function transAttributes(attributes: ts.JsxAttributes): Map<string, ts.Expression | undefined> {
	const values: Map<string, ts.Expression | undefined> = new Map<string, ts.Expression | undefined>();
	for (const attribute of attributes.properties) {
		if (ts.isJsxSpreadAttribute(attribute)) {
			throw new Error('React Trans props cannot be resolved statically when JSX spreads are used.');
		}
		const initializer: ts.JsxAttributeValue | undefined = attribute.initializer;
		values.set(attribute.name.getText(), initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer);
	}
	return values;
}

function childParameters(children: readonly ts.JsxChild[], checker: ts.TypeChecker): IPlaceholderParameterUsage[] {
	const groups: IPlaceholderParameterUsage[] = [];
	for (const child of children) {
		if (ts.isJsxElement(child) || ts.isJsxFragment(child)) {
			groups.push(...childParameters(child.children, checker));
		}
		if (ts.isJsxExpression(child) && child.expression) {
			const value: ts.Expression = resolveReactExpression(child.expression, checker);
			if (!ts.isLiteralExpression(value) && ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(value.kind)) {
				groups.push(readReactParameters(value, checker));
			}
		}
	}
	return groups;
}

function childCount(children: readonly ts.JsxChild[], checker: ts.TypeChecker): ts.Expression | undefined {
	let count: ts.Expression | undefined;
	for (const child of children) {
		if (ts.isJsxElement(child) || ts.isJsxFragment(child)) {
			count = childCount(child.children, checker) ?? count;
		}
		if (ts.isJsxExpression(child)) {
			count = reactCountProperty(child.expression, checker) ?? count;
		}
	}
	return count;
}

function transScope(
	props: Map<string, ts.Expression | undefined>,
	checker: ts.TypeChecker,
	translators: Map<ts.Symbol, IReactTranslationScope>,
	defaultNamespace: string
): IReactTranslationScope {
	let scope: { namespace: string; keyPrefix: string } = { namespace: defaultNamespace, keyPrefix: '' };
	const translator: ts.Expression | undefined = props.get('t');
	if (translator) {
		const symbol: ts.Symbol | undefined = checker.getSymbolAtLocation(resolveReactExpression(translator, checker));
		const bound: IReactTranslationScope | undefined = symbol ? translators.get(symbol) : undefined;
		if (!bound) {
			throw new Error('React Trans t prop cannot be resolved statically to a useTranslation binding.');
		}
		scope = bound;
	}
	const namespace: ts.Expression | undefined = props.get('ns');
	return namespace ? { ...scope, namespace: readReactString(namespace, checker) || scope.namespace } : scope;
}

/** Extracts explicit keys from imported Trans components and their interpolation inputs. */
export function extractReactTrans(
	node: ts.JsxElement | ts.JsxSelfClosingElement,
	checker: ts.TypeChecker,
	imports: IReactImports,
	translators: Map<ts.Symbol, IReactTranslationScope>,
	defaultNamespace: string
): IKeyUsage | undefined {
	const opening: ts.JsxSelfClosingElement | ts.JsxOpeningElement = ts.isJsxElement(node) ? node.openingElement : node;
	if (ts.isJsxNamespacedName(opening.tagName) || !matchesReactImport(opening.tagName, checker, imports.components, imports.namespaces, 'Trans')) {
		return undefined;
	}
	const props: Map<string, ts.Expression | undefined> = transAttributes(opening.attributes);
	const key: ts.Expression | undefined = props.get('i18nKey');
	if (!key) {
		return undefined;
	}
	if (props.has('i18n')) {
		throw new Error('React Trans custom i18n instances cannot be resolved statically.');
	}
	const scope: IReactTranslationScope = transScope(props, checker, translators, defaultNamespace);
	const options: Map<string, ts.Expression> = readReactOptions(props.get('tOptions'), checker);
	// Trans supplies ns itself; keyPrefix is interpreted only by a bound getFixedT function.
	options.delete('ns');
	if (!props.has('t')) {
		options.delete('keyPrefix');
	}
	const groups: IPlaceholderParameterUsage[] = ts.isJsxElement(node) ? childParameters(node.children, checker) : [];
	groups.push(readReactInterpolationParameters(props.get('tOptions'), checker, options));
	if (props.has('count')) {
		groups.push({ kind: 'static', names: ['count'] });
	}
	groups.push(readReactParameters(props.get('values'), checker));
	const count: ts.Expression | undefined =
		reactCountProperty(props.get('values'), checker) ?? props.get('count') ?? options.get('count') ?? (ts.isJsxElement(node) ? childCount(node.children, checker) : undefined);
	const pluralOptions: Map<string, ts.Expression> = new Map<string, ts.Expression>(options);
	if (count) {
		pluralOptions.set('count', count);
	}
	const sourceFile: ts.SourceFile = node.getSourceFile();
	const sourceIndex: number = node.getStart(sourceFile);
	const { line, character }: ts.LineAndCharacter = sourceFile.getLineAndCharacterOfPosition(sourceIndex);
	return {
		...reactKeyUsage(key, checker, scope, options),
		plural: reactPluralUsage(pluralOptions, checker),
		filePath: sourceFile.fileName,
		line: line + 1,
		column: character + 1,
		sourceIndex,
		snippet: node.getText(sourceFile),
		matchType: 'react-trans',
		placeholderParameters: mergeReactParameters(groups)
	};
}
