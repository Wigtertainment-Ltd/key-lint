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
 * Recognizes normalized patterns beginning with a slash or a Windows drive prefix.
 *
 * @param pattern - Glob pattern to classify.
 * @returns Whether the pattern is matched against absolute rather than project-relative paths.
 */
function isAbsoluteGlob(pattern: string): boolean {
	const normalized = normalizePath(pattern);
	return normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
}

/**
 * Filesystem adapter for headless Node runtimes (CLI, CI).
 * Directory enumeration skips discovered symbolic links and applies file-count and size limits.
 * Direct existence checks and reads delegate to Node and do not apply enumeration guardrails.
 */
export class NodeFileSystemAdapter implements IFileSystemAdapter {
	private readonly collectedWarnings: IFileSystemWarning[] = [];

	/**
	 * Creates an adapter using the supplied limits for subsequent file enumerations.
	 *
	 * @param guardrails - Maximum result count and per-file byte size; defaults to scanner limits.
	 */
	constructor(private readonly guardrails: IScannerGuardrails = DEFAULT_SCANNER_CONFIG.guardrails) { }

	/**
	 * Returns accumulated enumeration warnings without exposing the internal array.
	 * Warning objects are shared, and warnings persist across calls on this adapter instance.
	 *
	 * @returns A shallow copy of warnings collected so far.
	 */
	get warnings(): IFileSystemWarning[] {
		return [...this.collectedWarnings];
	}

	/**
	 * Checks whether Node can stat a path as a regular file or directory.
	 * Symbolic links are followed by `stat`; any stat failure produces `false`.
	 *
	 * @param filePath - Filesystem path to inspect.
	 * @returns Whether the path resolves to a file or directory.
	 */
	async fileExists(filePath: string): Promise<boolean> {
		try {
			const stats = await stat(filePath);
			return stats.isFile() || stats.isDirectory();
		} catch {
			return false;
		}
	}

	/**
	 * Reads UTF-8 content through Node without enforcing enumeration size limits.
	 *
	 * @param filePath - Filesystem path to read.
	 * @returns The decoded file content.
	 * @throws {Error} When Node cannot read the file.
	 */
	async readFile(filePath: string): Promise<string> {
		return readFile(filePath, 'utf8');
	}

	/**
	 * Traverses the resolved project root and collects files matching include but not exclude globs.
	 * Absolute patterns match full paths; relative patterns match paths beneath the root.
	 * Skips discovered symlinks and oversized files, prunes excluded directories, and records warnings.
	 * Stops with partial results at the file-count limit; traversal order is not explicitly sorted.
	 *
	 * @param projectRoot - Root directory, resolved against the process working directory when relative.
	 * @param includeGlobs - Supported glob patterns selecting files; an empty list selects none.
	 * @param excludeGlobs - Patterns excluding files and directories from traversal.
	 * @returns Normalized absolute file paths within the configured enumeration limits.
	 * @throws {Error} When an included file cannot be statted; unreadable directories are warnings instead.
	 */
	async listFiles(projectRoot: string, includeGlobs: string[], excludeGlobs: string[]): Promise<string[]> {
		const rootAbsolute = resolve(projectRoot);
		const normalizedRoot = normalizePath(rootAbsolute);
		const absoluteIncludeGlobs = includeGlobs.filter(isAbsoluteGlob);
		const relativeIncludeGlobs = includeGlobs.filter((pattern) => !isAbsoluteGlob(pattern));
		const absoluteExcludeGlobs = excludeGlobs.filter(isAbsoluteGlob);
		const relativeExcludeGlobs = excludeGlobs.filter((pattern) => !isAbsoluteGlob(pattern));
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
					if (matchesAny(normalizedFullPath, absoluteExcludeGlobs) || matchesAny(relativePath, relativeExcludeGlobs)) {
						continue;
					}

					stack.push(fullPath);
					continue;
				}

				if (!entry.isFile()) {
					continue;
				}

				const included =
					matchesAny(normalizedFullPath, absoluteIncludeGlobs) || matchesAny(relativePath, relativeIncludeGlobs);
				const excluded =
					matchesAny(normalizedFullPath, absoluteExcludeGlobs) || matchesAny(relativePath, relativeExcludeGlobs);

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
