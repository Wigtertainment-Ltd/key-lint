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
	let historyService: jasmine.SpyObj<ProjectHistoryService>;

	beforeEach(() => {
		writtenPath = undefined;
		writtenContent = undefined;
		const tree: Record<string, IFakeEntry[]> = {
			'C:/project': [{ name: 'src', type: 'directory' }],
			'C:/project/src': [{ name: 'assets', type: 'directory' }],
			'C:/project/src/assets': [{ name: 'i18n', type: 'directory' }],
			'C:/project/src/assets/i18n': [
				{ name: 'de.json', type: 'file' },
				{ name: 'en.json', type: 'file' }
			]
		};
		const contents: Record<string, string> = {
			'C:/project/src/assets/i18n/de.json': '{}',
			'C:/project/src/assets/i18n/en.json': '{"APP":{"TITLE":"Title"}}'
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
});
