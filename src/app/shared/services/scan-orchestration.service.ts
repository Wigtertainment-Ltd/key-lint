import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
	DEFAULT_SCANNER_CONFIG,
	FileSystemAdapter,
	inferLocaleFromTranslationFile,
	normalizePath,
	ProjectScanResult,
	runScan,
	setNestedTranslationKey,
	TranslationEventSource
} from '@check-i18n/core';
import { ElectronService } from './electron.service';
import { ElectronFileSystemAdapter } from './electron-file-system.adapter';
import { ProjectHistoryService } from './project-history.service';

export type ScanExecutionState = 'idle' | 'running' | 'completed' | 'failed';

export interface ScanExecutionSnapshot {
	state: ScanExecutionState;
	stage?: string;
	error?: string;
	result?: ProjectScanResult;
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
			const result = await runScan({
				projectRoot: normalizedProjectRoot,
				fs: this.fsAdapter,
				config: DEFAULT_SCANNER_CONFIG,
				onProgress: (progress) => {
					if (progress.stage === 'completed') {
						return;
					}

					this.stateSubject.next({ state: 'running', stage: progress.message });
				}
			});

			this.stateSubject.next({
				state: 'completed',
				stage: 'Scan completed.',
				result
			});
			this.projectHistoryService.addEvent({
				projectPath: result.projectRoot,
				type: 'scan-completed',
				payload: {
					adapterId: result.adapterId,
					durationMs: result.durationMs,
					totalFindings: result.summary.totalFindings,
					totalKeys: result.summary.totalKeys,
					localeCount: result.translationMatrix?.locales.length ?? 0,
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
