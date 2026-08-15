import {
	DEFAULT_SCANNER_CONFIG,
	IFileSystemAdapter,
	IFileSystemWarning,
	IScannerGuardrails,
	matchesAny,
	normalizePath
} from '@key-lint/core';
import { ElectronService } from './electron.service';

/**
 * Filesystem adapter backed by the Node `fs` module exposed through the Electron renderer.
 * The CLI uses its own Node based adapter from `@key-lint/core`.
 */
export class ElectronFileSystemAdapter implements IFileSystemAdapter {
	private collectedWarnings: IFileSystemWarning[] = [];
	private guardrails: IScannerGuardrails;

	constructor(
		private readonly electronService: ElectronService,
		guardrails: IScannerGuardrails = DEFAULT_SCANNER_CONFIG.guardrails
	) {
		this.guardrails = { ...guardrails };
	}

	get warnings(): IFileSystemWarning[] {
		return [...this.collectedWarnings];
	}

	configureGuardrails(guardrails: IScannerGuardrails): void {
		this.guardrails = { ...guardrails };
		this.collectedWarnings = [];
	}

	async fileExists(filePath: string): Promise<boolean> {
		if (!this.electronService.isElectron) {
			return false;
		}

		return this.electronService.pathExists(filePath);
	}

	async readFile(filePath: string): Promise<string> {
		if (!this.electronService.isElectron) {
			throw new Error('Electron runtime is required for filesystem access.');
		}

		return this.electronService.readFile(filePath);
	}

	async listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]> {
		if (!this.electronService.isElectron) {
			return [];
		}

		const rootForFs = projectRoot;
		const normalizedRoot = normalizePath(projectRoot);
		const results: string[] = [];
		const stack: string[] = [rootForFs];

		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) {
				continue;
			}

			let entries: IKeyLintDirectoryEntry[];
			try {
				entries = await this.electronService.readDirectory(current);
			} catch (error) {
				this.collectedWarnings.push({
					code: 'unreadable-directory',
					filePath: normalizePath(current),
					message: `Directory could not be read: ${error instanceof Error ? error.message : 'unknown error'}`
				});
				continue;
			}

			for (const entry of entries) {
				const fullPath = `${current.replace(/[\\/]$/, '')}/${entry.name}`;
				const normalizedFullPath = normalizePath(fullPath);
				const relativePath = normalizedFullPath.startsWith(`${normalizedRoot}/`)
					? normalizedFullPath.slice(normalizedRoot.length + 1)
					: normalizedFullPath;

				if (entry.isSymbolicLink) {
					this.collectedWarnings.push({
						code: 'symlink-skipped',
						filePath: normalizedFullPath,
						message: 'Symbolic links are not followed during a scan.'
					});
					continue;
				}

				if (entry.isDirectory) {
					if (matchesAny(normalizedFullPath, excludeGlobs) || matchesAny(relativePath, excludeGlobs)) {
						continue;
					}

					stack.push(fullPath);
					continue;
				}

				if (!entry.isFile) {
					continue;
				}

				const included =
					matchesAny(normalizedFullPath, includeGlobs) || matchesAny(relativePath, includeGlobs);
				const excluded =
					matchesAny(normalizedFullPath, excludeGlobs) || matchesAny(relativePath, excludeGlobs);

				if (!included || excluded) {
					continue;
				}

				if (results.length >= this.guardrails.maxFiles) {
					this.collectedWarnings.push({
						code: 'max-files-reached',
						message: `Stopped after ${this.guardrails.maxFiles} files. Narrow the include globs or raise guardrails.maxFiles.`
					});
					return results;
				}

				if ((entry.sizeBytes ?? 0) > this.guardrails.maxFileSizeBytes) {
					this.collectedWarnings.push({
						code: 'file-too-large',
						filePath: normalizedFullPath,
						message: `Skipped because it exceeds guardrails.maxFileSizeBytes (${this.guardrails.maxFileSizeBytes} bytes).`
					});
					continue;
				}

				results.push(normalizedFullPath);
			}
		}

		return results;
	}
}
