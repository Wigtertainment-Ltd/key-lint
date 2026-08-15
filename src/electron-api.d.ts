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
	}

	interface Window {
		keyLint?: IKeyLintDesktopApi;
	}
}
