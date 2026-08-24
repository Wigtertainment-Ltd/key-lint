import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronService } from '../../shared/services/electron.service';
import { AppVersionService } from '../../shared/services/app-version.service';
import { RecentProjectsService } from '../../shared/services/recent-projects.service';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { ThemeService } from '../../services/theme.service';
import { LoggerService } from '../../shared/services/logging/logger.service';
import { DesktopScannerConfigService } from '../../shared/services/desktop-scanner-config.service';
import { IScannerGuardrails, ScannerConfigValueSource } from '@key-lint/core';
import { ElectronFile, IRecentProjectViewModel } from './project-selection.interfaces';
import { DesktopRemoteTranslationService } from '../../shared/services/desktop-remote-translation/desktop-remote-translation.service';
import {
	IDesktopTranslationSourceDraft,
	IPreparedDesktopRemoteScan,
	IRemoteScanConfirmation
} from '../../shared/services/desktop-remote-translation/desktop-remote-translation.interfaces';

@Component({
	selector: 'app-project-selection-page',
	templateUrl: './project-selection.page.html',
	styleUrl: './project-selection.page.scss'
})
export class ProjectSelectionPage implements OnInit {
	private readonly projectPathSignal = signal<string | undefined>(undefined);
	private readonly projectNameSignal = signal<string | undefined>(undefined);
	private readonly isDragOverSignal = signal(false);
	private readonly recentProjectsSignal = signal<IRecentProjectViewModel[]>([]);
	private readonly projectGuardrailsSignal = signal<IScannerGuardrails | undefined>(undefined);
	private readonly guardrailSourcesSignal = signal<Record<keyof IScannerGuardrails, ScannerConfigValueSource> | undefined>(undefined);
	private readonly scanSettingsLoadingSignal = signal(false);
	private readonly scanSettingsErrorSignal = signal('');
	private readonly maxFilesInputSignal = signal('');
	private readonly maxFileSizeMbInputSignal = signal('');
	private readonly translationSourcesSignal = signal<IDesktopTranslationSourceDraft[]>([]);
	private readonly remoteConfirmationSignal = signal<IRemoteScanConfirmation | undefined>(undefined);
	private recentProjectsLoadId = 0;
	private scanSettingsLoadId = 0;

	private readonly electronService: ElectronService = inject(ElectronService);
	private readonly recentProjectsService: RecentProjectsService = inject(RecentProjectsService);
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly router: Router = inject(Router);
	private readonly loggerService: LoggerService = inject(LoggerService);
	private readonly desktopScannerConfigService: DesktopScannerConfigService = inject(DesktopScannerConfigService);
	private readonly desktopRemoteTranslationService: DesktopRemoteTranslationService = inject(DesktopRemoteTranslationService);

	readonly themeService = inject(ThemeService);
	readonly appVersionService = inject(AppVersionService);

	get isDark(): boolean {
		return this.themeService.getCurrent() === 'dark';
	}

	get isDragOver(): boolean {
		return this.isDragOverSignal();
	}

	get recentProjects(): IRecentProjectViewModel[] {
		return this.recentProjectsSignal();
	}

	get hasSelection(): boolean {
		return Boolean(this.projectPathSignal());
	}

	get pathDisplay(): string {
		return this.projectPathSignal() ?? 'No project selected';
	}

	get hasRecentProjects(): boolean {
		return this.recentProjectsSignal().length > 0;
	}

	get scanSettingsLoading(): boolean {
		return this.scanSettingsLoadingSignal();
	}

	get scanSettingsError(): string {
		return this.scanSettingsErrorSignal();
	}

	get maxFilesInput(): string {
		return this.maxFilesInputSignal();
	}

	get maxFileSizeMbInput(): string {
		return this.maxFileSizeMbInputSignal();
	}

	get translationSources(): IDesktopTranslationSourceDraft[] {
		return this.translationSourcesSignal();
	}

	get translationSourcesValidationError(): string {
		return this.desktopRemoteTranslationService.validationError();
	}

	get remoteConfirmation(): IRemoteScanConfirmation | undefined {
		return this.remoteConfirmationSignal();
	}

	get scanSettingsValidationError(): string {
		if (!this.projectGuardrailsSignal() || this.scanSettingsLoading) {
			return '';
		}

		if (this.parsePositiveInteger(this.maxFilesInput) === undefined) {
			return 'Maximum files must be a positive whole number.';
		}

		const maxFileSizeMb = this.parsePositiveNumber(this.maxFileSizeMbInput);
		if (maxFileSizeMb === undefined || Math.round(maxFileSizeMb * 1024 * 1024) < 1) {
			return 'Maximum file size must be a positive number.';
		}

		return '';
	}

