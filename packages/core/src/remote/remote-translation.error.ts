export type RemoteTranslationErrorCode =
	| 'network-not-allowed'
	| 'remote-fetcher-missing'
	| 'remote-environment-missing'
	| 'remote-request-limit'
	| 'remote-request-conflict'
	| 'remote-fetch-failed'
	| 'remote-http-error'
	| 'remote-timeout'
	| 'remote-redirect-error'
	| 'remote-response-too-large';

export class RemoteTranslationError extends Error {
	constructor(
		readonly code: RemoteTranslationErrorCode,
		message: string,
		options?: ErrorOptions
	) {
		super(message, options);
		this.name = 'RemoteTranslationError';
	}
}

export function redactRemoteUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.search) {
			url.search = '?[redacted]';
		}
		url.hash = '';
		return url.toString();
	} catch {
		return '[invalid URL]';
	}
}
