import { ScannerConfig } from '../config/scanner-defaults';
import { Finding } from '../models/finding.model';
import { TranslationMatrix } from '../models/scan-result.model';

export type TranslationFormat = 'json' | 'yaml' | 'xliff' | 'po';

export interface AdapterCapabilities {
	templateParsing: boolean;
	typescriptParsing: boolean;
	translationFormats: TranslationFormat[];
}

export interface AdapterDetectionResult {
	supported: boolean;
	confidence: number;
	reason?: string;
	resolvedProjectRoot?: string;
}

export interface FileSystemAdapter {
	fileExists(filePath: string): Promise<boolean>;
	readFile(filePath: string): Promise<string>;
	listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]>;
}

export interface ProjectContext {
	projectRoot: string;
	config: ScannerConfig;
}

export interface KeyUsage {
	key: string;
	filePath: string;
	line?: number;
	column?: number;
	snippet?: string;
	matchType?: string;
	isDynamic?: boolean;
}

export interface ScanAdapter {
	id: string;
	framework: string;
	capabilities: AdapterCapabilities;
	detect(projectRoot: string, fs: FileSystemAdapter): Promise<AdapterDetectionResult>;
	collectTranslationFiles(context: ProjectContext, fs: FileSystemAdapter): Promise<string[]>;
	extractDefinedKeys(translationFiles: string[], fs: FileSystemAdapter): Promise<string[]>;
	extractUsedKeys(context: ProjectContext, fs: FileSystemAdapter): Promise<KeyUsage[]>;
	buildTranslationMatrix?(translationFiles: string[], fs: FileSystemAdapter): Promise<TranslationMatrix>;
	runRules(input: {
		definedKeys: string[];
		usedKeys: KeyUsage[];
		context: ProjectContext;
	}): Promise<Finding[]>;
}