	get scanSettingsHighLimitWarning(): string {
		const maxFiles = this.parsePositiveInteger(this.maxFilesInput);
		const maxFileSizeMb = this.parsePositiveNumber(this.maxFileSizeMbInput);
		return (maxFiles !== undefined && maxFiles > 100_000) ||
			(maxFileSizeMb !== undefined && maxFileSizeMb > 50)
			? 'High limits can make desktop scans slower and use considerably more memory.'
			: '';
	}

	get canStartAnalysis(): boolean {
		return this.hasSelection &&
			!this.scanSettingsLoading &&
			!this.scanSettingsError &&
			!this.scanSettingsValidationError &&
			!this.translationSourcesValidationError;
	}

	get appVersion(): string {
		return this.appVersionService.version;
	}

	ngOnInit(): void {
		void this.loadRecentProjects();
	}

	toggleTheme(): void {
		this.themeService.toggle();
	}

	async openFolderDialog(folderInput?: HTMLInputElement): Promise<void> {
		if (!this.electronService.isElectron) {
			if (folderInput) {
				// Reset input so selecting the same folder again still fires change.
				folderInput.value = '';
				folderInput.click();
			}
			return;
		}

		try {
			const selected = await this.electronService.selectProjectDirectory();
			if (!selected) {
				return;
			}

			this.setSelectedPath(selected);
		} catch (error) {
			console.error(error);
		}
	}

	onDragEnter(event: DragEvent): void {
		event.preventDefault();
		this.isDragOverSignal.set(true);
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();
		this.isDragOverSignal.set(true);
	}

	onDragLeave(event: DragEvent): void {
		event.preventDefault();
		this.isDragOverSignal.set(false);
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		this.isDragOverSignal.set(false);

		const files = event.dataTransfer?.files;
		if (!files || files.length === 0) {
			return;
		}

		const first = files[0] as ElectronFile;
		const droppedPath = this.resolveSelectedFilePath(first);
		if (!droppedPath) {
			return;
		}

		this.setSelectedPath(droppedPath);
	}

	onFolderInputChange(event: Event): void {
		const input = event.target as HTMLInputElement;
		const files = input.files;
		if (!files || files.length === 0) {
			return;
		}

		const first = files[0] as ElectronFile;
		const selectedPath = this.resolveSelectedFilePath(first);
		if (!selectedPath) {
			return;
		}

		this.setSelectedPath(selectedPath);
		input.value = '';
	}

	clearSelection(event?: Event): void {
		event?.stopPropagation();
		this.projectPathSignal.set(undefined);
		this.projectNameSignal.set(undefined);
		this.clearScanSettings();
		this.desktopRemoteTranslationService.clear();
		this.syncTranslationSources();
		this.remoteConfirmationSignal.set(undefined);
		this.scanOrchestrationService.reset();
	}

	onSelectRecentProject(project: IRecentProjectViewModel): void {
		if (!project.exists) {
			return;
		}

		this.setSelectedPath(project.path);
	}

	onRemoveRecentProject(project: IRecentProjectViewModel, event: Event): void {
		event.stopPropagation();
		this.recentProjectsService.removeRecentProject(project.path);
		void this.loadRecentProjects();

		const selectedPath = this.projectPathSignal();
		if (selectedPath && this.isSamePath(selectedPath, project.path)) {
			this.clearSelection();
		}
	}

	startAnalysis(): void {
		const projectPath = this.projectPathSignal();
		if (!projectPath || !this.canStartAnalysis) {
			return;
		}
		const prepared = this.desktopRemoteTranslationService.prepareScan();
		if (this.desktopRemoteTranslationService.hasRemoteSources) {
			this.remoteConfirmationSignal.set(prepared.confirmation);
			this.wipePreparedEnvironment(prepared);
			return;
		}
		this.beginAnalysis(projectPath, prepared, false);
	}

	confirmRemoteAnalysis(): void {
		const projectPath = this.projectPathSignal();
		if (!projectPath || !this.remoteConfirmation) {
			return;
		}
		const prepared = this.desktopRemoteTranslationService.prepareScan();
		this.remoteConfirmationSignal.set(undefined);
		this.beginAnalysis(projectPath, prepared, true);
	}

	cancelRemoteConfirmation(): void {
		this.remoteConfirmationSignal.set(undefined);
		this.desktopRemoteTranslationService.clearSecrets();
		this.syncTranslationSources();
	}

	private beginAnalysis(projectPath: string, prepared: IPreparedDesktopRemoteScan, authorizeRemote: boolean): void {
		this.scanOrchestrationService.reset();
		this.scanOrchestrationService.setNextScanConfigOverrides({
			guardrails: this.buildGuardrailOverrides(),
			translationSources: prepared.translationSources
		});
		if (authorizeRemote) {
			this.scanOrchestrationService.authorizeNextRemoteScan(prepared.environment);
		}
		this.wipePreparedEnvironment(prepared);
		this.desktopRemoteTranslationService.clearSecrets();
		this.syncTranslationSources();
		void this.router.navigate(['/scan-progress'], {
			queryParams: {
				projectPath
			}
		});
	}

