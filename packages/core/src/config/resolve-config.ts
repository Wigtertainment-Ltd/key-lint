import { DEFAULT_SCANNER_CONFIG } from './scanner-defaults.js';
import { mergeScannerConfig, parseScannerConfigOverrides } from './scanner-config.js';
import { IResolvedScannerConfig, IScannerConfigOverrides, IScannerConfigSources, IScannerGuardrails, ScannerConfigValueSource, IScannerConfig } from './config.interfaces.js';

export const CONFIG_FILE_NAME: string = 'keylint.config.json';
export const PACKAGE_JSON_CONFIG_KEY: string = 'keylint';

/**
 * Updates guardrail provenance in place for limits supplied by an override layer.
 *
 * @param sources - Mutable provenance map to update.
 * @param overrides - Configuration layer whose explicitly defined limits are inspected.
 * @param source - Provenance label assigned to those limits.
 */
function updateGuardrailSources(sources: Record<keyof IScannerGuardrails, ScannerConfigValueSource>, overrides: IScannerConfigOverrides, source: ScannerConfigValueSource): void {
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
 * JSON configuration layers are validated; runtime overrides are assumed to be typed and valid.
 *
 * @param sources - Loaded package metadata, config-file value, and optional runtime overrides.
 * @returns Effective settings, applied-layer flags, and the winning source of each guardrail.
 * @throws {ScannerConfigError} When an embedded package or config-file configuration is invalid.
 */
export function resolveScannerConfigSources(sources: IScannerConfigSources): IResolvedScannerConfig {
	let config: IScannerConfig = DEFAULT_SCANNER_CONFIG;
	let packageJsonConfigApplied: boolean = false;
	let configFileApplied: boolean = false;
	const guardrailSources: Record<keyof IScannerGuardrails, ScannerConfigValueSource> = {
		maxFiles: 'default',
		maxFileSizeBytes: 'default'
	};

	if (sources.packageJson && typeof sources.packageJson === 'object' && !Array.isArray(sources.packageJson)) {
		const embedded: unknown = (sources.packageJson as Record<string, unknown>)[PACKAGE_JSON_CONFIG_KEY];
		if (embedded !== undefined) {
			const packageOverrides: IScannerConfigOverrides = parseScannerConfigOverrides(embedded);
			config = mergeScannerConfig(config, packageOverrides);
			updateGuardrailSources(guardrailSources, packageOverrides, 'package-json');
			packageJsonConfigApplied = true;
		}
	}

	if (sources.configFile !== undefined) {
		const configFileOverrides: IScannerConfigOverrides = parseScannerConfigOverrides(sources.configFile);
		config = mergeScannerConfig(config, configFileOverrides);
		updateGuardrailSources(guardrailSources, configFileOverrides, 'config-file');
		configFileApplied = true;
	}

	const finalOverrides: IScannerConfigOverrides = sources.overrides ?? {};
	config = mergeScannerConfig(config, finalOverrides);
	updateGuardrailSources(guardrailSources, finalOverrides, 'override');

	return { config, packageJsonConfigApplied, configFileApplied, guardrailSources };
}
