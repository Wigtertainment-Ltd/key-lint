import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ModalShowOption, WigButtonComponent, WigModalComponent } from './shared';
import { ElectronService } from './shared/services/electron.service';

@Component({
	selector: 'app-root',
	standalone: true,
	imports: [RouterOutlet, WigModalComponent, WigButtonComponent],
	templateUrl: './app.component.html',
	styleUrl: './app.component.scss'
})
export class AppComponent {
	constructor(private electronService: ElectronService) { }
	modalVisible: boolean = true;
	modalOptions: ModalShowOption = { closable: false };
	projectPath?: string = undefined;
	projectName?: string = undefined;

	async selectProject() {
		try {
			const result: Electron.OpenDialogReturnValue = await this.electronService.remote.dialog.showOpenDialog({ properties: ['openDirectory'] });
			this.projectPath = result.filePaths[0];
			this.getProjectName();
			console.log(result);
		} catch (error) {
			console.error(error);
		}
	}

	checkProject() {
		console.log('checking project...');
	}

	private getProjectName() {
		let pathParts = this.projectPath.split('/');
		if (pathParts.length === 1) {
			pathParts = this.projectPath.split('\\');
		}
		this.projectName = pathParts[pathParts.length - 1];
	}
}