	private setSelectedPath(path: string): void {
		this.loggerService.info('ProjectSelectionPage', 'Selected project path:', path);
		this.projectPathSignal.set(path);
		this.projectNameSignal.set(this.getProjectName(path));
		this.recentProjectsService.addRecentProject(path);
		void this.loadRecentProjects();
		this.scanOrchestrationService.reset();
		this.desktopRemoteTranslationService.clear();
		this.syncTranslationSources();
		this.remoteConfirmationSignal.set(undefined);
		void this.loadScanSettings(path);
	}

	onMaxFilesInput(value: string): void {
		this.maxFilesInputSignal.set(value.trim());
	}

	onMaxFileSizeMbInput(value: string): void {
		this.maxFileSizeMbInputSignal.set(value.trim());
	}

	resetScanSettings(): void {
		const guardrails = this.projectGuardrailsSignal();
		if (guardrails) {
			this.setGuardrailInputs(guardrails);
		}
		this.desktopRemoteTranslationService.resetSources();
		this.syncTranslationSources();
	}

	addFilesystemSource(): void {
		this.desktopRemoteTranslationService.addFilesystemSource();
		this.syncTranslationSources();
	}

	addHttpSource(): void {
		this.desktopRemoteTranslationService.addHttpSource();
		this.syncTranslationSources();
	}

	removeTranslationSource(draftId: string): void {
		this.desktopRemoteTranslationService.removeSource(draftId);
		this.syncTranslationSources();
	}

	moveTranslationSource(draftId: string, direction: -1 | 1): void {
		this.desktopRemoteTranslationService.moveSource(draftId, direction);
		this.syncTranslationSources();
	}

	onSourceIdInput(draftId: string, value: string): void {
		this.desktopRemoteTranslationService.updateSource(draftId, { id: value });
		this.syncTranslationSources();
	}

	onSourceGlobsInput(draftId: string, value: string): void {
		this.desktopRemoteTranslationService.updateSource(draftId, { includeGlobs: this.parseList(value) });
		this.syncTranslationSources();
	}

	onSourceUrlInput(draftId: string, value: string): void {
		this.desktopRemoteTranslationService.updateSource(draftId, { urlTemplate: value });
		this.syncTranslationSources();
	}

	onSourceLocalesInput(draftId: string, value: string): void {
		this.desktopRemoteTranslationService.updateSource(draftId, { locales: this.parseList(value) });
		this.syncTranslationSources();
	}

	addTemporaryHeader(draftId: string): void {
		this.desktopRemoteTranslationService.addTemporaryHeader(draftId);
		this.syncTranslationSources();
	}

	onHeaderNameInput(draftId: string, headerId: string, value: string): void {
		this.desktopRemoteTranslationService.updateHeader(draftId, headerId, { name: value });
		this.syncTranslationSources();
	}

	onHeaderValueInput(draftId: string, headerId: string, value: string): void {
		this.desktopRemoteTranslationService.updateHeader(draftId, headerId, { value });
		this.syncTranslationSources();
	}

	removeTemporaryHeader(draftId: string, headerId: string): void {
		this.desktopRemoteTranslationService.removeHeader(draftId, headerId);
		this.syncTranslationSources();
	}

	guardrailSourceLabel(key: keyof IScannerGuardrails): string {
		if (this.isGuardrailOverridden(key)) {
			return 'Desktop override';
		}

		const source = this.guardrailSourcesSignal()?.[key] ?? 'default';
		return {
			default: 'Built-in default',
			'package-json': 'package.json',
			'config-file': 'keylint.config.json',
			override: 'Desktop override'
		}[source];
	}

	private async loadScanSettings(projectPath: string): Promise<void> {
		const loadId = ++this.scanSettingsLoadId;
		this.scanSettingsLoadingSignal.set(true);
		this.scanSettingsErrorSignal.set('');
		this.projectGuardrailsSignal.set(undefined);

		try {
			const loaded = await this.desktopScannerConfigService.load(projectPath);
			if (loadId !== this.scanSettingsLoadId) {
				return;
			}

			this.projectGuardrailsSignal.set({ ...loaded.config.guardrails });
			this.guardrailSourcesSignal.set({ ...loaded.guardrailSources });
			this.setGuardrailInputs(loaded.config.guardrails);
			this.desktopRemoteTranslationService.loadConfiguredSources(loaded.config.translationSources);
			this.syncTranslationSources();
		} catch (error) {
			if (loadId === this.scanSettingsLoadId) {
				this.scanSettingsErrorSignal.set(
					error instanceof Error ? error.message : 'Could not load project scan settings.'
				);
			}
		} finally {
			if (loadId === this.scanSettingsLoadId) {
				this.scanSettingsLoadingSignal.set(false);
			}
		}
	}

