export {};

declare global {
	interface IKeyLintDirectoryEntry {
		name: string;
		isDirectory: boolean;
		isFile: boolean;
		isSymbolicLink: boolean;
		sizeBytes?: number;
	}

	interface IKeyLintDesktopApi {
		loadProjectSettings(projectRoot: string): Promise<IKeyLintSavedProjectSettings | undefined>;
		saveProjectSettings(projectRoot: string, sources: IKeyLintSavedTranslationSource[], guardrails?: IKeyLintSavedGuardrails): Promise<void>;
		deleteProjectSettings(projectRoot: string): Promise<void>;
		selectProjectDirectory(): Promise<string | undefined>;
		getPathForFile(file: File): string;
		getAppVersion(): Promise<string>;
		pathExists(filePath: string): Promise<boolean>;
		readFile(filePath: string): Promise<string>;
		writeFile(filePath: string, content: string): Promise<void>;
		readDirectory(directoryPath: string): Promise<IKeyLintDirectoryEntry[]>;
		analyzeTranslationLoaders(files: IKeyLintLoaderAnalysisFile[]): Promise<unknown>;
		fetchTranslationResource(request: IKeyLintTranslationFetchRequest): Promise<IKeyLintTranslationFetchResult>;
		endTranslationScan(scanId: string): Promise<IKeyLintTranslationEndResult>;
	}

	interface IKeyLintLoaderAnalysisFile {
		filePath: string;
		content: string;
	}

	interface IKeyLintSavedTranslationSource {
		type: 'filesystem' | 'http' | 'auto-http';
		id: string;
		includeGlobs: string[];
		urlTemplate: string;
		origin: string;
		locales: string[];
		headers: { name: string; value: string; environmentName: string; configured: boolean }[];
		selectedCandidateIndex?: number;
	}

	interface IKeyLintSavedGuardrails {
		maxFiles: number;
		maxFileSizeBytes: number;
	}

	interface IKeyLintSavedProjectSettings {
		sources: IKeyLintSavedTranslationSource[];
		guardrails?: IKeyLintSavedGuardrails;
	}

	interface IKeyLintTranslationFetchRequest {
		scanId: string;
		method: 'GET';
		url: string;
		headers: Record<string, string>;
		timeoutMs: 15000;
		maxRedirects: 3;
		maxResponseBytes: number;
	}

	interface IKeyLintTranslationTransportError {
		code: string;
		message: string;
	}

	type IKeyLintTranslationFetchResult =
		| { ok: true; value: { body: string; finalUrl: string } }
		| { ok: false; error: IKeyLintTranslationTransportError };

	type IKeyLintTranslationEndResult =
		| { ok: true }
		| { ok: false; error: IKeyLintTranslationTransportError };

	interface Window {
		keyLint?: IKeyLintDesktopApi;
	}
}
