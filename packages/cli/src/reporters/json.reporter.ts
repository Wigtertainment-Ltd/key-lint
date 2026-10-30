import { IProjectScanResult, IPlaceholderFindingDetails, IFinding, IFileEvidence } from '@key-lint/core';
import type { IReporter, IReporterContext, ISeverityCounts } from './reporter.interfaces.js';

interface IJsonReportEvidence {
	filePath: string;
	line: number | null;
	column: number | null;
	matchType: string | null;
	snippet: string | null;
}

interface IJsonReportFinding extends Omit<IFinding, 'adapterId' | 'language' | 'placeholderDetails' | 'evidence'> {
	language: string | null;
	placeholderDetails: IPlaceholderFindingDetails | null;
	evidence: IJsonReportEvidence[];
}

interface IJsonReport extends Pick<IProjectScanResult, 'projectRoot' | 'adapterId' | 'startedAt' | 'finishedAt' | 'durationMs' | 'summary'> {
	schemaVersion: number;
	severityCounts: ISeverityCounts;
	thresholds: IReporterContext['thresholds'];
	configFilePath: string | null;
	warnings: string[];
	metadata: Record<string, unknown>;
	findings: IJsonReportFinding[];
}

export const JSON_REPORT_SCHEMA_VERSION: number = 2;

/**
 * Machine readable report. The translation matrix is intentionally omitted:
 * it can grow to megabytes on large projects and is not actionable in a pipeline.
 */
export const jsonReporter: IReporter = {
	name: 'json',
	format(result: IProjectScanResult, context: IReporterContext): string {
		const payload: IJsonReport = {
			schemaVersion: JSON_REPORT_SCHEMA_VERSION,
			projectRoot: result.projectRoot,
			adapterId: result.adapterId,
			startedAt: result.startedAt,
			finishedAt: result.finishedAt,
			durationMs: result.durationMs,
			summary: result.summary,
			severityCounts: context.counts,
			thresholds: context.thresholds,
			configFilePath: context.configFilePath ?? null,
			warnings: context.warnings,
			metadata: result.metadata ?? {},
			findings: [...result.findings]
				.sort((a: IFinding, b: IFinding): number => a.id.localeCompare(b.id))
				.map((finding: IFinding): IJsonReportFinding => ({
					id: finding.id,
					key: finding.key,
					status: finding.status,
					severity: finding.severity,
					message: finding.message,
					language: finding.language ?? null,
					placeholderDetails: finding.placeholderDetails ?? null,
					evidence: finding.evidence.map((entry: IFileEvidence): IJsonReportEvidence => ({
						filePath: entry.filePath,
						line: entry.line ?? null,
						column: entry.column ?? null,
						matchType: entry.matchType ?? null,
						snippet: entry.snippet ?? null
					}))
				}))
		};

		return `${JSON.stringify(payload, null, 2)}\n`;
	}
};
