import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { ScanExecutionSnapshot, ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { LoggerService } from '../../shared/services/logging/logger.service';
import { ScanProgressPage } from './scan-progress.page';

describe('ScanProgressPage scan diagnostics', () => {
	let fixture: ComponentFixture<ScanProgressPage>;
	let state: BehaviorSubject<ScanExecutionSnapshot>;

	beforeEach(async () => {
		state = new BehaviorSubject<ScanExecutionSnapshot>({ state: 'running', stage: 'Loading scanner configuration...' });
		await TestBed.configureTestingModule({
			imports: [ScanProgressPage],
			providers: [
				provideRouter([]),
				{ provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ projectPath: 'C:/project' }) } } },
				{ provide: LoggerService, useValue: { info: jasmine.createSpy('info') } },
				{
					provide: ScanOrchestrationService,
					useValue: {
						state$: state.asObservable(),
						snapshot: state.value,
						scanProject: jasmine.createSpy('scanProject').and.resolveTo(undefined)
					}
				}
			]
		}).compileComponents();
		fixture = TestBed.createComponent(ScanProgressPage);
		fixture.detectChanges();
	});

	it('does not invent file paths or findings while a scan is waiting', () => {
		const logs = [...fixture.componentInstance.logLines()];
		jasmine.clock().install();
		try {
			// Start a fresh page while timers are controlled, including any scheduled filler logs.
			const second = TestBed.createComponent(ScanProgressPage);
			second.detectChanges();
			jasmine.clock().tick(10000);
			expect(second.componentInstance.logLines()).toEqual(logs);
			second.destroy();
		} finally {
			jasmine.clock().uninstall();
		}
	});

	it('keeps every real scan stage in order even when stages finish before the next render', () => {
		const page = fixture.componentInstance;
		const stages = [
			'Detecting project adapter...',
			'Collecting translation files...',
			'Extracting translation keys...',
			'Building translation matrix...',
			'Scanning source key usage...',
			'Evaluating scan rules...'
		];
		for (const stage of stages) state.next({ state: 'running', stage });
		fixture.detectChanges();
		const logged = page.logLines();
		for (const stage of stages) {
			expect(logged.some((line) => line.endsWith(stage))).toBeTrue();
		}
		expect(logged.filter((line) => line.includes('Step ')).map((line) => line.slice(line.indexOf('Step ')))).toEqual(
			page.steps.map((step) => `Step ${step.id}/6: ${step.title}`)
		);
	});
});
