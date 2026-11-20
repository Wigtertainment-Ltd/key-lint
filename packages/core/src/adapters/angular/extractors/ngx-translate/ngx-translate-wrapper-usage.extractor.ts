import ts from 'typescript';
import { unwrapExpression } from '../../../../detection/shared/typescript-analysis.util.js';
import { normalizePath } from '../../../../util/path.util.js';
import { IPlaceholderParameterUsage, parsePlaceholderParameters } from '../../../../util/placeholder.util.js';
import { IKeyUsage } from '../../../scan-adapter.interface.js';
import { extractSnippet } from '../pattern-matcher.util.js';
import { findNgxTranslateWrappers, getAngularInjectionToken, INgxTranslateWrapper } from './ngx-translate-wrappers.js';

export interface INgxTranslateWrapperUsages {
	usages: IKeyUsage[];
	handledCalls: ReadonlySet<string>;
}

function createSourceProgram(sources: ReadonlyMap<string, string>): ts.Program {
	const options: ts.CompilerOptions = { noLib: true, types: [], module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
	const readFile: (fileName: string) => string | undefined = (fileName: string): string | undefined => sources.get(normalizePath(fileName));
	const host: ts.CompilerHost = {
		getSourceFile: (fileName: string, languageVersion: ts.ScriptTarget | ts.CreateSourceFileOptions): ts.SourceFile | undefined => {
			const content: string | undefined = readFile(fileName);
			return content === undefined ? undefined : ts.createSourceFile(fileName, content, languageVersion, true);
		},
		readFile,
		fileExists: (fileName: string): boolean => readFile(fileName) !== undefined,
		getDefaultLibFileName: (): string => '',
		writeFile: (): void => undefined,
		getCurrentDirectory: (): string => '',
		getCanonicalFileName: normalizePath,
		useCaseSensitiveFileNames: (): boolean => true,
		getNewLine: (): string => '\n'
	};
	return ts.createProgram([...sources.keys()], options, host);
}

function injectedMember(access: ts.PropertyAccessExpression, checker: ts.TypeChecker): ts.Symbol | undefined {
	const receiver: ts.Expression = unwrapExpression(access.expression);
	const declaration: ts.Declaration | undefined = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(receiver) ? receiver.name : receiver)?.valueDeclaration;
	const initializer: ts.Expression | undefined = declaration && (ts.isPropertyDeclaration(declaration) || ts.isVariableDeclaration(declaration))
		? declaration.initializer : receiver;
	const token: ts.Expression | undefined = initializer && getAngularInjectionToken(initializer, checker);
	const symbol: ts.Symbol | undefined = token && checker.getSymbolAtLocation(token);
	if (!symbol) {
		return undefined;
	}

	const target: ts.Symbol = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
	return target.flags & ts.SymbolFlags.Class ? checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(target), access.name.text) : undefined;
}

function wrapperForMethod(symbol: ts.Symbol | undefined, wrappers: ReadonlyMap<ts.MethodDeclaration, INgxTranslateWrapper>): INgxTranslateWrapper | undefined {
	for (const declaration of symbol?.declarations ?? []) {
		if (ts.isMethodDeclaration(declaration) && wrappers.has(declaration)) {
			return wrappers.get(declaration);
		}
	}
	return undefined;
}

function wrapperPlaceholders(args: readonly ts.Expression[], { interpolation }: INgxTranslateWrapper, checker: ts.TypeChecker): IPlaceholderParameterUsage {
	let expression: ts.Expression | undefined;
	if (interpolation && 'argumentIndex' in interpolation) {
		if (args.slice(0, interpolation.argumentIndex + 1).some(ts.isSpreadElement)) {
			return { kind: 'dynamic', names: [] };
		}
		const argument: ts.Expression | undefined = args[interpolation.argumentIndex];
		expression = !argument || checker.getTypeAtLocation(argument) === checker.getUndefinedType() ? interpolation.defaultValue : argument;
	} else {
		expression = interpolation;
	}
	return parsePlaceholderParameters(expression && unwrapExpression(expression).getText());
}

/** Resolves proven ngx-translate wrappers and their literal call sites in the source snapshot. */
export function extractNgxTranslateWrapperUsages(sources: ReadonlyMap<string, string>): INgxTranslateWrapperUsages | undefined {
	const contents: string[] = [...sources.values()];
	if (!contents.some((source: string): boolean => source.includes('@ngx-translate/core')) ||
		!contents.some((source: string): boolean => source.includes('instant'))) {
		return undefined;
	}

	const program: ts.Program = createSourceProgram(sources);
	const checker: ts.TypeChecker = program.getTypeChecker();
	const wrappers: Map<ts.MethodDeclaration, INgxTranslateWrapper> = new Map<ts.MethodDeclaration, INgxTranslateWrapper>();
	const methodNames: Set<string> = new Set<string>();
	for (const sourceFile of program.getSourceFiles()) {
		if (sourceFile.text.includes('instant')) {
			for (const [method, wrapper] of findNgxTranslateWrappers(sourceFile, checker)) {
				wrappers.set(method, wrapper);
				const name: string | undefined = checker.getSymbolAtLocation(method.name)?.getName();
				if (name) {
					methodNames.add(name);
				}
			}
		}
	}
	if (wrappers.size === 0) {
		return undefined;
	}

	const usages: IKeyUsage[] = [];
	const handledCalls: Set<string> = new Set<string>();
	for (const sourceFile of program.getSourceFiles()) {
		const filePath: string = normalizePath(sourceFile.fileName);
		const visit: (node: ts.Node) => void = (node: ts.Node): void => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && methodNames.has(node.expression.name.text)) {
				const access: ts.PropertyAccessExpression = node.expression;
				const wrapper: INgxTranslateWrapper | undefined = wrapperForMethod(checker.getSymbolAtLocation(access.name), wrappers) ??
					wrapperForMethod(injectedMember(access, checker), wrappers);
				const argument: ts.Expression | undefined = wrapper && node.arguments[wrapper.keyArgumentIndex];
				const key: ts.Expression | undefined = argument && unwrapExpression(argument);
				const sourceIndex: number = node.arguments.pos - 1;
				// A different key position invalidates name-based findings that use the first argument.
				if (wrapper && wrapper.keyArgumentIndex !== 0) {
					handledCalls.add(`${filePath}:${sourceIndex}`);
				}
				if (wrapper && key && ts.isStringLiteralLike(key) && key.text && !node.arguments.slice(0, wrapper.keyArgumentIndex).some(ts.isSpreadElement)) {
					const start: number = node.getStart(sourceFile);
					const location: ts.LineAndCharacter = sourceFile.getLineAndCharacterOfPosition(start);
					handledCalls.add(`${filePath}:${sourceIndex}`);
					usages.push({
						key: key.text,
						filePath,
						line: location.line + 1,
						column: location.character + 1,
						snippet: extractSnippet(sourceFile.text, start),
						matchType: 'ts-ngx-translate-wrapper',
						isDynamic: false,
						sourceIndex,
						placeholderParameters: wrapperPlaceholders(node.arguments, wrapper, checker)
					});
				}
			}
			ts.forEachChild(node, visit);
		};
		visit(sourceFile);
	}

	return { usages, handledCalls };
}
