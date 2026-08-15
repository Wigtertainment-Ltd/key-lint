import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { DEFAULT_SCANNER_CONFIG } from '@key-lint/core';

import { ThemeService } from '../../services/theme.service';
import { AppVersionService } from '../../shared/services/app-version.service';
import { DesktopScannerConfigService } from '../../shared/services/desktop-scanner-config.service';
import { ElectronService } from '../../shared/services/electron.service';
import { LoggerService } from '../../shared/services/logging/logger.service';
import { RecentProjectsService } from '../../shared/services/recent-projects.service';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { ProjectSelectionPage } from './project-selection.page';

describe('ProjectSelectionPage scan settings', () => {
	let fixture: ComponentFixture<ProjectSelectionPage>;
	let component: ProjectSelectionPage;
	let scanService: jasmine.SpyObj<ScanOrchestrationService>;
	let configService: jasmine.SpyObj<DesktopScannerConfigService>;

	beforeEach(async () => {
		scanService = jasmine.createSpyObj<ScanOrchestrationService>('ScanOrchestrationService', [
			'reset',
			'setNextScanConfigOverrides'
		]);
		configService = jasmine.createSpyObj<DesktopScannerConfigService>('DesktopScannerConfigService', ['load']);
		configService.load.and.resolveTo({
			config: {
				...DEFAULT_SCANNER_CONFIG,
				guardrails: { maxFiles: 500, maxFileSizeBytes: 4 * 1024 * 1024 }
			},
			packageJsonConfigApplied: true,
			configFilePath: 'C:/project/keylint.config.json',
			guardrailSources: {
				maxFiles: 'package-json',
				maxFileSizeBytes: 'config-file'
			}
		});

		await TestBed.configureTestingModule({
			imports: [ProjectSelectionPage],
			providers: [
				{
					provide: ElectronService,
					useValue: {
						isElectron: true,
						selectProjectDirectory: async () => 'C:/project'
					}
				},
				{
					provide: RecentProjectsService,
					useValue: {
						getRecentProjects: async () => [],
						addRecentProject: jasmine.createSpy('addRecentProject'),
						removeRecentProject: jasmine.createSpy('removeRecentProject')
					}
				},
				{ provide: ScanOrchestrationService, useValue: scanService },
				{ provide: DesktopScannerConfigService, useValue: configService },
				{ provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
				{ provide: AppVersionService, useValue: { version: '1.2.0' } },
				{ provide: ThemeService, useValue: { getCurrent: () => 'light', toggle: () => undefined } },
				{ provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['info', 'debug']) }
			]
		})
			.overrideComponent(ProjectSelectionPage, { set: { template: '' } })
			.compileComponents();

		fixture = TestBed.createComponent(ProjectSelectionPage);
		component = fixture.componentInstance;
		fixture.detectChanges();
	});

	it('loads effective project values and identifies their sources', async () => {
		await component.openFolderDialog();
		await fixture.whenStable();

		expect(configService.load).toHaveBeenCalledOnceWith('C:/project');
		expect(component.maxFilesInput).toBe('500');
		expect(component.maxFileSizeMbInput).toBe('4');
		expect(component.guardrailSourceLabel('maxFiles')).toBe('package.json');
		expect(component.guardrailSourceLabel('maxFileSizeBytes')).toBe('keylint.config.json');
		expect(component.canStartAnalysis).toBeTrue();
	});

	it('passes only changed values to the next scan and resets to project values', async () => {
		await component.openFolderDialog();
		await fixture.whenStable();
		component.onMaxFilesInput('25');
		component.onMaxFileSizeMbInput('1.5');

		expect(component.guardrailSourceLabel('maxFiles')).toBe('Desktop override');
		component.startAnalysis();
		expect(scanService.setNextScanConfigOverrides).toHaveBeenCalledWith({
			guardrails: {
				maxFiles: 25,
				maxFileSizeBytes: 1_572_864
			}
		});

		component.resetScanSettings();
		expect(component.maxFilesInput).toBe('500');
		expect(component.maxFileSizeMbInput).toBe('4');
		expect(component.guardrailSourceLabel('maxFiles')).toBe('package.json');
	});

	it('blocks the scan for invalid values', async () => {
		await component.openFolderDialog();
		await fixture.whenStable();
		component.onMaxFilesInput('0');

		expect(component.scanSettingsValidationError).toContain('positive whole number');
		expect(component.canStartAnalysis).toBeFalse();
	});
});
