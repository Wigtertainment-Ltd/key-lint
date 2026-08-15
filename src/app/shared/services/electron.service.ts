import { Injectable } from '@angular/core';

@Injectable({
	providedIn: 'root'
})
export class ElectronService {
	get isElectron(): boolean {
		return typeof window !== 'undefined' && window.keyLint !== undefined;
	}

	selectProjectDirectory(): Promise<string | undefined> {
		return this.bridge().selectProjectDirectory();
	}

	getPathForFile(file: File): string {
		return this.bridge().getPathForFile(file);
	}

	getAppVersion(): Promise<string> {
		return this.bridge().getAppVersion();
	}

	pathExists(filePath: string): Promise<boolean> {
		return this.bridge().pathExists(filePath);
	}

	readFile(filePath: string): Promise<string> {
		return this.bridge().readFile(filePath);
	}

	writeFile(filePath: string, content: string): Promise<void> {
		return this.bridge().writeFile(filePath, content);
	}

	readDirectory(directoryPath: string): Promise<IKeyLintDirectoryEntry[]> {
		return this.bridge().readDirectory(directoryPath);
	}

	private bridge(): IKeyLintDesktopApi {
		if (!this.isElectron) {
			throw new Error('Electron preload bridge is not available.');
		}

		return window.keyLint as IKeyLintDesktopApi;
	}
}
