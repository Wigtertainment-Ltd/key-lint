import { parseArgs } from 'node:util';
import { isReporterName, REPORTER_NAMES, ReporterName } from './reporters/index.js';
import { CliUsageError, ICliOptions } from './cli.interfaces.js';

export const USAGE = `keylint - i18n key audit for CI/CD pipelines

Usage:
  keylint scan [path] [options]

Options:
  --config <file>          Path to a keylint.config.json file
  --reporter <name>        Reporter to run, repeatable (${REPORTER_NAMES.join(', ')}; default: text)
  --output <name>=<file>   Write the given reporter to a file instead of stdout, repeatable
  --max-errors <n>         Allowed error findings before failing (default: 0)
  --max-warnings <n>       Allowed warning findings before failing (default: unlimited)
  --ignore <glob>          Translation key glob to ignore, repeatable
  --quiet                  Suppress progress output on stderr
  --no-color               Disable ANSI colors
  -h, --help               Show this help
  -v, --version            Show the CLI version

Exit codes:
  0  thresholds respected
  1  thresholds exceeded
  2  usage, configuration or runtime error`;

function parseCount(raw: string | undefined, flag: string, fallback: number): number {
	if (raw === undefined) {
		return fallback;
	}

	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new CliUsageError(`${flag} must be a non-negative integer.`);
	}

	return value;
}

export function parseCliArgs(argv: string[]): ICliOptions {
	const color = !argv.includes('--no-color') && process.env['NO_COLOR'] === undefined;
	const args = argv.filter((arg) => arg !== '--no-color');

	let parsed;
	try {
		parsed = parseArgs({
			args,
			allowPositionals: true,
			options: {
				config: { type: 'string' },
				reporter: { type: 'string', multiple: true },
				output: { type: 'string', multiple: true },
				'max-errors': { type: 'string' },
				'max-warnings': { type: 'string' },
				ignore: { type: 'string', multiple: true },
				quiet: { type: 'boolean' },
				help: { type: 'boolean', short: 'h' },
				version: { type: 'boolean', short: 'v' }
			}
		});
	} catch (error) {
		throw new CliUsageError(error instanceof Error ? error.message : 'Invalid arguments.');
	}

	const values = parsed.values;
	const positionals = parsed.positionals;

	const base: ICliOptions = {
		command: 'scan',
		projectPath: '.',
		reporters: [],
		outputs: new Map<ReporterName, string>(),
		maxErrors: 0,
		maxWarnings: -1,
		ignoreKeys: [],
		quiet: Boolean(values.quiet),
		color
	};

	if (values.help) {
		return { ...base, command: 'help' };
	}

	if (values.version) {
		return { ...base, command: 'version' };
	}

	const [first, second, ...rest] = positionals;
	if (rest.length > 0) {
		throw new CliUsageError(`Unexpected argument "${rest[0]}".`);
	}

	if (first !== undefined && first !== 'scan') {
		throw new CliUsageError(`Unknown command "${first}". Did you mean "scan"?`);
	}

	const outputs = new Map<ReporterName, string>();
	for (const entry of values.output ?? []) {
		const separatorIndex = entry.indexOf('=');
		if (separatorIndex <= 0) {
			throw new CliUsageError(`--output expects "<reporter>=<file>", received "${entry}".`);
		}

		const name = entry.slice(0, separatorIndex);
		const file = entry.slice(separatorIndex + 1);
		if (!isReporterName(name)) {
			throw new CliUsageError(`Unknown reporter "${name}". Available: ${REPORTER_NAMES.join(', ')}.`);
		}

		if (!file) {
			throw new CliUsageError(`--output for reporter "${name}" is missing a file path.`);
		}

		outputs.set(name, file);
	}

	const reporters: ReporterName[] = [];
	for (const name of values.reporter ?? []) {
		if (!isReporterName(name)) {
			throw new CliUsageError(`Unknown reporter "${name}". Available: ${REPORTER_NAMES.join(', ')}.`);
		}

		if (!reporters.includes(name)) {
			reporters.push(name);
		}
	}

	for (const name of outputs.keys()) {
		if (!reporters.includes(name)) {
			reporters.push(name);
		}
	}

	if (reporters.length === 0) {
		reporters.push('text');
	}

	return {
		...base,
		projectPath: second ?? '.',
		configPath: values.config,
		reporters,
		outputs,
		maxErrors: parseCount(values['max-errors'], '--max-errors', 0),
		maxWarnings: parseCount(values['max-warnings'], '--max-warnings', -1),
		ignoreKeys: values.ignore ?? []
	};
}
