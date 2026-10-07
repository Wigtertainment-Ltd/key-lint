import { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import { IScannerConfig } from '../config/config.interfaces.js';
import { normalizePath } from '../util/path.util.js';
import { ILoaderAnalysisSourceFile, ILoaderDetectionDiagnostic } from './loader-detection.interfaces.js';
import { analyzeNgxTranslateHttpLoaders } from './ngx-translate-http-loader.analyzer.js';
import { analyzeTranslocoHttpLoaders } from './transloco-http-loader.analyzer.js';
import { IAutoHttpProjectAnalysis } from './auto-http-source-resolver.js';

export * from './auto-http-source-resolver.js';

/**
 * Identifies an analysis diagnostic by code and complete source range.
 *
 * @param diagnostic - Diagnostic to compare across framework analyzers.
 * @returns A stable identity excluding category and message text.
 */
function diagnosticKey(diagnostic: ILoaderDetectionDiagnostic): string {
	const location = diagnostic.location;
	return `${diagnostic.code}:${location.filePath}:${location.line}:${location.column}:${location.endLine}:${location.endColumn}`;
}

/**
 * Reads selected TypeScript files and analyzes ngx-translate and Transloco loaders without executing project code.
 * Normalizes and sorts TS/TSX paths, runs both analyzers, and keeps the first diagnostic for each code and range.
 *
 * @param projectRoot - Project directory passed to source enumeration.
 * @param fs - Filesystem adapter used to list and read source text.
 * @param config - Source include/exclude patterns used for analysis.
 * @returns Combined candidates, deduplicated diagnostics, and the ordered analyzed source paths.
 * @throws {Error} When source enumeration or reading fails.
 */
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
