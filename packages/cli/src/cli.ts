import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { normalizePath, IProjectScanResult, redactAutoHttpUrlTemplate, runScan, ScannerConfigError, ILoadedScannerConfig, IScannerConfig, IExpandedAutoHttpSources, IAutoHttpProjectAnalysis } from '@key-lint/core';
import { analyzeProjectTranslationLoaders, expandAutoHttpTranslationSources, formatAutoHttpCandidate } from '@key-lint/core/detection';
import { loadScannerConfig, NodeFileSystemAdapter, NodeRemoteTranslationFetcher } from '@key-lint/core/node';

import { parseCliArgs, USAGE } from './args.js';
import { EXIT_OK, EXIT_THRESHOLD_EXCEEDED, EXIT_USAGE_OR_RUNTIME_ERROR } from './exit-codes.js';
import { countSeverities, redactReporterText, REPORTERS, IReporterContext, ISeverityCounts } from './reporters/index.js';
import { ICliIo, ICliOptions, CliUsageError } from './cli.interfaces.js';

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
		const raw: string = await readFile(new URL('../package.json', import.meta.url), 'utf8');
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

async function emitReports(options: ICliOptions, result: IProjectScanResult, context: IReporterContext, io: ICliIo): Promise<void> {
	for (const name of options.reporters) {
		const targetFile: string | undefined = options.outputs.get(name);
		const output: string = redactReporterText(REPORTERS[name].format(result, {
			...context,
			color: context.color && !targetFile
		}), context.sensitiveValues ?? []);

		if (targetFile) {
			await io.writeFile(resolve(targetFile), output.endsWith('\n') ? output : `${output}\n`);
			continue;
		}

		io.stdout(output.endsWith('\n') ? output : `${output}\n`);
	}
}

export async function runCli(argv: string[], io: ICliIo = defaultIo): Promise<number> {
	let options: ICliOptions;
	let sensitiveValues: string[] = [];

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
		const projectRoot: string = resolve(process.cwd(), options.projectPath);
		await assertDirectory(projectRoot);

		const loaded: ILoadedScannerConfig = await loadScannerConfig({
			projectRoot,
			configPath: options.configPath,
			overrides: options.ignoreKeys.length > 0 ? { ignoreKeys: options.ignoreKeys } : {}
		});
		let config: IScannerConfig = loaded.config;
		const configFilePath: string | undefined = loaded.configFilePath;
		const fs: NodeFileSystemAdapter = new NodeFileSystemAdapter(config.guardrails);
		let detectedLoaderTypes: ('ngx-translate' | 'transloco')[] = [];
		if (config.translationSources?.some((source) => source.type === 'auto-http')) {
			if (!options.allowNetwork) {
				throw new CliUsageError('auto-http translation sources require --allow-network. No request was made.');
			}
			const analysis: IAutoHttpProjectAnalysis = await analyzeProjectTranslationLoaders(projectRoot, fs, config);
			const expanded: IExpandedAutoHttpSources = expandAutoHttpTranslationSources(config.translationSources, analysis);
			config = { ...config, translationSources: expanded.translationSources };
			detectedLoaderTypes = [...new Set(expanded.resolved.map((item) => item.candidate.framework))];
			for (const resolved of expanded.resolved) {
				io.stderr(`Resolved auto-http source ${resolved.sourceIndex + 1}: ${formatAutoHttpCandidate(resolved.candidate, resolved.candidateIndex)}\n`);
				io.stderr(`Locales: ${resolved.sources[0]?.locales.join(', ')}; endpoints: ${resolved.sources.map((source) => redactAutoHttpUrlTemplate(source.urlTemplate)).join(', ')}\n`);
			}
		}
		sensitiveValues = (config.translationSources ?? [])
			.filter((source) => source.type === 'http')
			.flatMap((source) => Object.values(source.headersFromEnv ?? {}))
			.map((environmentName) => process.env[environmentName])
			.filter((value): value is string => typeof value === 'string' && value.length > 0);
		const remoteTranslations = {
			allowNetwork: options.allowNetwork,
			fetcher: options.allowNetwork ? new NodeRemoteTranslationFetcher() : undefined,
			environment: process.env
		};
		const result: IProjectScanResult = await runScan({
			projectRoot,
			fs,
			config,
			remoteTranslations,
			detectedLoaderTypes,
			onProgress: (progress) => {
				if (!options.quiet) {
					io.stderr(`${progress.message}\n`);
				}
			}
		});

		const counts: ISeverityCounts = countSeverities(result.findings);
		const context: IReporterContext = {
			configFilePath,
			warnings: fs.warnings.map((warning) =>
				warning.filePath ? `${warning.filePath}: ${warning.message}` : warning.message
			),
			color: options.color,
			thresholds: { maxErrors: options.maxErrors, maxWarnings: options.maxWarnings },
			counts,
			sensitiveValues
		};

		await emitReports(options, result, context, io);

		return determineExitCode(options, counts.error, counts.warning);
	} catch (error) {
		if (error instanceof CliUsageError || error instanceof ScannerConfigError) {
			io.stderr(`${redactReporterText(error.message, sensitiveValues)}\n`);
			return EXIT_USAGE_OR_RUNTIME_ERROR;
		}

		io.stderr(`${redactReporterText(error instanceof Error ? error.message : 'Unknown error during scan.', sensitiveValues)}\n`);
		return EXIT_USAGE_OR_RUNTIME_ERROR;
	}
}
