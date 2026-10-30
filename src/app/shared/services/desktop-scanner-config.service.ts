import { inject, Injectable } from '@angular/core';
import {
	CONFIG_FILE_NAME,
	IScannerConfigOverrides,
	IScannerConfig,
	IScannerGuardrails,
	normalizePath,
	resolveScannerConfigSources,
	ScannerConfigValueSource,
	ScannerConfigError,
	IResolvedScannerConfig
} from '@key-lint/core';

import { ElectronService } from './electron.service';

export interface IDesktopLoadedScannerConfig {
	config: IScannerConfig;
	configFilePath?: string;
	packageJsonConfigApplied: boolean;
	guardrailSources: Record<keyof IScannerGuardrails, ScannerConfigValueSource>;
}

@Injectable({ providedIn: 'root' })
export class DesktopScannerConfigService {
	private readonly electronService: ElectronService = inject(ElectronService);

	async load(
		projectRoot: string,
		overrides: IScannerConfigOverrides = {}
	): Promise<IDesktopLoadedScannerConfig> {
		// Remove one trailing forward slash before appending configuration filenames.
		const normalizedRoot: string = normalizePath(projectRoot).replace(/\/$/, '');
		if (!this.electronService.isElectron) {
			const resolved: IResolvedScannerConfig = resolveScannerConfigSources({ overrides });
			return {
				config: resolved.config,
				packageJsonConfigApplied: false,
				guardrailSources: resolved.guardrailSources
			};
		}

		const packageJsonPath: string = `${normalizedRoot}/package.json`;
		const configFilePath: string = `${normalizedRoot}/${CONFIG_FILE_NAME}`;
		const packageJson: unknown = await this.readJsonFileIfPresent(packageJsonPath);
		const configFile: unknown = await this.readJsonFileIfPresent(configFilePath);
		const resolved: IResolvedScannerConfig = resolveScannerConfigSources({ packageJson, configFile, overrides });

		return {
			config: resolved.config,
			configFilePath: resolved.configFileApplied ? configFilePath : undefined,
			packageJsonConfigApplied: resolved.packageJsonConfigApplied,
			guardrailSources: resolved.guardrailSources
		};
	}

	private async readJsonFileIfPresent(filePath: string): Promise<unknown> {
		if (!await this.electronService.pathExists(filePath)) {
			return undefined;
		}

		let raw: string;
		try {
			raw = await this.electronService.readFile(filePath);
		} catch (error: unknown) {
			throw new ScannerConfigError(
				`Could not read "${filePath}": ${error instanceof Error ? error.message : 'unknown error'}`
			);
		}

		try {
			return JSON.parse(raw) as unknown;
		} catch (error: unknown) {
			throw new ScannerConfigError(
				`Could not parse "${filePath}": ${error instanceof Error ? error.message : 'invalid JSON'}`
			);
		}
	}
}
