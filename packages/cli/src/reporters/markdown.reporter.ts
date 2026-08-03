import { IFinding, IProjectScanResult } from '@key-lint/core';

import { IReporter, IReporterContext } from './reporter.js';

const MAX_LISTED_FINDINGS = 50;

function escapeCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
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
		const status = context.counts.error > context.thresholds.maxErrors ? 'failed' : 'passed';

		lines.push('## KeyLint');
		lines.push('');
		lines.push(`**Result:** ${status} - adapter \`${result.adapterId}\` - ${result.durationMs} ms`);
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
			lines.push('| Key | Message | Location |');
			lines.push('| --- | --- | --- |');
			for (const finding of reportable.slice(0, MAX_LISTED_FINDINGS)) {
				lines.push(
					`| \`${escapeCell(finding.key)}\` | ${escapeCell(finding.message)} | ${escapeCell(locationOf(finding))} |`
				);
			}

			if (reportable.length > MAX_LISTED_FINDINGS) {
				lines.push('');
				lines.push(`_... and ${reportable.length - MAX_LISTED_FINDINGS} more._`);
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
