import { IFinding, IProjectScanResult } from '@key-lint/core';

import { IReporter, IReporterContext } from './reporter.js';

const MAX_LISTED_FINDINGS = 50;

function escapeCell(value: string): string {
	return value
		// Escape every pipe so it cannot terminate the current Markdown table cell.
		.replace(/\|/g, '\\|')
		// Replace both Unix and Windows line endings so one value stays on a single table row.
		.replace(/\r?\n/g, ' ');
}

function locationOf(finding: IFinding): string {
	const evidence = finding.evidence[0];
	if (!evidence) {
		return '-';
	}

	return evidence.line ? `${evidence.filePath}:${evidence.line}` : evidence.filePath;
}

export const markdownReporter: IReporter = {
	name: 'markdown',
	format(result: IProjectScanResult, context: IReporterContext): string {
		const lines: string[] = [];
		const warningsExceeded =
			context.thresholds.maxWarnings >= 0 && context.counts.warning > context.thresholds.maxWarnings;
		const status =
			context.counts.error > context.thresholds.maxErrors || warningsExceeded ? 'failed' : 'passed';

		lines.push('## KeyLint');
		lines.push('');
		lines.push(`**Result:** ${status} - adapter \`${result.adapterId}\` - ${result.durationMs} ms`);
		const baseLocale = result.metadata?.['baseLocale'];
		if (typeof baseLocale === 'string') {
			lines.push(`**Base locale:** \`${escapeCell(baseLocale)}\``);
		}
		lines.push('');
		lines.push('| Metric | Count |');
		lines.push('| --- | ---: |');
		lines.push(`| Translation keys | ${result.summary.totalKeys} |`);
		lines.push(`| Used | ${result.summary.used} |`);
		lines.push(`| Missing in language | ${result.summary.missingInLanguage} |`);
		lines.push(`| Unused | ${result.summary.unused} |`);
		lines.push(`| Extra in language | ${result.summary.extraInLanguage} |`);
		lines.push(`| Dynamic / uncertain | ${result.summary.dynamicOrUncertain} |`);
		lines.push(`| Errors | ${context.counts.error} |`);
		lines.push(`| Warnings | ${context.counts.warning} |`);
		lines.push('');

		const reportable = result.findings.filter((finding) => finding.severity === 'error');
		if (reportable.length > 0) {
			lines.push('### Errors');
			lines.push('');
			lines.push('| Key | Locale | Message | Location |');
			lines.push('| --- | --- | --- | --- |');
			for (const finding of reportable.slice(0, MAX_LISTED_FINDINGS)) {
				lines.push(
					`| \`${escapeCell(finding.key)}\` | ${escapeCell(finding.language ?? '-')} | ${escapeCell(finding.message)} | ${escapeCell(locationOf(finding))} |`
				);
			}

			if (reportable.length > MAX_LISTED_FINDINGS) {
				lines.push('');
				lines.push(`_... and ${reportable.length - MAX_LISTED_FINDINGS} more._`);
			}

			lines.push('');
		}

		const warningFindings = result.findings.filter((finding) => finding.severity === 'warning');
		if (warningFindings.length > 0) {
			lines.push('### Warnings');
			lines.push('');
			lines.push('| Key | Locale | Message | Location |');
			lines.push('| --- | --- | --- | --- |');
			for (const finding of warningFindings.slice(0, MAX_LISTED_FINDINGS)) {
				lines.push(
					`| \`${escapeCell(finding.key)}\` | ${escapeCell(finding.language ?? '-')} | ${escapeCell(finding.message)} | ${escapeCell(locationOf(finding))} |`
				);
			}
			if (warningFindings.length > MAX_LISTED_FINDINGS) {
				lines.push('');
				lines.push(`_... and ${warningFindings.length - MAX_LISTED_FINDINGS} more._`);
			}
			lines.push('');
		}

		if (context.warnings.length > 0) {
			lines.push('### Scan warnings');
			lines.push('');
			for (const warning of context.warnings) {
				lines.push(`- ${warning}`);
			}
			lines.push('');
		}

		return `${lines.join('\n')}\n`;
	}
};
