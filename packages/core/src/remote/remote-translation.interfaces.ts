import { IScannerGuardrails } from '../config/config.interfaces.js';

export interface IRemoteTranslationFetchRequest {
	url: string;
	headers: Readonly<Record<string, string>>;
	timeoutMs: number;
	maxRedirects: number;
	maxResponseBytes: number;
}

export interface IRemoteTranslationFetchResponse {
	body: string;
	finalUrl: string;
}

/** Runtime-specific transport. Core never performs network I/O directly. */
export interface IRemoteTranslationFetcher {
	fetch(request: IRemoteTranslationFetchRequest): Promise<IRemoteTranslationFetchResponse>;
}

export interface IRemoteTranslationRuntime {
	/** Explicit runtime consent. Configuration alone never enables networking. */
	allowNetwork: boolean;
	fetcher?: IRemoteTranslationFetcher;
	environment?: Readonly<Record<string, string | undefined>>;
}

export interface IRemoteTranslationLimits {
	timeoutMs: number;
	maxRedirects: number;
	maxRequests: number;
	maxResponseBytes: IScannerGuardrails['maxFileSizeBytes'];
}

export const DEFAULT_REMOTE_TRANSLATION_LIMITS = Object.freeze({
	timeoutMs: 15_000,
	maxRedirects: 3,
	maxRequests: 100
});
