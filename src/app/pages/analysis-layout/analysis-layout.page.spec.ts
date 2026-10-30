import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IProjectScanResult } from '@key-lint/core';
import { BehaviorSubject } from 'rxjs';

import { ThemeService } from '../../services/theme.service';
import { AppVersionService } from '../../shared/services/app-version.service';
import {
	ScanExecutionSnapshot,
	ScanOrchestrationService
} from '../../shared/services/scan-orchestration.service';
import { AnalysisLayoutPage } from './analysis-layout.page';
import { ElectronService } from '../../shared/services/electron.service';

function scanResult(fileSystemWarnings: unknown[]): IProjectScanResult {
	return {
		projectRoot: 'C:/project',
		adapterId: 'angular',
		startedAt: '2026-08-15T07:59:59.000Z',
		finishedAt: '2026-08-15T08:00:00.000Z',
		durationMs: 1000,
		summary: {
			totalKeys: 0,
			used: 0,
			unused: 0,
			dynamicOrUncertain: 0,
			indirectUncertain: 0,
			missingInLanguage: 0,
			extraInLanguage: 0,
			totalFindings: 0
		},
		findings: [],
		errors: [],
		metadata: { fileSystemWarnings }
	};
}

describe('AnalysisLayoutPage app status bar', () => {
	let fixture: ComponentFixture<AnalysisLayoutPage>;
	let scanState: BehaviorSubject<ScanExecutionSnapshot>;
	let openSupportPage: jasmine.Spy;

	beforeEach(async () => {
		openSupportPage = jasmine.createSpy('openSupportPage').and.resolveTo(undefined);
		scanState = new BehaviorSubject<ScanExecutionSnapshot>({
			state: 'completed',
			result: scanResult([{
				code: 'file-too-large',
				filePath: 'C:/project/large.json',
				message: 'Skipped because it exceeds the configured size.'
			}])
		});

		await TestBed.configureTestingModule({
			imports: [AnalysisLayoutPage],
			providers: [
				provideRouter([]),
				{ provide: ElectronService, useValue: { isElectron: true, openSupportPage } },
				{
					provide: ScanOrchestrationService,
					useValue: {
						state$: scanState.asObservable(),
						reset: jasmine.createSpy('reset')
					}
				},
				{ provide: AppVersionService, useValue: { version: '1.2.0' } },
				{
					provide: ThemeService,
					useValue: { getCurrent: () => 'light', toggle: jasmine.createSpy('toggle') }
				}
			]
		}).compileComponents();

		fixture = TestBed.createComponent(AnalysisLayoutPage);
		fixture.detectChanges();
	});

	it('opens GitHub support through Electron instead of navigating the app', () => {
		const support = (fixture.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('.side-bottom a[href*="/issues"]');
		expect(support).not.toBeNull();
		if (!support) throw new Error('Support link was not rendered.');
		expect(support.href).toBe('https://github.com/Wigtertainment-Ltd/key-lint/issues');
		expect(support.title).toBe('Report a bug or request a feature on GitHub');
		expect(support.textContent).toContain('Support');
		expect(support.dispatchEvent(new MouseEvent('click', { cancelable: true }))).toBeFalse();
		expect(openSupportPage).toHaveBeenCalledOnceWith();
	});

	it('shows scan warnings above the routed page content', () => {
		const element = fixture.nativeElement as HTMLElement;
		const statusBar = element.querySelector('.app-status-bar');
		const content = element.querySelector('.content-shell');

		expect(statusBar).not.toBeNull();
		expect(statusBar?.textContent).toContain('Scan completed with 1 filesystem warning');
		expect(statusBar?.textContent).toContain('metrics and findings may be incomplete');
		if (!statusBar || !content) {
			throw new Error('Expected both the status bar and content shell to be rendered.');
		}
		expect(statusBar.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING)
			.toBeTruthy();
	});

	it('removes the global status bar when a result has no warnings', async () => {
		scanState.next({
			state: 'completed',
			result: scanResult([])
		});
		await fixture.whenStable();
		fixture.detectChanges();

		expect(fixture.componentInstance.fileSystemWarnings).toEqual([]);
		expect((fixture.nativeElement as HTMLElement).querySelector('.app-status-bar')).toBeNull();
	});
});
