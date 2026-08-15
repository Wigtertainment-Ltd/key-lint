import { Injectable, signal } from '@angular/core';

import { ElectronService } from './electron.service';

const APP_VERSION_FALLBACK = '1.2.0';

@Injectable({
	providedIn: 'root'
})
export class AppVersionService {
	private readonly versionSignal = signal(APP_VERSION_FALLBACK);

	constructor(private readonly electronService: ElectronService) {
		void this.loadVersion();
	}

	get version(): string {
		return this.versionSignal();
	}

	private async loadVersion(): Promise<void> {
		if (!this.electronService.isElectron) {
			return;
		}

		try {
			const version = await this.electronService.getAppVersion();
			if (version) {
				this.versionSignal.set(version);
			}
		} catch {
			// Keep the bundled fallback when the desktop bridge cannot provide a version.
		}
	}
}
