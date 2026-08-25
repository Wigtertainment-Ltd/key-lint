import type { ITranslationSourceConfig } from '@key-lint/core';
import type { ILoaderDetectionDiagnostic, ITranslationLoaderCandidate } from '@key-lint/core/detection';

export interface IDesktopRemoteHeaderDraft {
	id: string;
	name: string;
	environmentName: string;
	value: string;
	configured: boolean;
}

export interface IDesktopTranslationSourceDraft {
	draftId: string;
	type: 'filesystem' | 'http' | 'auto-http';
	id: string;
	includeGlobs: string[];
	urlTemplate: string;
	origin: string;
	locales: string[];
	headers: IDesktopRemoteHeaderDraft[];
	configured: boolean;
	autoCandidates: IDesktopAutoHttpCandidate[];
	autoDiagnostics: ILoaderDetectionDiagnostic[];
	selectedCandidateIndex?: number;
}

export interface IDesktopAutoHttpCandidate {
	index: number;
	framework: ITranslationLoaderCandidate['framework'];
	api: ITranslationLoaderCandidate['api'];
	location: string;
	urlTemplates: string[];
	locales: string[];
	requiresOrigin: boolean;
}

export interface IRemoteScanConfirmationSource {
	order: number;
	type: 'filesystem' | 'http';
	id: string;
	urlTemplate?: string;
	origin?: string;
	locales: string[];
	headerNames: string[];
	headerEnvironmentNames: string[];
	usesInsecureHttp: boolean;
	isPrivateOrLocal: boolean;
}

export interface IRemoteScanConfirmation {
	sources: IRemoteScanConfirmationSource[];
	expectedRequestCount: number;
	hasInsecureHttp: boolean;
	hasPrivateOrLocalTarget: boolean;
}

export interface IPreparedDesktopRemoteScan {
	translationSources: ITranslationSourceConfig[];
	environment: Record<string, string>;
	confirmation: IRemoteScanConfirmation;
}
