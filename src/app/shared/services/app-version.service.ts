import { inject, Injectable, signal, WritableSignal } from '@angular/core';

import { ElectronService } from './electron.service';

const APP_VERSION_FALLBACK: string = '1.4.0';

@Injectable({
	providedIn: 'root'
})
export class AppVersionService {
	private readonly electronService: ElectronService = inject(ElectronService);
	private readonly versionSignal: WritableSignal<string> = signal(APP_VERSION_FALLBACK);

	constructor() {
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
			const version: string = await this.electronService.getAppVersion();
			if (version) {
				this.versionSignal.set(version);
			}
		} catch {
			// Keep the bundled fallback when the desktop bridge cannot provide a version.
		}
	}
}
