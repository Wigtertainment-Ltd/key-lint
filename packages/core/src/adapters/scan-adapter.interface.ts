import { IFinding } from '../models/finding.model.js';
import { BaseLocaleSelectionSource } from '../util/translation-matrix.util.js';
import { ITranslationMatrix } from '../models/scan-result.model.js';
import { IScannerConfig } from '../config/config.interfaces.js';

export type TranslationFormat = 'json' | 'yaml' | 'xliff' | 'po';

export interface IAdapterCapabilities {
	templateParsing: boolean;
	typescriptParsing: boolean;
	translationFormats: TranslationFormat[];
}

export interface IAdapterDetectionResult {
	supported: boolean;
	confidence: number;
	reason?: string;
	resolvedProjectRoot?: string;
}

export interface IFileSystemAdapter {
	fileExists(filePath: string): Promise<boolean>;
	readFile(filePath: string): Promise<string>;
	listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]>;
}

export interface IProjectContext {
	projectRoot: string;
	config: IScannerConfig;
}

export interface IKeyUsage {
	key: string;
	filePath: string;
	line?: number;
	column?: number;
	snippet?: string;
	matchType?: string;
	isDynamic?: boolean;
	sourceIndex?: number;
	placeholderParameters?: {
		kind: 'absent' | 'static' | 'dynamic';
		names: string[];
		dynamicPrefixes?: string[];
	};
}

export interface IScanAdapter {
	id: string;
	framework: string;
	capabilities: IAdapterCapabilities;
	detect(projectRoot: string, fs: IFileSystemAdapter): Promise<IAdapterDetectionResult>;
	collectTranslationFiles(context: IProjectContext, fs: IFileSystemAdapter): Promise<string[]>;
	extractDefinedKeys(translationFiles: string[], fs: IFileSystemAdapter): Promise<string[]>;
	extractUsedKeys(context: IProjectContext, fs: IFileSystemAdapter): Promise<IKeyUsage[]>;
	buildTranslationMatrix?(translationFiles: string[], fs: IFileSystemAdapter): Promise<ITranslationMatrix>;
	runRules(input: {
		definedKeys: string[];
		usedKeys: IKeyUsage[];
		translationMatrix: ITranslationMatrix;
		baseLocale?: string;
		baseLocaleSelectionSource: BaseLocaleSelectionSource;
		context: IProjectContext;
	}): Promise<IFinding[]>;
}
