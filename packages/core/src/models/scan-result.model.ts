import { IFinding, FindingStatus } from './finding.model.js';

export interface ITranslationMatrixRow {
	key: string;
	values: Record<string, string>;
	keyPresence?: Record<string, boolean>;
	placeholders?: Record<string, string[]>;
}

export interface ITranslationMatrix {
	locales: string[];
	rows: ITranslationMatrixRow[];
	totalKeys: number;
}

export interface IScanSummary {
	totalKeys: number;
	used: number;
	unused: number;
	dynamicOrUncertain: number;
	indirectUncertain: number;
	missingInLanguage: number;
	extraInLanguage: number;
	placeholderMissing?: number;
	placeholderUncertain?: number;
	placeholderMismatch?: number;
	totalFindings: number;
}

export interface IScanError {
	code: string;
	message: string;
	filePath?: string;
}

export interface IProjectScanResult {
	projectRoot: string;
	adapterId: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	summary: IScanSummary;
	findings: IFinding[];
	errors: IScanError[];
	translationMatrix?: ITranslationMatrix;
	metadata?: Record<string, unknown>;
}

export function createEmptyScanSummary(): IScanSummary {
	return {
		totalKeys: 0,
		used: 0,
		unused: 0,
		dynamicOrUncertain: 0,
		indirectUncertain: 0,
		missingInLanguage: 0,
		extraInLanguage: 0,
		placeholderMissing: 0,
		placeholderUncertain: 0,
		placeholderMismatch: 0,
		totalFindings: 0
	};
}

export function buildSummary(findings: IFinding[], totalKeys: number): IScanSummary {
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

		if (status === 'indirect-uncertain') {
			summary.dynamicOrUncertain += 1;
			summary.indirectUncertain += 1;
			continue;
		}

		if (status === 'missing-in-language') {
			summary.missingInLanguage += 1;
			continue;
		}

		if (status === 'extra-in-language') {
			summary.extraInLanguage += 1;
			continue;
		}

		if (status === 'placeholder-missing') {
			summary.placeholderMissing = (summary.placeholderMissing ?? 0) + 1;
			continue;
		}

		if (status === 'placeholder-uncertain') {
			summary.placeholderUncertain = (summary.placeholderUncertain ?? 0) + 1;
			continue;
		}

		if (status === 'placeholder-mismatch') {
			summary.placeholderMismatch = (summary.placeholderMismatch ?? 0) + 1;
		}
	}

	return summary;
}
