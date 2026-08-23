import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { IProjectScanResult } from '@key-lint/core';

import { ElectronService } from './electron.service';
import { LoggerService } from './logging/logger.service';
import { ProjectHistoryService } from './project-history.service';
import { ScanExecutionSnapshot, ScanOrchestrationService } from './scan-orchestration.service';

interface IFakeEntry {
	name: string;
	type: 'directory' | 'file';
}

describe('ScanOrchestrationService translation updates', () => {
	let writtenPath: string | undefined;
	let writtenContent: string | undefined;
	let contents: Record<string, string>;
	let unreadablePaths: Set<string>;
	let historyService: jasmine.SpyObj<ProjectHistoryService>;
	let remoteRequestCount: number;
	let remoteRequests: IKeyLintTranslationFetchRequest[];

	beforeEach(() => {
		writtenPath = undefined;
		writtenContent = undefined;
		unreadablePaths = new Set<string>();
		remoteRequestCount = 0;
		remoteRequests = [];
		const tree: Record<string, IFakeEntry[]> = {
			'C:/project': [
				{ name: 'angular.json', type: 'file' },
				{ name: 'keylint.config.json', type: 'file' },
				{ name: 'src', type: 'directory' },
				{ name: 'translations', type: 'directory' }
			],
			'C:/project/src': [
				{ name: 'app.component.html', type: 'file' },
				{ name: 'assets', type: 'directory' }
			],
			'C:/project/src/assets': [{ name: 'i18n', type: 'directory' }],
			'C:/project/src/assets/i18n': [
				{ name: 'de.json', type: 'file' },
				{ name: 'en.json', type: 'file' }
			],
			'C:/project/translations': [
				{ name: 'de.json', type: 'file' },
				{ name: 'en.json', type: 'file' }
			]
		};
		contents = {
			'C:/project/angular.json': '{}',
			'C:/project/keylint.config.json': JSON.stringify({
				baseLocale: 'en',
				includeTranslationGlobs: ['translations/*.json'],
				includeSourceGlobs: ['src/*.html']
			}),
			'C:/project/src/app.component.html': "{{ 'APP.TITLE' | translate }}",
			'C:/project/src/assets/i18n/de.json': '{}',
			'C:/project/src/assets/i18n/en.json': '{"APP":{"TITLE":"Default title"}}',
			'C:/project/translations/de.json': '{}',
			'C:/project/translations/en.json': '{"APP":{"TITLE":"Configured title"}}'
		};
		const electronService = {
			isElectron: true,
			readDirectory: async (path: string) => {
				if (unreadablePaths.has(path)) {
					throw new Error('Access denied');
				}

				return (tree[path] ?? []).map((entry) => ({
					name: entry.name,
					isDirectory: entry.type === 'directory',
					isFile: entry.type === 'file',
					isSymbolicLink: false,
					sizeBytes: contents[`${path}/${entry.name}`]?.length
				}));
			},
			readFile: async (path: string) => contents[path],
			writeFile: async (path: string, content: string) => {
				writtenPath = path;
				writtenContent = content;
			},
			pathExists: async (path: string) => path in tree || path in contents,
			fetchTranslationResource: async (request: IKeyLintTranslationFetchRequest): Promise<IKeyLintTranslationFetchResult> => {
				remoteRequestCount += 1;
				remoteRequests.push(request);
				return {
					ok: true,
					value: {
						body: '{"APP":{"TITLE":"Remote title"}}',
						finalUrl: request.url
					}
				};
			},
			endTranslationScan: async (): Promise<IKeyLintTranslationEndResult> => ({ ok: true })
		} as unknown as ElectronService;
		historyService = jasmine.createSpyObj<ProjectHistoryService>('ProjectHistoryService', ['addEvent']);

		TestBed.configureTestingModule({
			providers: [
				ScanOrchestrationService,
				{ provide: ElectronService, useValue: electronService },
				{ provide: ProjectHistoryService, useValue: historyService },
				{ provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['info', 'error']) }
			]
		});
	});

	it('uses project config for both scanning and later translation writes', async () => {
		const service = TestBed.inject(ScanOrchestrationService);

		const result = await service.scanProject('C:/project');

		expect(result.metadata?.['configFilePath']).toBe('C:/project/keylint.config.json');
		expect(result.metadata?.['packageJsonConfigApplied']).toBeFalse();
		expect(result.metadata?.['translationFileCount']).toBe(2);
		expect(result.metadata?.['fileSystemWarningCount']).toBe(0);
		expect(result.metadata?.['fileSystemWarnings']).toEqual([]);
		expect(result.translationMatrix?.rows[0].values['en']).toBe('Configured title');
		expect(result.findings).toContain(jasmine.objectContaining({
			id: 'missing:APP.TITLE:de',
			language: 'de'
		}));

		await service.addTranslationKeyForLocale('de', 'APP.TITLE', 'Konfigurierter Titel');

		expect(writtenPath).toBe('C:/project/translations/de.json');
		expect(JSON.parse(writtenContent ?? '{}')).toEqual({
			APP: { TITLE: 'Konfigurierter Titel' }
		});
	});

	it('requires per-scan confirmation before a remote-only request', async () => {
		contents['C:/project/keylint.config.json'] = JSON.stringify({
			translationSources: [{
				type: 'http', id: 'api', urlTemplate: 'https://example.com/{locale}.json', locales: ['en']
			}],
			includeSourceGlobs: ['src/*.html']
		});
		const service = TestBed.inject(ScanOrchestrationService);

		await expectAsync(service.scanProject('C:/project')).toBeRejectedWithError(/was not confirmed/);
		expect(remoteRequestCount).toBe(0);
	});

	it('analyzes remote-only translations and clears authorization after completion', async () => {
		contents['C:/project/keylint.config.json'] = JSON.stringify({
			translationSources: [{
				type: 'http', id: 'api', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'],
				headersFromEnv: { Authorization: 'KEYLINT_AUTH' }
			}],
			includeSourceGlobs: ['src/*.html']
		});
		const service = TestBed.inject(ScanOrchestrationService);
		service.authorizeNextRemoteScan({ KEYLINT_AUTH: 'Bearer temporary-secret' });

		const result = await service.scanProject('C:/project');

		expect(remoteRequestCount).toBe(1);
		expect(remoteRequests[0].headers).toEqual({ Authorization: 'Bearer temporary-secret' });
		expect(result.metadata?.['translationReadOnly']).toBeTrue();
		expect(result.metadata?.['translationFileCount']).toBe(0);
		expect(result.translationMatrix?.rows.find((row) => row.key === 'APP.TITLE')?.values['en']).toBe('Remote title');
		expect(JSON.stringify(result)).not.toContain('temporary-secret');
		expect(JSON.stringify(historyService.addEvent.calls.allArgs())).not.toContain('temporary-secret');
		await expectAsync(service.addTranslationKeyForLocale('en', 'APP.NEW', 'New'))
			.toBeRejectedWithError('Remote translations are read-only.');

		await expectAsync(service.scanProject('C:/project')).toBeRejectedWithError(/was not confirmed/);
		expect(remoteRequestCount).toBe(1);
	});

	it('preserves configured mixed-source override order', async () => {
		contents['C:/project/keylint.config.json'] = JSON.stringify({
			translationSources: [
				{ type: 'filesystem', id: 'base', includeGlobs: ['translations/*.json'] },
				{ type: 'http', id: 'remote', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'] }
			],
			includeSourceGlobs: ['src/*.html']
		});
		const service = TestBed.inject(ScanOrchestrationService);
		service.authorizeNextRemoteScan({});

		const result = await service.scanProject('C:/project');

		expect(result.translationMatrix?.rows.find((row) => row.key === 'APP.TITLE')?.values['en']).toBe('Remote title');
		expect(result.metadata?.['translationReadOnly']).toBeTrue();
	});

	it('clears pending remote authorization on reset', async () => {
		contents['C:/project/keylint.config.json'] = JSON.stringify({
			translationSources: [{
				type: 'http', id: 'api', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'],
				headersFromEnv: { Authorization: 'KEYLINT_AUTH' }
			}]
		});
		const service = TestBed.inject(ScanOrchestrationService);
		service.authorizeNextRemoteScan({ KEYLINT_AUTH: 'Bearer reset-secret' });
		service.reset();

		await expectAsync(service.scanProject('C:/project')).toBeRejectedWithError(/was not confirmed/);
		expect(remoteRequestCount).toBe(0);
	});

	it('keeps scanning and exposes filesystem guardrail warnings in metadata', async () => {
		unreadablePaths.add('C:/project/src/assets');
		const service = TestBed.inject(ScanOrchestrationService);

		const result = await service.scanProject('C:/project');
		const warnings = result.metadata?.['fileSystemWarnings'] as Array<{
			code: string;
			filePath?: string;
		}>;

		expect(result.metadata?.['fileSystemWarningCount']).toBeGreaterThan(0);
		expect(warnings).toContain(jasmine.objectContaining({
			code: 'unreadable-directory',
			filePath: 'C:/project/src/assets'
		}));
	});

	it('applies guardrails loaded from the desktop project configuration', async () => {
		contents['C:/project/keylint.config.json'] = JSON.stringify({
			includeTranslationGlobs: ['translations/*.json'],
			includeSourceGlobs: ['src/*.html'],
			guardrails: {
				maxFiles: 1,
				maxFileSizeBytes: 2_097_152
			}
		});
		const service = TestBed.inject(ScanOrchestrationService);

		const result = await service.scanProject('C:/project');
		const warnings = result.metadata?.['fileSystemWarnings'] as Array<{ code: string }>;

		expect(result.metadata?.['translationFileCount']).toBe(1);
		expect(warnings).toContain(jasmine.objectContaining({ code: 'max-files-reached' }));
	});

	it('applies temporary desktop overrides and records their effective source', async () => {
		const service = TestBed.inject(ScanOrchestrationService);
		service.setNextScanConfigOverrides({
			guardrails: { maxFiles: 50, maxFileSizeBytes: 1_048_576 }
		});

		const result = await service.scanProject('C:/project');

		expect(result.metadata?.['guardrails']).toEqual({
			maxFiles: 50,
			maxFileSizeBytes: 1_048_576
		});
		expect(result.metadata?.['guardrailSources']).toEqual({
			maxFiles: 'override',
			maxFileSizeBytes: 'override'
		});
	});

	it('writes nested JSON and resolves only the matching locale finding', async () => {
		const service = TestBed.inject(ScanOrchestrationService);
		const result: IProjectScanResult = {
			projectRoot: 'C:/project',
			adapterId: 'angular',
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:01.000Z',
			durationMs: 1000,
			summary: {
				totalKeys: 1,
				used: 0,
				unused: 0,
				dynamicOrUncertain: 0,
				indirectUncertain: 0,
				missingInLanguage: 2,
				extraInLanguage: 0,
				totalFindings: 2
			},
			errors: [],
			findings: [
				{
					id: 'missing:APP.TITLE:de',
					adapterId: 'angular',
					key: 'APP.TITLE',
					status: 'missing-in-language',
					severity: 'error',
					language: 'de',
					message: 'Missing in de',
					evidence: []
				},
				{
					id: 'missing:APP.TITLE:fr',
					adapterId: 'angular',
					key: 'APP.TITLE',
					status: 'missing-in-language',
					severity: 'error',
					language: 'fr',
					message: 'Missing in fr',
					evidence: []
				}
			],
			translationMatrix: {
				locales: ['de', 'en', 'fr'],
				totalKeys: 1,
				rows: [{
					key: 'APP.TITLE',
					values: { de: '', en: 'Title', fr: '' },
					keyPresence: { de: false, en: true, fr: false }
				}]
			}
		};
		const internal = service as unknown as {
			stateSubject: BehaviorSubject<ScanExecutionSnapshot>;
		};
		internal.stateSubject.next({ state: 'completed', result });

		const filePath = await service.addTranslationKeyForLocale(
			'de',
			'APP.TITLE',
			'Titel',
			'results-overview'
		);

		expect(filePath).toBe('C:/project/src/assets/i18n/de.json');
		expect(writtenPath).toBe(filePath);
		expect(JSON.parse(writtenContent ?? '{}')).toEqual({ APP: { TITLE: 'Titel' } });
		expect(service.snapshot.result?.findings.map((finding) => finding.id)).toEqual([
			'missing:APP.TITLE:fr'
		]);
		expect(service.snapshot.result?.summary.missingInLanguage).toBe(1);
		expect(service.snapshot.result?.summary.totalFindings).toBe(1);
		expect(service.snapshot.result?.translationMatrix?.rows[0].values['de']).toBe('Titel');
		expect(service.snapshot.result?.translationMatrix?.rows[0].keyPresence?.['de']).toBeTrue();
		expect(historyService.addEvent).toHaveBeenCalledWith(jasmine.objectContaining({
			projectPath: 'C:/project',
			type: 'translation-key-added',
			payload: jasmine.objectContaining({ locale: 'de', key: 'APP.TITLE' })
		}));
	});

	it('fails the scan and exposes the file error when translation JSON is invalid', async () => {
		contents['C:/project/translations/de.json'] = '{"APP":';
		const service = TestBed.inject(ScanOrchestrationService);

		// Match the complete invalid translation path while escaping regex-significant slashes and dots.
		await expectAsync(service.scanProject('C:/project')).toBeRejectedWithError(
			/Invalid JSON in translation file "C:\/project\/translations\/de\.json"/
		);
		expect(service.snapshot.state).toBe('failed');
		expect(service.snapshot.result).toBeUndefined();
		expect(service.snapshot.error).toContain('C:/project/translations/de.json');
	});

	it('never overwrites invalid translation JSON while adding a key', async () => {
		const service = TestBed.inject(ScanOrchestrationService);
		const result: IProjectScanResult = {
			projectRoot: 'C:/project',
			adapterId: 'angular',
			startedAt: '2026-01-01T00:00:00.000Z',
			finishedAt: '2026-01-01T00:00:01.000Z',
			durationMs: 1000,
			summary: {
				totalKeys: 1,
				used: 0,
				unused: 0,
				dynamicOrUncertain: 0,
				indirectUncertain: 0,
				missingInLanguage: 1,
				extraInLanguage: 0,
				totalFindings: 1
			},
			errors: [],
			findings: [{
				id: 'missing:APP.TITLE:de',
				adapterId: 'angular',
				key: 'APP.TITLE',
				status: 'missing-in-language',
				severity: 'error',
				language: 'de',
				message: 'Missing in de',
				evidence: []
			}],
			translationMatrix: {
				locales: ['de', 'en'],
				totalKeys: 1,
				rows: [{
					key: 'APP.TITLE',
					values: { de: '', en: 'Title' },
					keyPresence: { de: false, en: true }
				}]
			}
		};
		const internal = service as unknown as {
			stateSubject: BehaviorSubject<ScanExecutionSnapshot>;
		};
		internal.stateSubject.next({ state: 'completed', result });
		contents['C:/project/src/assets/i18n/de.json'] = '{"APP":';

		await expectAsync(
			service.addTranslationKeyForLocale('de', 'APP.TITLE', 'Titel')
		// Match the stable error prefix without coupling the test to the full file path.
		).toBeRejectedWithError(/Invalid JSON in translation file/);

		expect(writtenPath).toBeUndefined();
		expect(writtenContent).toBeUndefined();
		expect(service.snapshot.result).toBe(result);
		expect(historyService.addEvent).not.toHaveBeenCalled();
	});
});
