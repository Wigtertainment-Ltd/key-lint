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
