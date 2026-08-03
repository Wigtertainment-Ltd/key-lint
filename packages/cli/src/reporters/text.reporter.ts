import { Finding, ProjectScanResult } from '@key-lint/core';

import { IReporter, IReporterContext, severityRank } from './reporter.js';

const ANSI = {
	reset: '\u001B[0m',
	bold: '\u001B[1m',
	dim: '\u001B[2m',
	red: '\u001B[31m',
	yellow: '\u001B[33m',
	cyan: '\u001B[36m'
};

function paint(text: string, code: string, color: boolean): string {
	return color ? `${code}${text}${ANSI.reset}` : text;
}

function formatLocation(finding: Finding): string {
	const evidence = finding.evidence[0];
	if (!evidence) {
		return '';
	}

	const position = [evidence.line, evidence.column].filter((value) => value !== undefined).join(':');

	return position ? `${evidence.filePath}:${position}` : evidence.filePath;
}

export const textReporter: IReporter = {
	name: 'text',
	format(result: ProjectScanResult, context: IReporterContext): string {
		const { color } = context;
		const lines: string[] = [];

		lines.push(paint(`KeyLint scan: ${result.projectRoot}`, ANSI.bold, color));
		lines.push(
			paint(
				`adapter=${result.adapterId}  duration=${result.durationMs}ms  keys=${result.summary.totalKeys}`,
				ANSI.dim,
				color
			)
		);

		if (context.configFilePath) {
			lines.push(paint(`config: ${context.configFilePath}`, ANSI.dim, color));
		}

		lines.push('');

		const reportable = result.findings
			.filter((finding) => finding.severity !== 'info')
			.sort(
				(a, b) => severityRank(a.severity) - severityRank(b.severity) || a.key.localeCompare(b.key)
			);

		if (reportable.length === 0) {
			lines.push('No errors or warnings found.');
		}

		for (const finding of reportable) {
			const severityLabel =
				finding.severity === 'error'
					? paint('error  ', ANSI.red, color)
					: paint('warning', ANSI.yellow, color);
			const location = formatLocation(finding);
			lines.push(`  ${severityLabel}  ${finding.message}`);
			if (location) {
				lines.push(`           ${paint(location, ANSI.cyan, color)}`);
			}
		}

		lines.push('');
		lines.push(
			[
				`used: ${result.summary.used}`,
				`unused: ${result.summary.unused}`,
				`missing: ${result.summary.missingInLanguage}`,
				`extra: ${result.summary.extraInLanguage}`,
				`dynamic: ${result.summary.dynamicOrUncertain}`
			].join('  |  ')
		);
		lines.push(
			`${context.counts.error} error(s), ${context.counts.warning} warning(s) ` +
			`(limits: errors=${context.thresholds.maxErrors}, ` +
			`warnings=${context.thresholds.maxWarnings < 0 ? 'unlimited' : context.thresholds.maxWarnings})`
		);

		for (const warning of context.warnings) {
			lines.push(paint(`! ${warning}`, ANSI.yellow, color));
		}

		return lines.join('\n');
	}
};
