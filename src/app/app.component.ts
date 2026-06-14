import { Component, OnDestroy, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ElectronService } from './shared/services/electron.service';
import { ScanExecutionSnapshot, ScanOrchestrationService } from './shared/services/scan-orchestration.service';
import { ProjectScanResult } from './core/models/scan-result.model';
import { WigModalComponent, ModalShowOption, WigButtonComponent } from '@wigtertainment-ltd/comp-lib';
import { Subscription } from 'rxjs';

@Component({
	selector: 'app-root',
	standalone: true,
	imports: [RouterOutlet, WigModalComponent, WigButtonComponent],
	templateUrl: './app.component.html',
	styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit, OnDestroy {
	constructor(
		private electronService: ElectronService,
		private scanOrchestrationService: ScanOrchestrationService
	) { }
	modalVisible: boolean = true;
	modalOptions: ModalShowOption = { closable: false };
	projectPath?: string = undefined;
	projectName?: string = undefined;
	scanState: ScanExecutionSnapshot['state'] = 'idle';
	scanStage?: string = undefined;
	scanError?: string = undefined;
	scanResult?: ProjectScanResult = undefined;
	private stateSubscription?: Subscription;

	ngOnInit(): void {
		this.stateSubscription = this.scanOrchestrationService.state$.subscribe((snapshot) => {
			this.scanState = snapshot.state;
			this.scanStage = snapshot.stage;
			this.scanError = snapshot.error;
			this.scanResult = snapshot.result;
			console.log('Scan state updated:', snapshot);
		});
	}

	ngOnDestroy(): void {
		this.stateSubscription?.unsubscribe();
	}

	async selectProject() {
		try {
			const result: Electron.OpenDialogReturnValue = await this.electronService.remote.dialog.showOpenDialog({ properties: ['openDirectory'] });
			this.projectPath = result.filePaths[0];
			this.getProjectName();
			this.scanOrchestrationService.reset();
			this.scanError = undefined;
			this.scanResult = undefined;
		} catch (error) {
			console.error(error);
		}
	}

	async checkProject() {
		if (!this.projectPath || this.scanState === 'running') {
			return;
		}

		try {
			await this.scanOrchestrationService.scanProject(this.projectPath);
		} catch (error) {
			console.error(error);
		}
	}

	private getProjectName() {
		let pathParts = this.projectPath.split('/');
		if (pathParts.length === 1) {
			pathParts = this.projectPath.split('\\');
		}
		this.projectName = pathParts[pathParts.length - 1];
	}
}
