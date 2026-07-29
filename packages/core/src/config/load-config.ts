import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import {
	mergeScannerConfig,
	parseScannerConfigOverrides,
	ScannerConfigError,
	ScannerConfigOverrides
} from './scanner-config.js';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from './scanner-defaults.js';
import { normalizePath } from '../util/path.util.js';

export const CONFIG_FILE_NAME = 'keylint.config.json';
export const PACKAGE_JSON_CONFIG_KEY = 'keylint';

export interface LoadScannerConfigOptions {
	/** Directory the implicit config lookup starts from. */
	projectRoot: string;
	/** Explicit config file path. When set, a missing file is an error. */
	configPath?: string;
	/** Highest precedence overrides, typically parsed from CLI flags. */
	overrides?: ScannerConfigOverrides;
}

export interface LoadedScannerConfig {
	config: ScannerConfig;
	/** Normalized path of the config file that was applied, if any. */
	configFilePath?: string;
}

async function readJsonFile(filePath: string): Promise<unknown> {
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf8');
	} catch {
		return undefined;
	}

	try {
		return JSON.parse(raw) as unknown;
	} catch (error) {
		throw new ScannerConfigError(
			`Could not parse "${normalizePath(filePath)}": ${error instanceof Error ? error.message : 'invalid JSON'}`
		);
	}
}

/**
 * Resolves the effective scanner configuration.
 * Precedence: defaults < package.json["keylint"] < config file < overrides.
 * Only JSON is supported on purpose - a config file must never execute code.
 */
export async function loadScannerConfig(options: LoadScannerConfigOptions): Promise<LoadedScannerConfig> {
	const projectRoot = resolve(options.projectRoot);
	let config = DEFAULT_SCANNER_CONFIG;
	let appliedConfigFilePath: string | undefined;

	const packageJson = await readJsonFile(resolve(projectRoot, 'package.json'));
	if (packageJson && typeof packageJson === 'object' && !Array.isArray(packageJson)) {
		const embedded = (packageJson as Record<string, unknown>)[PACKAGE_JSON_CONFIG_KEY];
		if (embedded !== undefined) {
			config = mergeScannerConfig(config, parseScannerConfigOverrides(embedded));
		}
	}

	const explicitPath = options.configPath
		? isAbsolute(options.configPath)
			? options.configPath
			: resolve(process.cwd(), options.configPath)
		: undefined;
	const configFilePath = explicitPath ?? resolve(projectRoot, CONFIG_FILE_NAME);
	const fileContent = await readJsonFile(configFilePath);

	if (fileContent === undefined && explicitPath) {
		throw new ScannerConfigError(`Config file not found: ${normalizePath(explicitPath)}`);
	}

	if (fileContent !== undefined) {
		config = mergeScannerConfig(config, parseScannerConfigOverrides(fileContent));
		appliedConfigFilePath = normalizePath(configFilePath);
	}

	config = mergeScannerConfig(config, options.overrides ?? {});

	return { config, configFilePath: appliedConfigFilePath };
}
