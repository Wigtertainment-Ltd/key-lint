import ts from 'typescript';

import { ILoaderAnalysisSourceFile } from '../loader-detection.interfaces.js';

export interface IImportedSymbol {
	moduleName: string;
	importedName: string;
}

export interface IConstantDeclaration {
	declaration: ts.VariableDeclaration;
	initializer: ts.Expression;
}

export interface IAnalysisContext {
	input: ILoaderAnalysisSourceFile;
	sourceFile: ts.SourceFile;
	imports: Map<string, IImportedSymbol>;
	namespaces: Map<string, string>;
	constantInitializers: Map<string, IConstantDeclaration[]>;
	shadowDeclarations: Map<string, ts.Node[]>;
	functionDeclarations: Map<string, (ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression)[]>;
	classDeclarations: Map<string, ts.ClassDeclaration[]>;
}

export interface IResolvedExpression {
	expression?: ts.Expression;
	ambiguousNode?: ts.Node;
}

export type StaticExpressionFailureKind = 'ambiguous' | 'environment' | 'conditional' | 'merge' | 'transformation' | 'unsupported';

export interface IStaticExpressionFailure {
	kind: StaticExpressionFailureKind;
	node: ts.Node;
}
