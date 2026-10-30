import ts from 'typescript';
import { unwrapExpression } from '../../detection/shared/typescript-analysis.util.js';

export interface IReactImports {
	hooks: Set<ts.Symbol>;
	components: Set<ts.Symbol>;
	namespaces: Set<ts.Symbol>;
}

export function matchesReactImport(expression: ts.Expression, checker: ts.TypeChecker, symbols: Set<ts.Symbol>, namespaces: Set<ts.Symbol>, name: string): boolean {
	const callee = unwrapExpression(expression);
	const symbol = checker.getSymbolAtLocation(callee);
	if (ts.isIdentifier(callee)) return symbol !== undefined && symbols.has(symbol);
	if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== name) return false;
	const namespace = checker.getSymbolAtLocation(callee.expression);
	return namespace !== undefined && namespaces.has(namespace);
}

/** Binds source-local symbols without loading modules or executing application code. */
export function parseReactSource(filePath: string, source: string): { sourceFile: ts.SourceFile; checker: ts.TypeChecker } {
	const scriptKind = filePath.endsWith('.jsx') ? ts.ScriptKind.JSX : filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
	const program = ts.createProgram(
		[filePath],
		{ allowJs: true, noLib: true, noResolve: true, types: [], jsx: ts.JsxEmit.Preserve },
		{
			getSourceFile: (name) => (name === filePath ? sourceFile : undefined),
			getDefaultLibFileName: () => '',
			writeFile: () => undefined,
			getCurrentDirectory: () => '',
			getDirectories: () => [],
			fileExists: (name) => name === filePath,
			readFile: (name) => (name === filePath ? source : undefined),
			getCanonicalFileName: (name) => name,
			useCaseSensitiveFileNames: () => true,
			getNewLine: () => '\n'
		}
	);
	return { sourceFile, checker: program.getTypeChecker() };
}

/** Follows const aliases while preserving scope and stopping cycles. */
export function resolveReactExpression(expression: ts.Expression, checker: ts.TypeChecker, seen = new Set<ts.Symbol>()): ts.Expression {
	const value = unwrapExpression(expression);
	if (!ts.isIdentifier(value)) return value;
	const symbol = ts.isShorthandPropertyAssignment(value.parent) ? checker.getShorthandAssignmentValueSymbol(value.parent) : checker.getSymbolAtLocation(value);
	const declaration = symbol?.valueDeclaration;
	if (!symbol || seen.has(symbol) || !declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return value;
	if ((declaration.parent.flags & ts.NodeFlags.Const) === 0) return value;
	seen.add(symbol);
	return resolveReactExpression(declaration.initializer, checker, seen);
}

export function isReactDefaultArgument(expression: ts.Expression | undefined): boolean {
	return !expression || expression.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(expression) && expression.text === 'undefined');
}

export function readReactString(expression: ts.Expression, checker: ts.TypeChecker): string {
	const value = resolveReactExpression(expression, checker);
	if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text;
	throw new Error(`React translation namespace or keyPrefix cannot be resolved statically in ${expression.getSourceFile().fileName}.`);
}

export function readReactStringList(expression: ts.Expression, checker: ts.TypeChecker): string[] {
	const value = resolveReactExpression(expression, checker);
	return ts.isArrayLiteralExpression(value) ? value.elements.map((element) => readReactString(element, checker)) : [readReactString(value, checker)];
}

export function reactPropertyName(name: ts.PropertyName, checker: ts.TypeChecker): string | undefined {
	const value = ts.isComputedPropertyName(name) ? resolveReactExpression(name.expression, checker) : name;
	return (ts.isIdentifier(value) && !ts.isComputedPropertyName(name)) || ts.isStringLiteralLike(value) || ts.isNumericLiteral(value) ? value.text : undefined;
}

/** Reads only the option structure; interpolation values and other runtime fields are left unevaluated. */
export function readReactOptions(expression: ts.Expression | undefined, checker: ts.TypeChecker): Map<string, ts.Expression> {
	const options = new Map<string, ts.Expression>();
	if (!expression) return options;
	const value = resolveReactExpression(expression, checker);
	if (isReactDefaultArgument(value) || ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return options;
	if (!ts.isObjectLiteralExpression(value)) throw new Error(`React translation options cannot be resolved statically in ${expression.getSourceFile().fileName}.`);
	for (const property of value.properties) {
		const name = property.name ? reactPropertyName(property.name, checker) : undefined;
		if ((!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) || name === undefined) {
			throw new Error(`React translation options cannot be resolved statically in ${expression.getSourceFile().fileName}.`);
		}
		options.set(name, ts.isPropertyAssignment(property) ? property.initializer : property.name);
	}
	return options;
}
