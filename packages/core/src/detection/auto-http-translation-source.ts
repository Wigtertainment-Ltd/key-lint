import { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import { IScannerConfig } from '../config/config.interfaces.js';
import { normalizePath } from '../util/path.util.js';
import { ILoaderAnalysisSourceFile, ILoaderDetectionDiagnostic } from './loader-detection.interfaces.js';
import { analyzeNgxTranslateHttpLoaders } from './ngx-translate-http-loader.analyzer.js';
import { analyzeTranslocoHttpLoaders } from './transloco-http-loader.analyzer.js';
import { IAutoHttpProjectAnalysis } from './auto-http-source-resolver.js';

export * from './auto-http-source-resolver.js';

function diagnosticKey(diagnostic: ILoaderDetectionDiagnostic): string {
	const location = diagnostic.location;
	return `${diagnostic.code}:${location.filePath}:${location.line}:${location.column}:${location.endLine}:${location.endColumn}`;
}

/** Parses project TypeScript as text and never imports or executes project code. */
export async function analyzeProjectTranslationLoaders(projectRoot: string, fs: IFileSystemAdapter, config: IScannerConfig): Promise<IAutoHttpProjectAnalysis> {
	const listed = await fs.listFiles(projectRoot, config.includeSourceGlobs, config.excludeGlobs);
	const sourceFiles = listed.map(normalizePath).filter((filePath) => /\.tsx?$/i.test(filePath)).sort((left, right) => left.localeCompare(right));
	const inputs: ILoaderAnalysisSourceFile[] = [];
	for (const filePath of sourceFiles) inputs.push({ filePath, content: await fs.readFile(filePath) });
	const ngx = analyzeNgxTranslateHttpLoaders(inputs);
	const transloco = analyzeTranslocoHttpLoaders(inputs);
	const seenDiagnostics = new Set<string>();
	const diagnostics = [...ngx.diagnostics, ...transloco.diagnostics].filter((diagnostic) => {
		const key = diagnosticKey(diagnostic);
		if (seenDiagnostics.has(key)) return false;
		seenDiagnostics.add(key);
		return true;
	});
	return { candidates: [...ngx.candidates, ...transloco.candidates], diagnostics, sourceFiles };
}
