import { Finding, FindingStatus } from './finding.model';

export interface TranslationMatrixRow {
	key: string;
	values: Record<string, string>;
	keyPresence?: Record<string, boolean>;
}

export interface TranslationMatrix {
	locales: string[];
	rows: TranslationMatrixRow[];
	totalKeys: number;
}

export interface ScanSummary {
	totalKeys: number;
	used: number;
	unused: number;
	dynamicOrUncertain: number;
	missingInLanguage: number;
	extraInLanguage: number;
	totalFindings: number;
}

export interface ScanError {
	code: string;
	message: string;
	filePath?: string;
}

export interface ProjectScanResult {
	projectRoot: string;
	adapterId: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	summary: ScanSummary;
	findings: Finding[];
	errors: ScanError[];
	translationMatrix?: TranslationMatrix;
	metadata?: Record<string, unknown>;
}

export function createEmptyScanSummary(): ScanSummary {
	return {
		totalKeys: 0,
		used: 0,
		unused: 0,
		dynamicOrUncertain: 0,
		missingInLanguage: 0,
		extraInLanguage: 0,
		totalFindings: 0
	};
}

export function buildSummary(findings: Finding[], totalKeys: number): ScanSummary {
	const summary = createEmptyScanSummary();
	summary.totalKeys = totalKeys;
	summary.totalFindings = findings.length;

	for (const finding of findings) {
		const status: FindingStatus = finding.status;

		if (status === 'used') {
			summary.used += 1;
			continue;
		}

		if (status === 'unused') {
			summary.unused += 1;
			continue;
		}

		if (status === 'dynamic-uncertain') {
			summary.dynamicOrUncertain += 1;
			continue;
		}

		if (status === 'missing-in-language') {
			summary.missingInLanguage += 1;
			continue;
		}

		if (status === 'extra-in-language') {
			summary.extraInLanguage += 1;
		}
	}

	return summary;
}
