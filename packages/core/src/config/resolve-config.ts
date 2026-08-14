import { DEFAULT_SCANNER_CONFIG, IScannerConfig } from './scanner-defaults.js';
import {
	IScannerConfigOverrides,
	mergeScannerConfig,
	parseScannerConfigOverrides
} from './scanner-config.js';

export const CONFIG_FILE_NAME = 'keylint.config.json';
export const PACKAGE_JSON_CONFIG_KEY = 'keylint';

export interface IScannerConfigSources {
	packageJson?: unknown;
	configFile?: unknown;
	overrides?: IScannerConfigOverrides;
}

export interface IResolvedScannerConfig {
	config: IScannerConfig;
	packageJsonConfigApplied: boolean;
	configFileApplied: boolean;
}

/**
 * Resolves scanner configuration from already-loaded JSON values without any
 * runtime-specific filesystem access.
 * Precedence: defaults < package.json["keylint"] < config file < overrides.
 */
export function resolveScannerConfigSources(sources: IScannerConfigSources): IResolvedScannerConfig {
	let config = DEFAULT_SCANNER_CONFIG;
	let packageJsonConfigApplied = false;
	let configFileApplied = false;

	if (sources.packageJson && typeof sources.packageJson === 'object' && !Array.isArray(sources.packageJson)) {
		const embedded = (sources.packageJson as Record<string, unknown>)[PACKAGE_JSON_CONFIG_KEY];
		if (embedded !== undefined) {
			config = mergeScannerConfig(config, parseScannerConfigOverrides(embedded));
			packageJsonConfigApplied = true;
		}
	}

	if (sources.configFile !== undefined) {
		config = mergeScannerConfig(config, parseScannerConfigOverrides(sources.configFile));
		configFileApplied = true;
	}

	config = mergeScannerConfig(config, sources.overrides ?? {});

	return { config, packageJsonConfigApplied, configFileApplied };
}
