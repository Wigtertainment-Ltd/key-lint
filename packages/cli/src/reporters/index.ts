import { jsonReporter } from './json.reporter.js';
import { markdownReporter } from './markdown.reporter.js';
import { IReporter, ReporterName } from './reporter.js';
import { textReporter } from './text.reporter.js';

export const REPORTERS: Record<ReporterName, IReporter> = {
	text: textReporter,
	json: jsonReporter,
	markdown: markdownReporter
};

export const REPORTER_NAMES = Object.keys(REPORTERS) as ReporterName[];

export function isReporterName(value: string): value is ReporterName {
	return (REPORTER_NAMES as string[]).includes(value);
}

export * from './json.reporter.js';
export * from './markdown.reporter.js';
export * from './reporter.js';
export * from './text.reporter.js';
