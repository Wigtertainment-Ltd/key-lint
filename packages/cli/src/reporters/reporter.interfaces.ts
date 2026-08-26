import { IProjectScanResult } from '@key-lint/core';

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
	/** Runtime-only credential values removed after reporter formatting. */
	sensitiveValues?: readonly string[];
}

export interface IReporter {
	name: ReporterName;
	format(result: IProjectScanResult, context: IReporterContext): string;
}

export type ReporterName = 'text' | 'json' | 'markdown';

export interface ISeverityCounts {
	error: number;
	warning: number;
	info: number;
}
