import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { ElectronService } from '../../shared/services/electron.service';
import { ScanOrchestrationService } from '../../shared/services/scan-orchestration.service';

type ElectronFile = File & { path?: string; webkitRelativePath?: string };

@Component({
	selector: 'app-project-selection-page',
	standalone: true,
	templateUrl: './project-selection.page.html',
	styleUrl: './project-selection.page.scss'
})
export class ProjectSelectionPage {
	projectPath?: string = undefined;
	projectName?: string = undefined;
	isDragOver = false;

	constructor(
		private readonly electronService: ElectronService,
		private readonly scanOrchestrationService: ScanOrchestrationService,
		private readonly router: Router
	) {}

	get hasSelection(): boolean {
		return Boolean(this.projectPath);
	}

	get pathDisplay(): string {
		return this.projectPath ?? 'No project selected';
	}

	async openFolderDialog(): Promise<void> {
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
		this.isDragOver = true;
	}

	onDragOver(event: DragEvent): void {
		event.preventDefault();
		this.isDragOver = true;
	}

	onDragLeave(event: DragEvent): void {
		event.preventDefault();
		this.isDragOver = false;
	}

	onDrop(event: DragEvent): void {
		event.preventDefault();
		this.isDragOver = false;

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
	}

	clearSelection(event?: Event): void {
		event?.stopPropagation();
		this.projectPath = undefined;
		this.projectName = undefined;
		this.scanOrchestrationService.reset();
	}

	startAnalysis(): void {
		if (!this.projectPath) {
			return;
		}

		this.scanOrchestrationService.reset();
		void this.router.navigate(['/scan-progress'], {
			queryParams: {
				projectPath: this.projectPath
			}
		});
	}

	private setSelectedPath(path: string): void {
		this.projectPath = path;
		this.projectName = this.getProjectName(path);
		this.scanOrchestrationService.reset();
	}

	private getProjectName(path: string): string {
		const normalized = path.replace(/\\/g, '/');
		const parts = normalized.split('/').filter(Boolean);
		return parts[parts.length - 1] ?? path;
	}

	private extractRootFromWebkitPath(webkitRelativePath?: string): string | undefined {
		if (!webkitRelativePath) {
			return undefined;
		}

		const root = webkitRelativePath.split('/')[0];
		return root || undefined;
	}
}
