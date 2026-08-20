import { IProjectScanResult } from '@key-lint/core';
import type { IReporter, IReporterContext } from './reporter.interfaces.js';

export const JSON_REPORT_SCHEMA_VERSION = 1;

/**
 * Machine readable report. The translation matrix is intentionally omitted:
 * it can grow to megabytes on large projects and is not actionable in a pipeline.
 */
export const jsonReporter: IReporter = {
	name: 'json',
	format(result: IProjectScanResult, context: IReporterContext): string {
		const payload = {
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
				.sort((a, b) => a.id.localeCompare(b.id))
				.map((finding) => ({
					id: finding.id,
					key: finding.key,
					status: finding.status,
					severity: finding.severity,
					message: finding.message,
					language: finding.language ?? null,
					evidence: finding.evidence.map((entry) => ({
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
