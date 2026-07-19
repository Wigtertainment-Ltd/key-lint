export type ProjectHistoryEventType =
	| 'scan-started'
	| 'scan-completed'
	| 'translation-key-added';

export type TranslationEventSource = 'translation-keys' | 'results-overview' | 'unknown';

export interface ScanStartedHistoryPayload {
	requestedProjectRoot: string;
}

export interface ScanCompletedHistoryPayload {
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
}

export interface TranslationKeyAddedHistoryPayload {
	locale: string;
	key: string;
	filePath: string;
	valueWasEmpty: boolean;
	source: TranslationEventSource;
}

export type ProjectHistoryPayload =
	| ScanStartedHistoryPayload
	| ScanCompletedHistoryPayload
	| TranslationKeyAddedHistoryPayload;

export interface ProjectHistoryEvent {
	id: string;
	projectPath: string;
	timestamp: string;
	type: ProjectHistoryEventType;
	payload: ProjectHistoryPayload;
}
