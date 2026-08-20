import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import { IFileSystemAdapter } from '../adapters/scan-adapter.interface.js';
import { DEFAULT_SCANNER_CONFIG } from '../config/scanner-defaults.js';
import type { IFileSystemWarning } from '../models/file-system-warning.model.js';
import { matchesAny } from '../util/glob.util.js';
import { normalizePath } from '../util/path.util.js';
import { IScannerGuardrails } from '../config/config.interfaces.js';

export type { FileSystemWarningCode, IFileSystemWarning } from '../models/file-system-warning.model.js';

/**
 * Filesystem adapter for headless Node runtimes (CLI, CI).
 * Enforces the scanner guardrails and never follows symlinks, so a scan can
 * neither run away on huge repositories nor escape the selected project root.
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter {
	private readonly collectedWarnings: IFileSystemWarning[] = [];

	constructor(private readonly guardrails: IScannerGuardrails = DEFAULT_SCANNER_CONFIG.guardrails) { }

	get warnings(): IFileSystemWarning[] {
		return [...this.collectedWarnings];
	}

	async fileExists(filePath: string): Promise<boolean> {
		try {
			const stats = await stat(filePath);
			return stats.isFile() || stats.isDirectory();
		} catch {
			return false;
		}
	}

	async readFile(filePath: string): Promise<string> {
		return readFile(filePath, 'utf8');
	}

	async listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]> {
		const rootAbsolute = resolve(projectRoot);
		const normalizedRoot = normalizePath(rootAbsolute);
		const results: string[] = [];
		const stack: string[] = [rootAbsolute];

		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) {
				continue;
			}

			let entries;
			try {
				entries = await readdir(current, { withFileTypes: true });
			} catch (error) {
				this.collectedWarnings.push({
					code: 'unreadable-directory',
					filePath: normalizePath(current),
					message: `Directory could not be read: ${error instanceof Error ? error.message : 'unknown error'}`
				});
				continue;
			}

			for (const entry of entries) {
				const fullPath = resolve(current, entry.name);
				const normalizedFullPath = normalizePath(fullPath);
				const relativePath = normalizedFullPath.startsWith(`${normalizedRoot}/`)
					? normalizedFullPath.slice(normalizedRoot.length + 1)
					: normalizedFullPath;

				if (entry.isSymbolicLink()) {
					this.collectedWarnings.push({
						code: 'symlink-skipped',
						filePath: normalizedFullPath,
						message: 'Symbolic links are not followed during a scan.'
					});
					continue;
				}

				if (entry.isDirectory()) {
					if (matchesAny(normalizedFullPath, excludeGlobs) || matchesAny(relativePath, excludeGlobs)) {
						continue;
					}

					stack.push(fullPath);
					continue;
				}

				if (!entry.isFile()) {
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

				const stats = await stat(fullPath);
				if (stats.size > this.guardrails.maxFileSizeBytes) {
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
