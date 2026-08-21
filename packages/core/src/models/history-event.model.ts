export type ProjectHistoryEventType = 'scan-started' | 'scan-completed' | 'translation-key-added';

export type TranslationEventSource = 'translation-keys' | 'results-overview' | 'unknown';

export interface IScanStartedHistoryPayload {
	requestedProjectRoot: string;
}

export interface IScanCompletedHistoryPayload {
	adapterId: string;
	durationMs: number;
	totalFindings: number;
	totalKeys: number;
	localeCount: number;
	missingCount?: number;
	unusedCount?: number;
	usedCount?: number;
	dynamicCount?: number;
	extraCount?: number;
	placeholderIssueCount?: number;
}

export interface ITranslationKeyAddedHistoryPayload {
	locale: string;
	key: string;
	filePath: string;
	valueWasEmpty: boolean;
	source: TranslationEventSource;
}

export type ProjectHistoryPayload = IScanStartedHistoryPayload | IScanCompletedHistoryPayload | ITranslationKeyAddedHistoryPayload;

export interface IProjectHistoryEvent {
	id: string;
	projectPath: string;
	timestamp: string;
	type: ProjectHistoryEventType;
	payload: ProjectHistoryPayload;
}
