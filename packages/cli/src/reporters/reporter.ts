import { Finding, FindingSeverity, ProjectScanResult } from '@key-lint/core';

export interface IReporterContext {
	/** Effective config file that was applied, if any. */
	configFilePath?: string;
	/** Warnings collected by the filesystem adapter (skipped files, guardrails). */
	warnings: string[];
	/** ANSI colors are allowed for this output target. */
	color: boolean;
	thresholds: {
		maxErrors: number;
		maxWarnings: number;
	};
	counts: ISeverityCounts;
}

export interface IReporter {
	name: ReporterName;
	format(result: ProjectScanResult, context: IReporterContext): string;
}

export type ReporterName = 'text' | 'json' | 'markdown';

export interface ISeverityCounts {
	error: number;
	warning: number;
	info: number;
}

export function countSeverities(findings: Finding[]): ISeverityCounts {
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
