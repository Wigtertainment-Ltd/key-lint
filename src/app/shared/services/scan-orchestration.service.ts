import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { defaultAdapterRegistry } from '../../adapters/default-adapter-registry';
import { FileSystemAdapter, ProjectContext } from '../../core/adapters/scan-adapter.interface';
import { DEFAULT_SCANNER_CONFIG } from '../../core/config/scanner-defaults';
import { buildSummary, ProjectScanResult } from '../../core/models/scan-result.model';
import { ElectronService } from './electron.service';

export type ScanExecutionState = 'idle' | 'running' | 'completed' | 'failed';

export interface ScanExecutionSnapshot {
	state: ScanExecutionState;
	stage?: string;
	error?: string;
	result?: ProjectScanResult;
}

function normalizePath(value: string): string {
	return value.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function escapeRegex(text: string): string {
	return text.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegex(glob: string): RegExp {
	const normalized = normalizePath(glob);
	const escaped = escapeRegex(normalized)
		.replace(/\*\*\//g, '__DOUBLE_STAR_SLASH__')
		.replace(/\*\*/g, '__DOUBLE_STAR__')
		.replace(/\*/g, '[^/]*')
		.replace(/__DOUBLE_STAR_SLASH__/g, '(?:.*/)?')
		.replace(/__DOUBLE_STAR__/g, '.*');

	return new RegExp(`^${escaped}$`);
}

function matchesAny(path: string, patterns: string[]): boolean {
	if (patterns.length === 0) {
		return false;
	}

	return patterns.some((pattern) => globToRegex(pattern).test(path));
}

class ElectronFileSystemAdapter implements FileSystemAdapter {
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

@Injectable({
	providedIn: 'root'
})
export class ScanOrchestrationService {
	private readonly stateSubject = new BehaviorSubject<ScanExecutionSnapshot>({ state: 'idle' });
	readonly state$ = this.stateSubject.asObservable();

	private readonly fsAdapter: FileSystemAdapter;

	constructor(private readonly electronService: ElectronService) {
		this.fsAdapter = new ElectronFileSystemAdapter(electronService);
	}

	get snapshot(): ScanExecutionSnapshot {
		return this.stateSubject.getValue();
	}

	reset(): void {
		this.stateSubject.next({ state: 'idle' });
	}

	async scanProject(projectRoot: string): Promise<ProjectScanResult> {
		const startedAt = new Date();
		const normalizedProjectRoot = normalizePath(projectRoot);

		this.stateSubject.next({
			state: 'running',
			stage: 'Detecting project adapter...'
		});

		try {
			const adapterMatch = await defaultAdapterRegistry.detectBestAdapter(normalizedProjectRoot, this.fsAdapter);
			if (!adapterMatch) {
				throw new Error('No supported project adapter found for the selected directory.');
			}

			const resolvedProjectRoot = normalizePath(
				adapterMatch.detection.resolvedProjectRoot ?? normalizedProjectRoot
			);
			const adapter = adapterMatch.adapter;

			const context: ProjectContext = {
				projectRoot: resolvedProjectRoot,
				config: DEFAULT_SCANNER_CONFIG
			};

			this.stateSubject.next({ state: 'running', stage: 'Collecting translation files...' });
			const translationFiles = await adapter.collectTranslationFiles(context, this.fsAdapter);

			this.stateSubject.next({ state: 'running', stage: 'Extracting translation keys...' });
			const definedKeys = await adapter.extractDefinedKeys(translationFiles, this.fsAdapter);

			this.stateSubject.next({ state: 'running', stage: 'Scanning source key usage...' });
			const usedKeys = await adapter.extractUsedKeys(context, this.fsAdapter);

			this.stateSubject.next({ state: 'running', stage: 'Evaluating scan rules...' });
			const findings = await adapter.runRules({
				definedKeys,
				usedKeys,
				context
			});

			const finishedAt = new Date();
			const result: ProjectScanResult = {
				projectRoot: resolvedProjectRoot,
				adapterId: adapter.id,
				startedAt: startedAt.toISOString(),
				finishedAt: finishedAt.toISOString(),
				durationMs: finishedAt.getTime() - startedAt.getTime(),
				summary: buildSummary(findings, definedKeys.length),
				findings,
				errors: [],
				metadata: {
					selectedProjectRoot: normalizedProjectRoot,
					adapterDetectionReason: adapterMatch.detection.reason,
					adapterDetectionConfidence: adapterMatch.detection.confidence,
					translationFileCount: translationFiles.length,
					usedKeyEvidenceCount: usedKeys.length
				}
			};

			this.stateSubject.next({
				state: 'completed',
				stage: 'Scan completed.',
				result
			});

			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown scan error';
			this.stateSubject.next({
				state: 'failed',
				stage: 'Scan failed.',
				error: message
			});
			throw error;
		}
	}
}
