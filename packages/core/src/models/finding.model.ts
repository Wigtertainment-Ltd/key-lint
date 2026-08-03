export type FindingStatus =
	| 'used'
	| 'unused'
	| 'dynamic-uncertain'
	| 'indirect-uncertain'
	| 'missing-in-language'
	| 'extra-in-language';

export type FindingSeverity = 'info' | 'warning' | 'error';

export interface IFileEvidence {
	filePath: string;
	line?: number;
	column?: number;
	snippet?: string;
	matchType?: string;
}

export interface IFinding {
	id: string;
	adapterId: string;
	key: string;
	status: FindingStatus;
	severity: FindingSeverity;
	message: string;
	language?: string;
	evidence: IFileEvidence[];
}
