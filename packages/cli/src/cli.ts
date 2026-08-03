import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { normalizePath, ProjectScanResult, runScan, ScannerConfigError } from '@key-lint/core';
import { loadScannerConfig, NodeFileSystemAdapter } from '@key-lint/core/node';

import { ICliOptions, CliUsageError, parseCliArgs, USAGE } from './args.js';
import { EXIT_OK, EXIT_THRESHOLD_EXCEEDED, EXIT_USAGE_OR_RUNTIME_ERROR } from './exit-codes.js';
import { countSeverities, REPORTERS, IReporterContext } from './reporters/index.js';

export interface ICliIo {
	stdout(text: string): void;
	stderr(text: string): void;
	writeFile(filePath: string, content: string): Promise<void>;
}

const defaultIo: ICliIo = {
	stdout: (text) => process.stdout.write(text),
	stderr: (text) => process.stderr.write(text),
	writeFile: async (filePath, content) => {
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, content, 'utf8');
	}
};

async function readVersion(): Promise<string> {
	try {
		const raw = await readFile(new URL('../package.json', import.meta.url), 'utf8');
		return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
	} catch {
		return '0.0.0';
	}
}

async function assertDirectory(projectRoot: string): Promise<void> {
	let stats;
	try {
		stats = await stat(projectRoot);
	} catch {
		throw new CliUsageError(`Project path does not exist: ${normalizePath(projectRoot)}`);
	}

	if (!stats.isDirectory()) {
		throw new CliUsageError(`Project path is not a directory: ${normalizePath(projectRoot)}`);
	}
}

function determineExitCode(options: ICliOptions, errors: number, warnings: number): number {
	if (errors > options.maxErrors) {
		return EXIT_THRESHOLD_EXCEEDED;
	}

	if (options.maxWarnings >= 0 && warnings > options.maxWarnings) {
		return EXIT_THRESHOLD_EXCEEDED;
	}

	return EXIT_OK;
}

async function emitReports(options: ICliOptions, result: ProjectScanResult, context: IReporterContext, io: ICliIo): Promise<void> {
	for (const name of options.reporters) {
		const targetFile = options.outputs.get(name);
		const output = REPORTERS[name].format(result, {
			...context,
			color: context.color && !targetFile
		});

		if (targetFile) {
			await io.writeFile(resolve(targetFile), output.endsWith('\n') ? output : `${output}\n`);
			continue;
		}

		io.stdout(output.endsWith('\n') ? output : `${output}\n`);
	}
}

export async function runCli(argv: string[], io: ICliIo = defaultIo): Promise<number> {
	let options: ICliOptions;

	try {
		options = parseCliArgs(argv);
	} catch (error) {
		io.stderr(`${error instanceof Error ? error.message : 'Invalid arguments.'}\n\n${USAGE}\n`);
		return EXIT_USAGE_OR_RUNTIME_ERROR;
	}

	if (options.command === 'help') {
		io.stdout(`${USAGE}\n`);
		return EXIT_OK;
	}

	if (options.command === 'version') {
		io.stdout(`${await readVersion()}\n`);
		return EXIT_OK;
	}

	try {
		const projectRoot = resolve(process.cwd(), options.projectPath);
		await assertDirectory(projectRoot);

		const { config, configFilePath } = await loadScannerConfig({
			projectRoot,
			configPath: options.configPath,
			overrides: options.ignoreKeys.length > 0 ? { ignoreKeys: options.ignoreKeys } : {}
		});

		const fs = new NodeFileSystemAdapter(config.guardrails);
		const result = await runScan({
			projectRoot,
			fs,
			config,
			onProgress: (progress) => {
				if (!options.quiet) {
					io.stderr(`${progress.message}\n`);
				}
			}
		});

		const counts = countSeverities(result.findings);
		const context: IReporterContext = {
			configFilePath,
			warnings: fs.warnings.map((warning) =>
				warning.filePath ? `${warning.filePath}: ${warning.message}` : warning.message
			),
			color: options.color,
			thresholds: { maxErrors: options.maxErrors, maxWarnings: options.maxWarnings },
			counts
		};

		await emitReports(options, result, context, io);

		return determineExitCode(options, counts.error, counts.warning);
	} catch (error) {
		if (error instanceof CliUsageError || error instanceof ScannerConfigError) {
			io.stderr(`${error.message}\n`);
			return EXIT_USAGE_OR_RUNTIME_ERROR;
		}

		io.stderr(`${error instanceof Error ? error.message : 'Unknown error during scan.'}\n`);
		return EXIT_USAGE_OR_RUNTIME_ERROR;
	}
}
