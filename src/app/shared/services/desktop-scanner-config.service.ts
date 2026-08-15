import { Injectable } from '@angular/core';
import {
	CONFIG_FILE_NAME,
	IScannerConfigOverrides,
	IScannerConfig,
	IScannerGuardrails,
	normalizePath,
	resolveScannerConfigSources,
	ScannerConfigValueSource,
	ScannerConfigError
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
	constructor(private readonly electronService: ElectronService) {}

	async load(
		projectRoot: string,
		overrides: IScannerConfigOverrides = {}
	): Promise<IDesktopLoadedScannerConfig> {
		const normalizedRoot = normalizePath(projectRoot).replace(/\/$/, '');
		if (!this.electronService.isElectron) {
			const resolved = resolveScannerConfigSources({ overrides });
			return {
				config: resolved.config,
				packageJsonConfigApplied: false,
				guardrailSources: resolved.guardrailSources
			};
		}

		const packageJsonPath = `${normalizedRoot}/package.json`;
		const configFilePath = `${normalizedRoot}/${CONFIG_FILE_NAME}`;
		const packageJson = await this.readJsonFileIfPresent(packageJsonPath);
		const configFile = await this.readJsonFileIfPresent(configFilePath);
		const resolved = resolveScannerConfigSources({ packageJson, configFile, overrides });

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
		} catch (error) {
			throw new ScannerConfigError(
				`Could not read "${filePath}": ${error instanceof Error ? error.message : 'unknown error'}`
			);
		}

		try {
			return JSON.parse(raw) as unknown;
		} catch (error) {
			throw new ScannerConfigError(
				`Could not parse "${filePath}": ${error instanceof Error ? error.message : 'invalid JSON'}`
			);
		}
	}
}
