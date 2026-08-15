import { DEFAULT_SCANNER_CONFIG, IScannerConfig, IScannerGuardrails } from './scanner-defaults.js';
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
	guardrailSources: Record<keyof IScannerGuardrails, ScannerConfigValueSource>;
}

export type ScannerConfigValueSource = 'default' | 'package-json' | 'config-file' | 'override';

function updateGuardrailSources(
	sources: Record<keyof IScannerGuardrails, ScannerConfigValueSource>,
	overrides: IScannerConfigOverrides,
	source: ScannerConfigValueSource
): void {
	if (overrides.guardrails?.maxFiles !== undefined) {
		sources.maxFiles = source;
	}
	if (overrides.guardrails?.maxFileSizeBytes !== undefined) {
		sources.maxFileSizeBytes = source;
	}
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
	const guardrailSources: Record<keyof IScannerGuardrails, ScannerConfigValueSource> = {
		maxFiles: 'default',
		maxFileSizeBytes: 'default'
	};

	if (sources.packageJson && typeof sources.packageJson === 'object' && !Array.isArray(sources.packageJson)) {
		const embedded = (sources.packageJson as Record<string, unknown>)[PACKAGE_JSON_CONFIG_KEY];
		if (embedded !== undefined) {
			const packageOverrides = parseScannerConfigOverrides(embedded);
			config = mergeScannerConfig(config, packageOverrides);
			updateGuardrailSources(guardrailSources, packageOverrides, 'package-json');
			packageJsonConfigApplied = true;
		}
	}

	if (sources.configFile !== undefined) {
		const configFileOverrides = parseScannerConfigOverrides(sources.configFile);
		config = mergeScannerConfig(config, configFileOverrides);
		updateGuardrailSources(guardrailSources, configFileOverrides, 'config-file');
		configFileApplied = true;
	}

	const finalOverrides = sources.overrides ?? {};
	config = mergeScannerConfig(config, finalOverrides);
	updateGuardrailSources(guardrailSources, finalOverrides, 'override');

	return { config, packageJsonConfigApplied, configFileApplied, guardrailSources };
}
