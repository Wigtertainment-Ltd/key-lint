import { ITranslationSourceConfig } from "@key-lint/core";

export interface IDesktopRemoteHeaderDraft {
	id: string;
	name: string;
	environmentName: string;
	value: string;
	configured: boolean;
}

export interface IDesktopTranslationSourceDraft {
	draftId: string;
	type: 'filesystem' | 'http';
	id: string;
	includeGlobs: string[];
	urlTemplate: string;
	locales: string[];
	headers: IDesktopRemoteHeaderDraft[];
	configured: boolean;
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
