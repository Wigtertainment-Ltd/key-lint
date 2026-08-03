import { Injectable } from '@angular/core';

const APP_VERSION_FALLBACK = '1.1.3';

@Injectable({
	providedIn: 'root'
})
export class AppVersionService {
	private _version?: string;

	get version(): string {
		if (this._version === undefined) {
			this._version = this.loadVersion();
		}
		return this._version;
	}

	private loadVersion(): string {
		const isElectron = !!(window && (window as any).process && (window as any).process.type);

		if (isElectron) {
			try {
				const fs = window.require('fs');
				const path = window.require('path');
				const packagePath = path.join(__dirname, '..', 'package.json');
				const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
				return pkg.version ?? APP_VERSION_FALLBACK;
			} catch {
				return APP_VERSION_FALLBACK;
			}
		}

		return APP_VERSION_FALLBACK;
	}
}
