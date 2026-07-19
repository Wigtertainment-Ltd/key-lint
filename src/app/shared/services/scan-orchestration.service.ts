import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { defaultAdapterRegistry } from '../../adapters/default-adapter-registry';
import { FileSystemAdapter, ProjectContext } from '../../core/adapters/scan-adapter.interface';
import { DEFAULT_SCANNER_CONFIG } from '../../core/config/scanner-defaults';
import { buildSummary, ProjectScanResult } from '../../core/models/scan-result.model';
import { ElectronService } from './electron.service';
import { TranslationEventSource } from '../../core/models/history-event.model';
import { ProjectHistoryService } from './project-history.service';

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

function inferLocaleFromTranslationFile(filePath: string): string {
	const normalized = normalizePath(filePath);
	const fileName = normalized.split('/').at(-1) ?? normalized;
	const withoutExtension = fileName.replace(/\.[^.]+$/, '');
	const dottedParts = withoutExtension.split('.').filter(Boolean);

	if (dottedParts.length > 1) {
		return dottedParts.at(-1) ?? withoutExtension;
	}

	return withoutExtension;
}

function setNestedTranslationKey(target: Record<string, unknown>, key: string, value: string): void {
	const segments = key.split('.').map((segment) => segment.trim()).filter(Boolean);
	if (!segments.length) {
		return;
	}

	let cursor: Record<string, unknown> = target;
	for (let i = 0; i < segments.length - 1; i += 1) {
		const segment = segments[i];
		const current = cursor[segment];
		if (current === null || typeof current !== 'object' || Array.isArray(current)) {
			cursor[segment] = {};
		}

		cursor = cursor[segment] as Record<string, unknown>;
	}

	cursor[segments.at(-1) as string] = value;
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

	constructor(
		private readonly electronService: ElectronService,
		private readonly projectHistoryService: ProjectHistoryService
	) {
		this.fsAdapter = new ElectronFileSystemAdapter(electronService);
	}

	get snapshot(): ScanExecutionSnapshot {
		return this.stateSubject.getValue();
	}

	reset(): void {
		this.stateSubject.next({ state: 'idle' });
	}

	async addTranslationKeyForLocale(
		locale: string,
		key: string,
		value: string,
		source: TranslationEventSource = 'unknown'
	): Promise<string> {
		if (!this.electronService.isElectron) {
			throw new Error('Adding translation keys requires the Electron app runtime.');
		}

		const currentResult = this.snapshot.result;
		if (!currentResult) {
			throw new Error('No scan result available. Run a scan before adding translation keys.');
		}

		const projectRoot = normalizePath(currentResult.projectRoot);
		const match = await this.resolveLocaleTranslationFile(projectRoot, locale);
		const parsed = await this.readTranslationJson(match);
		setNestedTranslationKey(parsed, key, value);
		const serialized = `${JSON.stringify(parsed, null, 2)}\n`;
		this.electronService.fs.writeFileSync(match, serialized, 'utf8');
		this.updateMatrixWithAddedKey(locale, key, value);
		this.projectHistoryService.addEvent({
			projectPath: projectRoot,
			type: 'translation-key-added',
			payload: {
				locale,
				key,
				filePath: match,
				valueWasEmpty: value.trim().length === 0,
				source
			}
		});

		return match;
	}

	private async resolveLocaleTranslationFile(projectRoot: string, locale: string): Promise<string> {
		const translationFiles = await this.fsAdapter.listFiles(
			projectRoot,
			DEFAULT_SCANNER_CONFIG.includeTranslationGlobs,
			DEFAULT_SCANNER_CONFIG.excludeGlobs
		);

		const normalizedLocale = locale.trim().toLowerCase();
		const match = translationFiles
			.map((filePath) => normalizePath(filePath))
			.sort((a, b) => a.localeCompare(b))
			.find((filePath) => inferLocaleFromTranslationFile(filePath).toLowerCase() === normalizedLocale);

		if (!match) {
			throw new Error(`No translation file found for locale "${locale}".`);
		}

		return match;
	}

	private async readTranslationJson(filePath: string): Promise<Record<string, unknown>> {
		try {
			const raw = await this.fsAdapter.readFile(filePath);
			const loaded = JSON.parse(raw) as unknown;
			if (loaded !== null && typeof loaded === 'object' && !Array.isArray(loaded)) {
				return loaded as Record<string, unknown>;
			}
		} catch {
			// Fall through to create an empty JSON object.
		}

		return {};
	}

	private updateMatrixWithAddedKey(locale: string, key: string, value: string): void {
		const snapshot = this.snapshot;
		const existingResult = snapshot.result;
		const existingMatrix = existingResult?.translationMatrix;
		if (!existingResult || !existingMatrix) {
			return;
		}

		const locales = [...existingMatrix.locales];
		if (!locales.includes(locale)) {
			locales.push(locale);
			locales.sort((a, b) => a.localeCompare(b));
		}

		const updatedRows = [
			...existingMatrix.rows.map((row) => ({
				...row,
				values: { ...row.values },
				keyPresence: row.keyPresence ? { ...row.keyPresence } : undefined
			}))
		];
		const row = updatedRows.find((entry) => entry.key === key);

		if (row) {
			row.values[locale] = value;
			row.keyPresence = row.keyPresence ? { ...row.keyPresence, [locale]: true } : { [locale]: true };
		} else {
			const values: Record<string, string> = {};
			const keyPresence: Record<string, boolean> = {};
			for (const localeName of locales) {
				values[localeName] = '';
				keyPresence[localeName] = false;
			}
			values[locale] = value;
			keyPresence[locale] = true;

			updatedRows.push({ key, values, keyPresence });
			updatedRows.sort((a, b) => a.key.localeCompare(b.key));
		}

		this.stateSubject.next({
			...snapshot,
			result: {
				...existingResult,
				translationMatrix: {
					locales,
					rows: updatedRows,
					totalKeys: updatedRows.length
				}
			}
		});
	}

	async scanProject(projectRoot: string): Promise<ProjectScanResult> {
		const startedAt = new Date();
		const normalizedProjectRoot = normalizePath(projectRoot);
		this.projectHistoryService.addEvent({
			projectPath: normalizedProjectRoot,
			type: 'scan-started',
			payload: {
				requestedProjectRoot: normalizedProjectRoot
			}
		});

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

			this.stateSubject.next({ state: 'running', stage: 'Building translation matrix...' });
			const translationMatrix = adapter.buildTranslationMatrix
				? await adapter.buildTranslationMatrix(translationFiles, this.fsAdapter)
				: {
					locales: [],
					rows: [],
					totalKeys: 0
				};

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
				translationMatrix,
				metadata: {
					selectedProjectRoot: normalizedProjectRoot,
					adapterDetectionReason: adapterMatch.detection.reason,
					adapterDetectionConfidence: adapterMatch.detection.confidence,
					translationFileCount: translationFiles.length,
					usedKeyEvidenceCount: usedKeys.length,
					translationLocaleCount: translationMatrix.locales.length
				}
			};

			this.stateSubject.next({
				state: 'completed',
				stage: 'Scan completed.',
				result
			});
			this.projectHistoryService.addEvent({
				projectPath: resolvedProjectRoot,
				type: 'scan-completed',
				payload: {
					adapterId: adapter.id,
					durationMs: result.durationMs,
					totalFindings: result.summary.totalFindings,
					totalKeys: result.summary.totalKeys,
					localeCount: result.translationMatrix.locales.length,
					usedCount: result.summary.used,
					missingCount: result.summary.missingInLanguage,
					unusedCount: result.summary.unused,
					dynamicCount: result.summary.dynamicOrUncertain,
					extraCount: result.summary.extraInLanguage
				}
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
