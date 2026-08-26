import { IFinding, FindingSeverity } from '@key-lint/core';
import { ISeverityCounts } from './reporter.interfaces.js';

export function countSeverities(findings: IFinding[]): ISeverityCounts {
	const counts: ISeverityCounts = { error: 0, warning: 0, info: 0 };
	for (const finding of findings) {
		counts[finding.severity] += 1;
	}

	return counts;
}

export function severityRank(severity: FindingSeverity): number {
	if (severity === 'error') {
		return 0;
	}

	return severity === 'warning' ? 1 : 2;
}

/** Removes configured runtime credential values from every user-visible reporter surface. */
export function redactReporterText(text: string, sensitiveValues: readonly string[]): string {
	return [...new Set(sensitiveValues)]
		.filter((value) => value.length > 0)
		.sort((left, right) => right.length - left.length)
		.reduce((redacted, value) => redacted.split(value).join('[redacted]'), text);
}
