import ts from 'typescript';
import { ILoaderAnalysisSourceFile } from './loader-detection.interfaces.js';

export interface IImportedSymbol {
	moduleName: string;
	importedName: string;
}

export interface IAnalysisContext {
	input: ILoaderAnalysisSourceFile;
	sourceFile: ts.SourceFile;
	imports: Map<string, IImportedSymbol>;
	namespaces: Map<string, string>;
	constantInitializers: Map<string, IConstantDeclaration[]>;
	shadowDeclarations: Map<string, ts.Node[]>;
	functionDeclarations: Map<string, (ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression)[]>;
}

export interface IConstantDeclaration {
	declaration: ts.VariableDeclaration;
	initializer: ts.Expression;
}

export interface IResolvedExpression {
	expression?: ts.Expression;
	ambiguousNode?: ts.Node;
}