	private setGuardrailInputs(guardrails: IScannerGuardrails): void {
		this.maxFilesInputSignal.set(String(guardrails.maxFiles));
		const sizeMb = guardrails.maxFileSizeBytes / (1024 * 1024);
		this.maxFileSizeMbInputSignal.set(String(Number(sizeMb.toFixed(6))));
	}

	private buildGuardrailOverrides(): Partial<IScannerGuardrails> {
		const projectGuardrails = this.projectGuardrailsSignal();
		if (!projectGuardrails) {
			return {};
		}

		const maxFiles = this.parsePositiveInteger(this.maxFilesInput);
		const maxFileSizeMb = this.parsePositiveNumber(this.maxFileSizeMbInput);
		if (maxFiles === undefined || maxFileSizeMb === undefined) {
			return {};
		}
		const maxFileSizeBytes = Math.round(maxFileSizeMb * 1024 * 1024);
		if (maxFileSizeBytes < 1) {
			return {};
		}
		const overrides: Partial<IScannerGuardrails> = {};
		if (maxFiles !== projectGuardrails.maxFiles) {
			overrides.maxFiles = maxFiles;
		}
		if (maxFileSizeBytes !== projectGuardrails.maxFileSizeBytes) {
			overrides.maxFileSizeBytes = maxFileSizeBytes;
		}
		return overrides;
	}

	private isGuardrailOverridden(key: keyof IScannerGuardrails): boolean {
		return this.buildGuardrailOverrides()[key] !== undefined;
	}

	private clearScanSettings(): void {
		this.scanSettingsLoadId += 1;
		this.scanSettingsLoadingSignal.set(false);
		this.scanSettingsErrorSignal.set('');
		this.projectGuardrailsSignal.set(undefined);
		this.guardrailSourcesSignal.set(undefined);
		this.maxFilesInputSignal.set('');
		this.maxFileSizeMbInputSignal.set('');
	}

	private syncTranslationSources(): void {
		this.translationSourcesSignal.set(this.desktopRemoteTranslationService.sources);
	}

	private parseList(value: string): string[] {
		return value.split(/[\n,]/).map((entry) => entry.trim()).filter(Boolean);
	}

	private wipePreparedEnvironment(prepared: IPreparedDesktopRemoteScan): void {
		for (const key of Object.keys(prepared.environment)) {
			delete prepared.environment[key];
		}
	}

	private parsePositiveInteger(value: string): number | undefined {
		// Accept only a non-empty sequence of ASCII digits before numeric range validation.
		if (!/^\d+$/.test(value)) {
			return undefined;
		}
		const parsed = Number(value);
		return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
	}

	private parsePositiveNumber(value: string): number | undefined {
		const parsed = Number(value);
		return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
	}

	private async loadRecentProjects(): Promise<void> {
		this.loggerService.debug('ProjectSelectionPage', 'Loading recent projects...');
		const loadId = ++this.recentProjectsLoadId;
		const recentProjects = await this.recentProjectsService.getRecentProjects();
		if (loadId !== this.recentProjectsLoadId) {
			return;
		}
		this.recentProjectsSignal.set(recentProjects.map((project) => ({
			...project,
			name: this.getProjectName(project.path)
		})));
	}

	private getProjectName(path: string): string {
		const normalized = path.replaceAll('\\', '/');
		const parts = normalized.split('/').filter(Boolean);
		return parts.at(-1) ?? path;
	}

	private resolveSelectedFilePath(file: ElectronFile): string | undefined {
		if (this.electronService.isElectron) {
			const electronPath = this.electronService.getPathForFile(file);
			if (electronPath) {
				return electronPath;
			}
		}

		return file.path || this.extractRootFromWebkitPath(file.webkitRelativePath);
	}

	private extractRootFromWebkitPath(webkitRelativePath?: string): string | undefined {
		if (!webkitRelativePath) {
			return undefined;
		}

		const root = webkitRelativePath.split('/')[0];
		return root || undefined;
	}

	private isSamePath(left: string, right: string): boolean {
		return this.normalizePathForCompare(left) === this.normalizePathForCompare(right);
	}

	private normalizePathForCompare(path: string): string {
		let normalized = path.replaceAll('\\', '/').trim();
		while (normalized.length > 1 && normalized.endsWith('/')) {
			normalized = normalized.slice(0, -1);
		}

		return normalized.toLowerCase();
	}
}
