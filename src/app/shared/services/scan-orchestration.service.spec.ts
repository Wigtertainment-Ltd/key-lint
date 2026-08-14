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
	let historyService: jasmine.SpyObj<ProjectHistoryService>;

	beforeEach(() => {
		writtenPath = undefined;
		writtenContent = undefined;
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
			fs: {
				readdirSync: (path: string) => (tree[path] ?? []).map((entry) => ({
					name: entry.name,
					isDirectory: () => entry.type === 'directory',
					isFile: () => entry.type === 'file'
				})),
				readFileSync: (path: string) => contents[path],
				writeFileSync: (path: string, content: string) => {
					writtenPath = path;
					writtenContent = content;
				},
				existsSync: (path: string) => path in tree || path in contents
			}
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
		).toBeRejectedWithError(/Invalid JSON in translation file/);

		expect(writtenPath).toBeUndefined();
		expect(writtenContent).toBeUndefined();
		expect(service.snapshot.result).toBe(result);
		expect(historyService.addEvent).not.toHaveBeenCalled();
	});
});
