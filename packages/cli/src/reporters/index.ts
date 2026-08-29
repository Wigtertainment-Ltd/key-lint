import { htmlReporter } from './html.reporter.js';
import { jsonReporter } from './json.reporter.js';
import { markdownReporter } from './markdown.reporter.js';
import { textReporter } from './text.reporter.js';
import type { IReporter, ReporterName } from './reporter.interfaces.js';

export const REPORTERS: Record<ReporterName, IReporter> = {
	text: textReporter,
	json: jsonReporter,
	markdown: markdownReporter,
	html: htmlReporter
};

export const REPORTER_NAMES = Object.keys(REPORTERS) as ReporterName[];

export function isReporterName(value: string): value is ReporterName {
	return (REPORTER_NAMES as string[]).includes(value);
}

export * from './html.reporter.js';
export * from './json.reporter.js';
export * from './markdown.reporter.js';
export * from './reporter.js';
export * from './text.reporter.js';
export * from './reporter.interfaces.js';
