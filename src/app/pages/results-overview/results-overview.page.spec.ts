import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IProjectScanResult } from '@key-lint/core';
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

describe('ResultsOverviewPage placeholder findings', () => {
	let fixture: ComponentFixture<ResultsOverviewPage>;
	let component: ResultsOverviewPage;
	let state: BehaviorSubject<ScanExecutionSnapshot>;

	beforeEach(async () => {
		state = new BehaviorSubject<ScanExecutionSnapshot>({ state: 'completed', result });
		await TestBed.configureTestingModule({
			imports: [ResultsOverviewPage],
			providers: [
				provideRouter([]),
				{ provide: ScanOrchestrationService, useValue: { snapshot: state.value, state$: state.asObservable() } },
				{ provide: ToastService, useValue: { success: jasmine.createSpy('success') } },
				{ provide: LoggerService, useValue: { info: jasmine.createSpy('info') } }
			]
		}).compileComponents();
		fixture = TestBed.createComponent(ResultsOverviewPage);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('groups placeholder statuses and renders structured contract details', () => {
		expect(component.placeholderFilterCount).toBe(1);
		component.onFilterChange('placeholders');
		expect(component.filteredFindings.map((finding) => finding.id)).toEqual(['missing-params']);
		component.onSelectFinding(result.findings[1]);
		fixture.detectChanges();
		expect(component.statusLabel('placeholder-missing')).toBe('Missing Params');
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Placeholder Contract');
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Required: name');
	});

	it('disables translation writes and explains remote read-only results', async () => {
		const missingFinding = {
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
		component.onSelectFinding(component.findings.find((finding) => finding.id === missingFinding.id)!);
		fixture.detectChanges();

		expect(component.isRemoteReadOnly).toBeTrue();
		expect(component.canShowAddToTranslationsAction).toBeFalse();
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Remote translations are read-only.');
	});
});
