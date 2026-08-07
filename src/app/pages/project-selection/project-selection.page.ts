import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronService } from '../../shared/services/electron.service';
import { AppVersionService } from '../../shared/services/app-version.service';
import { RecentProjectsService } from '../../shared/services/recent-projects.service';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';
import { ThemeService } from '../../services/theme.service';
import { LoggerService } from '../../shared/services/logging/logger.service';
import { ElectronFile, IRecentProjectViewModel } from './project-selection.interfaces';

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

	private readonly electronService: ElectronService = inject(ElectronService);
	private readonly recentProjectsService: RecentProjectsService = inject(RecentProjectsService);
	private readonly scanOrchestrationService: ScanOrchestrationService = inject(ScanOrchestrationService);
	private readonly router: Router = inject(Router);
	private readonly loggerService: LoggerService = inject(LoggerService);

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

	get appVersion(): string {
		return this.appVersionService.version;
	}

	ngOnInit(): void {
		this.loadRecentProjects();
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
			const result: Electron.OpenDialogReturnValue = await this.electronService.remote.dialog.showOpenDialog({
				properties: ['openDirectory']
			});
			const selected = result.filePaths?.[0];
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
		const droppedPath = first.path || this.extractRootFromWebkitPath(first.webkitRelativePath);
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
		const selectedPath = first.path || this.extractRootFromWebkitPath(first.webkitRelativePath);
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
		this.loadRecentProjects();

		const selectedPath = this.projectPathSignal();
		if (selectedPath && this.isSamePath(selectedPath, project.path)) {
			this.clearSelection();
		}
	}

	startAnalysis(): void {
		const projectPath = this.projectPathSignal();
		if (!projectPath) {
			return;
		}

		this.scanOrchestrationService.reset();
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
		this.loadRecentProjects();
		this.scanOrchestrationService.reset();
	}

	private loadRecentProjects(): void {
		this.loggerService.debug('ProjectSelectionPage', 'Loading recent projects...');
		this.recentProjectsSignal.set(this.recentProjectsService.getRecentProjects().map((project) => ({
			...project,
			name: this.getProjectName(project.path)
		})));
	}

	private getProjectName(path: string): string {
		const normalized = path.replaceAll('\\', '/');
		const parts = normalized.split('/').filter(Boolean);
		return parts.at(-1) ?? path;
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
