import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IProjectScanResult, IFinding } from '@key-lint/core';
import { BehaviorSubject } from 'rxjs';

import { LoggerService } from '../../shared/services/logging/logger.service';
import { ScanExecutionSnapshot, ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { ToastService } from '../../shared/services/toast.service';
import { ResultsOverviewPage } from './results-overview.page';

const result: IProjectScanResult = {
	projectRoot: 'C:/project',
	adapterId: 'angular',
	startedAt: '',
	finishedAt: '',
	durationMs: 1,
	summary: {
		totalKeys: 1,
		used: 1,
		unused: 0,
		dynamicOrUncertain: 0,
		indirectUncertain: 0,
		missingInLanguage: 0,
		extraInLanguage: 0,
		placeholderMissing: 1,
		placeholderUncertain: 0,
		placeholderMismatch: 0,
		totalFindings: 2
	},
	findings: [
		{ id: 'used', adapterId: 'angular', key: 'APP.GREETING', status: 'used', severity: 'info', message: 'Used', evidence: [] },
		{
			id: 'missing-params',
			adapterId: 'angular',
			key: 'APP.GREETING',
			status: 'placeholder-missing',
			severity: 'error',
			message: 'Missing name',
			evidence: [{ filePath: 'C:/project/app.ts', line: 4 }],
			placeholderDetails: { required: ['name'], provided: [], missing: ['name'] }
		}
	],
	errors: []
};

describe('ResultsOverviewPage placeholder findings', (): void => {
	let fixture: ComponentFixture<ResultsOverviewPage>;
	let component: ResultsOverviewPage;
	let state: BehaviorSubject<ScanExecutionSnapshot>;
	let writeTranslation: jasmine.Spy<ScanOrchestrationService['addTranslationKeyForLocale']>;

	beforeEach(async (): Promise<void> => {
		state = new BehaviorSubject<ScanExecutionSnapshot>({ state: 'completed', result });
		writeTranslation = jasmine.createSpy<ScanOrchestrationService['addTranslationKeyForLocale']>('addTranslationKeyForLocale');
		await TestBed.configureTestingModule({
			imports: [ResultsOverviewPage],
			providers: [
				provideRouter([]),
				{
					provide: ScanOrchestrationService,
					useValue: { snapshot: state.value, state$: state.asObservable(), addTranslationKeyForLocale: writeTranslation }
				},
				{ provide: ToastService, useValue: { success: jasmine.createSpy('success') } },
				{ provide: LoggerService, useValue: { info: jasmine.createSpy('info') } }
			]
		}).compileComponents();
		fixture = TestBed.createComponent(ResultsOverviewPage);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('groups placeholder statuses and renders structured contract details', (): void => {
		expect(component.placeholderFilterCount).toBe(1);
		component.onFilterChange('placeholders');
		expect(component.filteredFindings.map((finding: IFinding): string => finding.id)).toEqual(['missing-params']);
		component.onSelectFinding(result.findings[1]);
		fixture.detectChanges();
		expect(component.statusLabel('placeholder-missing')).toBe('Missing Params');
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Placeholder Contract');
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Required: name');
	});

	it('disables translation writes and explains remote read-only results', async (): Promise<void> => {
		const missingFinding: IFinding = {
			id: 'missing-remote',
			adapterId: 'angular',
			key: 'APP.REMOTE',
			status: 'missing-in-language' as const,
			severity: 'error' as const,
			language: 'de',
			message: 'Missing',
			evidence: []
		};
		state.next({
			state: 'completed',
			result: {
				...result,
				findings: [...result.findings, missingFinding],
				metadata: { translationReadOnly: true }
			}
		});
		fixture.detectChanges();
		await fixture.whenStable();
		component.onSelectFinding(component.findings.find((finding: IFinding): boolean => finding.id === missingFinding.id)!);
		fixture.detectChanges();

		expect(component.isRemoteReadOnly).toBeTrue();
		expect(component.canShowAddToTranslationsAction).toBeFalse();
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Remote translations are read-only.');
	});

	it('keeps the original key and retries only the remaining locale after a partial write', async (): Promise<void> => {
		const missingFinding: IFinding = { id: 'missing', adapterId: 'angular', key: 'APP.MISSING', status: 'missing-in-language', severity: 'error', message: 'Missing', evidence: [] };
		state.next({ state: 'completed', result: { ...result, findings: [missingFinding, ...result.findings], translationMatrix: { locales: ['de', 'fr'], rows: [], totalKeys: 0 } } });
		fixture.detectChanges();
		await fixture.whenStable();
		component.onSelectFinding(missingFinding);
		component.openAddTranslationModal();
		component.onTranslationDraftChange('de', 'Hallo');
		component.onTranslationDraftChange('fr', 'Bonjour');
		writeTranslation.and.callFake((locale: string): Promise<string> => locale === 'de' ? Promise.resolve('de.json') : Promise.reject(new Error('Write failed')));

		const firstSave: Promise<void> = component.addSelectedKeyToTranslationFiles();
		await component.addSelectedKeyToTranslationFiles();
		await firstSave;
		expect(component.addTranslationsError).toContain('Saved to de. Could not save fr.');
		expect(component.translationTarget?.locales).toEqual(['fr']);

		component.onSelectFinding(result.findings[0]);
		writeTranslation.and.resolveTo('fr.json');
		await component.addSelectedKeyToTranslationFiles();
		expect(writeTranslation.calls.allArgs()).toEqual([
			['de', 'APP.MISSING', 'Hallo', 'results-overview'],
			['fr', 'APP.MISSING', 'Bonjour', 'results-overview'],
			['fr', 'APP.MISSING', 'Bonjour', 'results-overview']
		]);
		expect(component.isAddTranslationModalOpen).toBeFalse();
	});
});
