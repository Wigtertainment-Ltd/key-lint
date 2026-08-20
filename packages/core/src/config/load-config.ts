import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { CONFIG_FILE_NAME, resolveScannerConfigSources } from './resolve-config.js';
import { normalizePath } from '../util/path.util.js';
import { ILoadedScannerConfig, ILoadScannerConfigOptions, ScannerConfigError } from './config.interfaces.js';

export { CONFIG_FILE_NAME, PACKAGE_JSON_CONFIG_KEY } from './resolve-config.js';

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
export async function loadScannerConfig(options: ILoadScannerConfigOptions): Promise<ILoadedScannerConfig> {
	const projectRoot = resolve(options.projectRoot);
	let appliedConfigFilePath: string | undefined;

	const packageJson = await readJsonFile(resolve(projectRoot, 'package.json'));

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
		appliedConfigFilePath = normalizePath(configFilePath);
	}

	const { config } = resolveScannerConfigSources({
		packageJson,
		configFile: fileContent,
		overrides: options.overrides
	});

	return { config, configFilePath: appliedConfigFilePath };
}
