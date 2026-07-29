import { FileSystemAdapter, matchesAny, normalizePath } from '@key-lint/core';
import { ElectronService } from './electron.service';

/**
 * Filesystem adapter backed by the Node `fs` module exposed through the Electron renderer.
 * The CLI uses its own Node based adapter from `@key-lint/core`.
 */
export class ElectronFileSystemAdapter implements FileSystemAdapter {
	constructor(private readonly electronService: ElectronService) { }

	async fileExists(filePath: string): Promise<boolean> {
		if (!this.electronService.isElectron) {
			return false;
		}

		return this.electronService.fs.existsSync(filePath);
	}

	async readFile(filePath: string): Promise<string> {
		if (!this.electronService.isElectron) {
			throw new Error('Electron runtime is required for filesystem access.');
		}

		return this.electronService.fs.readFileSync(filePath, 'utf8');
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

			const entries = this.electronService.fs.readdirSync(current, { withFileTypes: true }) as Array<{
				isDirectory(): boolean;
				isFile(): boolean;
				name: string;
			}>;

			for (const entry of entries) {
				const fullPath = `${current.replace(/[\\/]$/, '')}/${entry.name}`;
				const normalizedFullPath = normalizePath(fullPath);

				if (entry.isDirectory()) {
					const relativeDir = normalizedFullPath.replace(`${normalizedRoot}/`, '');
					if (matchesAny(normalizedFullPath, excludeGlobs) || matchesAny(relativeDir, excludeGlobs)) {
						continue;
					}

					stack.push(fullPath);
					continue;
				}

				if (!entry.isFile()) {
					continue;
				}

				const relativeFile = normalizedFullPath.replace(`${normalizedRoot}/`, '');
				const included =
					matchesAny(normalizedFullPath, includeGlobs) || matchesAny(relativeFile, includeGlobs);
				const excluded =
					matchesAny(normalizedFullPath, excludeGlobs) || matchesAny(relativeFile, excludeGlobs);

				if (included && !excluded) {
					results.push(normalizedFullPath);
				}
			}
		}

		return results;
	}
}
