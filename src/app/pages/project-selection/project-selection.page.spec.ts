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
import { DesktopRemoteTranslationService } from '../../shared/services/desktop-remote-translation/desktop-remote-translation.service';

describe('ProjectSelectionPage scan settings', () => {
	let fixture: ComponentFixture<ProjectSelectionPage>;
	let component: ProjectSelectionPage;
	let scanService: jasmine.SpyObj<ScanOrchestrationService>;
	let configService: jasmine.SpyObj<DesktopScannerConfigService>;

	beforeEach(async () => {
		scanService = jasmine.createSpyObj<ScanOrchestrationService>('ScanOrchestrationService', [
			'reset',
			'setNextScanConfigOverrides',
			'setNextDetectedLoaderTypes',
			'authorizeNextRemoteScan'
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
						selectProjectDirectory: async () => 'C:/project',
						readDirectory: async () => [{ name: 'loader.ts', isDirectory: false, isFile: true, isSymbolicLink: false, sizeBytes: 100 }],
						readFile: async () => 'source',
						analyzeTranslationLoaders: async () => ({
							sourceFiles: ['C:/project/loader.ts'], diagnostics: [], candidates: [{
								framework: 'ngx-translate', loader: 'http', api: 'provideTranslateHttpLoader', confidence: 'deterministic',
								resources: [{ urlTemplate: '/i18n/{locale}.json', urlKind: 'relative', requiresOrigin: true }],
								locales: ['en'], location: { filePath: 'C:/project/loader.ts', line: 3, column: 1, endLine: 3, endColumn: 20 }
							}]
						})
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
				DesktopRemoteTranslationService,
				{ provide: DesktopScannerConfigService, useValue: configService },
				{ provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
				{ provide: AppVersionService, useValue: { version: '1.2.0' } },
				{ provide: ThemeService, useValue: { getCurrent: () => 'light', toggle: () => undefined } },
				{ provide: LoggerService, useValue: jasmine.createSpyObj('LoggerService', ['info', 'debug']) }
			]
		}).compileComponents();

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
			},
			translationSources: [{ type: 'filesystem' }]
		});

		component.resetScanSettings();
		expect(component.maxFilesInput).toBe('500');
		expect(component.maxFileSizeMbInput).toBe('4');
		expect(component.guardrailSourceLabel('maxFiles')).toBe('package.json');
	});

	it('renders configured sources and supports editing, removal, and reordering', async () => {
		configService.load.and.resolveTo({
			config: {
				...DEFAULT_SCANNER_CONFIG,
				translationSources: [
					{ type: 'filesystem', id: 'base' },
					{ type: 'http', id: 'api', urlTemplate: 'https://example.com/{locale}.json', locales: ['en'] }
				]
			},
			packageJsonConfigApplied: false,
			guardrailSources: { maxFiles: 'default', maxFileSizeBytes: 'default' }
		});
		await component.openFolderDialog();
		await fixture.whenStable();
		fixture.detectChanges();

		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Translation sources');
		expect(component.translationSources.map((source) => source.id)).toEqual(['base', 'api']);
		component.moveTranslationSource(component.translationSources[1].draftId, -1);
		expect(component.translationSources.map((source) => source.id)).toEqual(['api', 'base']);
		component.removeTranslationSource(component.translationSources[0].draftId);
		expect(component.translationSources.map((source) => source.id)).toEqual(['base']);
	});

	it('requires confirmation before remote navigation and clears temporary secrets after approval', async () => {
		configService.load.and.resolveTo({
			config: {
				...DEFAULT_SCANNER_CONFIG,
				translationSources: [{
					type: 'http', id: 'api', urlTemplate: 'http://127.0.0.1/{locale}.json', locales: ['en'],
					headersFromEnv: { Authorization: 'KEYLINT_AUTH' }
				}]
			},
			packageJsonConfigApplied: false,
			guardrailSources: { maxFiles: 'default', maxFileSizeBytes: 'default' }
		});
		await component.openFolderDialog();
		await fixture.whenStable();
		const source = component.translationSources[0];
		component.onHeaderValueInput(source.draftId, source.headers[0].id, 'Bearer secret');

		component.startAnalysis();
		expect(component.remoteConfirmation).toEqual(jasmine.objectContaining({
			hasInsecureHttp: true,
			hasPrivateOrLocalTarget: true,
			expectedRequestCount: 1
		}));
		expect(scanService.authorizeNextRemoteScan).not.toHaveBeenCalled();

		let capturedEnvironment: Record<string, string> = {};
		scanService.authorizeNextRemoteScan.and.callFake((environment) => {
			capturedEnvironment = { ...environment };
		});
		component.confirmRemoteAnalysis();
		expect(capturedEnvironment).toEqual({ KEYLINT_AUTH: 'Bearer secret' });
		expect(component.translationSources[0].headers[0].value).toBe('');
	});

	it('blocks the scan for invalid values', async () => {
		await component.openFolderDialog();
		await fixture.whenStable();
		component.onMaxFilesInput('0');

		expect(component.scanSettingsValidationError).toContain('positive whole number');
		expect(component.canStartAnalysis).toBeFalse();
	});

	it('shows detected auto-http candidates and blocks confirmation until a relative origin is supplied', async () => {
		configService.load.and.resolveTo({
			config: { ...DEFAULT_SCANNER_CONFIG, translationSources: [{ type: 'auto-http' }] },
			packageJsonConfigApplied: false,
			guardrailSources: { maxFiles: 'default', maxFileSizeBytes: 'default' }
		});
		await component.openFolderDialog();
		await fixture.whenStable();
		await new Promise((resolve) => setTimeout(resolve, 0));
		await fixture.whenStable();
		fixture.detectChanges();

		expect(component.scanSettingsError).toBe('');
		expect(component.translationSources[0].autoCandidates[0]).toEqual(jasmine.objectContaining({
			framework: 'ngx-translate', location: 'C:/project/loader.ts:3:1'
		}));
		expect((fixture.nativeElement as HTMLElement).textContent).toContain('Endpoints: /i18n/{locale}.json');
		expect(component.translationSourcesValidationError).toContain('requires an origin');
		expect(component.canStartAnalysis).toBeFalse();

		component.onSourceOriginInput(component.translationSources[0].draftId, 'https://app.example');
		expect(component.canStartAnalysis).toBeTrue();
		component.startAnalysis();
		expect(component.remoteConfirmation?.sources[0]).toEqual(jasmine.objectContaining({
			urlTemplate: 'https://app.example/i18n/{locale}.json', locales: ['en']
		}));
		expect(scanService.authorizeNextRemoteScan).not.toHaveBeenCalled();
	});
});
