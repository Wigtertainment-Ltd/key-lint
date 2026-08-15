import { inject, Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
	DEFAULT_SCANNER_CONFIG,
	IScannerConfig,
	IScannerConfigOverrides,
	inferLocaleFromTranslationFile,
	normalizePath,
	IProjectScanResult,
	readTranslationJson,
	runScan,
	setNestedTranslationKey,
	TranslationEventSource
} from '@key-lint/core';
import { ElectronService } from './electron.service';
import { ElectronFileSystemAdapter } from './electron-file-system.adapter';
import { ProjectHistoryService } from './project-history.service';
import { LoggerService } from './logging/logger.service';
import { DesktopScannerConfigService } from './desktop-scanner-config.service';

export type ScanExecutionState = 'idle' | 'running' | 'completed' | 'failed';

export interface ScanExecutionSnapshot {
	state: ScanExecutionState;
	stage?: string;
	error?: string;
	result?: IProjectScanResult;
}

@Injectable({
	providedIn: 'root'
})
export class ScanOrchestrationService {
	private readonly stateSubject = new BehaviorSubject<ScanExecutionSnapshot>({ state: 'idle' });
	readonly state$ = this.stateSubject.asObservable();

	private readonly fsAdapter: ElectronFileSystemAdapter;
	private readonly electronService: ElectronService = inject(ElectronService);
	private readonly projectHistoryService: ProjectHistoryService = inject(ProjectHistoryService);
	private readonly loggerService: LoggerService = inject(LoggerService);
	private readonly desktopScannerConfigService: DesktopScannerConfigService = inject(DesktopScannerConfigService);
	private activeScannerConfig: IScannerConfig = DEFAULT_SCANNER_CONFIG;
	private nextScanConfigOverrides: IScannerConfigOverrides = {};

	private withNormalizedSummary(result: IProjectScanResult): IProjectScanResult {
		const summaryWithOptionalIndirect = result.summary as IProjectScanResult['summary'] & {
			indirectUncertain?: number;
		};
		if (typeof summaryWithOptionalIndirect.indirectUncertain === 'number') {
			return result;
		}

		const indirectUncertain = result.findings.filter(
			(finding) => finding.status === 'indirect-uncertain'
		).length;

		return {
			...result,
			summary: {
				...result.summary,
				indirectUncertain
			}
		};
	}

	constructor() {
		this.fsAdapter = new ElectronFileSystemAdapter(this.electronService);
	}

	get snapshot(): ScanExecutionSnapshot {
		return this.stateSubject.getValue();
	}

	reset(): void {
		this.activeScannerConfig = DEFAULT_SCANNER_CONFIG;
		this.nextScanConfigOverrides = {};
		this.fsAdapter.configureGuardrails(DEFAULT_SCANNER_CONFIG.guardrails);
		this.stateSubject.next({ state: 'idle' });
	}

	setNextScanConfigOverrides(overrides: IScannerConfigOverrides): void {
		this.nextScanConfigOverrides = {
			...overrides,
			guardrails: overrides.guardrails ? { ...overrides.guardrails } : undefined
		};
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
		await this.electronService.writeFile(match, serialized);
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
			this.activeScannerConfig.includeTranslationGlobs,
			this.activeScannerConfig.excludeGlobs
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
		return readTranslationJson(this.fsAdapter, filePath);
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

		const resolvedFindingCount = existingResult.findings.filter(
			(finding) =>
				finding.status === 'missing-in-language' &&
				finding.key === key &&
				finding.language === locale
		).length;

		this.stateSubject.next({
			...snapshot,
			result: {
				...existingResult,
				findings: existingResult.findings.filter(
					(finding) =>
						!(
							finding.status === 'missing-in-language' &&
							finding.key === key &&
							finding.language === locale
						)
				),
				summary: {
					...existingResult.summary,
					missingInLanguage: Math.max(
						0,
						existingResult.summary.missingInLanguage - resolvedFindingCount
					),
					totalFindings: Math.max(
						0,
						existingResult.summary.totalFindings - resolvedFindingCount
					)
				},
				translationMatrix: {
					locales,
					rows: updatedRows,
					totalKeys: updatedRows.length
				}
			}
		});
	}

	async scanProject(projectRoot: string): Promise<IProjectScanResult> {
		this.loggerService.info('ScanOrchestrationService', 'Starting scan for project root:', projectRoot);
		const normalizedProjectRoot = normalizePath(projectRoot);
		this.projectHistoryService.addEvent({
			projectPath: normalizedProjectRoot,
			type: 'scan-started',
			payload: {
				requestedProjectRoot: normalizedProjectRoot
			}
		});

		this.stateSubject.next({ state: 'running', stage: 'Loading scanner configuration...' });

		try {
			const loadedConfig = await this.desktopScannerConfigService.load(
				normalizedProjectRoot,
				this.nextScanConfigOverrides
			);
			this.activeScannerConfig = loadedConfig.config;
			this.fsAdapter.configureGuardrails(loadedConfig.config.guardrails);
			const rawResult = await runScan({
				projectRoot: normalizedProjectRoot,
				fs: this.fsAdapter,
				config: loadedConfig.config,
				onProgress: (progress) => {
					if (progress.stage === 'completed') {
						return;
					}

			this.stateSubject.next({ state: 'running', stage: progress.message });
				}
			});

			const result = this.withNormalizedSummary({
				...rawResult,
				metadata: {
					...rawResult.metadata,
					configFilePath: loadedConfig.configFilePath ?? null,
					packageJsonConfigApplied: loadedConfig.packageJsonConfigApplied,
					guardrails: { ...loadedConfig.config.guardrails },
					guardrailSources: { ...loadedConfig.guardrailSources },
					fileSystemWarningCount: this.fsAdapter.warnings.length,
					fileSystemWarnings: this.fsAdapter.warnings
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
			this.activeScannerConfig = DEFAULT_SCANNER_CONFIG;
			this.fsAdapter.configureGuardrails(DEFAULT_SCANNER_CONFIG.guardrails);
			this.loggerService.error('ScanOrchestrationService', 'Scan failed for project root:', normalizedProjectRoot, error);
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
