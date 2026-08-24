export interface ILoaderAnalysisSourceFile {
	filePath: string;
	content: string;
}

export interface ILoaderSourceLocation {
	filePath: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
}

export type LoaderUrlKind = 'absolute' | 'relative';

export interface ILoaderResourceTemplate {
	urlTemplate: string;
	urlKind: LoaderUrlKind;
	requiresOrigin: boolean;
}

export interface ITranslationLoaderCandidate {
	framework: 'ngx-translate';
	loader: 'http';
	api: 'provideTranslateHttpLoader' | 'TranslateHttpLoader';
	confidence: 'deterministic';
	resources: ILoaderResourceTemplate[];
	locales: string[];
	location: ILoaderSourceLocation;
}

export type LoaderDiagnosticCategory = 'dynamic' | 'ambiguous' | 'unsupported';

export interface ILoaderDetectionDiagnostic {
	code:
		| 'ngx-http-dynamic-environment'
		| 'ngx-http-conditional-url'
		| 'ngx-http-ambiguous-merge'
		| 'ngx-http-ambiguous-reference'
		| 'ngx-http-unsupported-transformation'
		| 'ngx-http-unsupported-expression'
		| 'ngx-http-unsupported-factory';
	category: LoaderDiagnosticCategory;
	message: string;
	location: ILoaderSourceLocation;
}

export interface ITranslationLoaderAnalysisResult {
	candidates: ITranslationLoaderCandidate[];
	diagnostics: ILoaderDetectionDiagnostic[];
}
