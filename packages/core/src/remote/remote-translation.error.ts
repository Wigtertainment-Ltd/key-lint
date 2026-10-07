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
	| 'remote-response-too-large'
	| 'remote-invalid-request'
	| 'remote-invalid-json'
	| 'remote-invalid-root';

export class RemoteTranslationError extends Error {
	/**
	 * Creates a categorized remote-translation error with an optional underlying cause.
	 *
	 * @param code - Machine-readable remote failure category.
	 * @param message - Diagnostic text supplied by the caller; not automatically redacted.
	 * @param options - Standard error options, including an optional original cause.
	 */
	constructor(readonly code: RemoteTranslationErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RemoteTranslationError';
	}
}

/**
 * Replaces an entire URL query with a redaction marker and removes its fragment.
 * Preserves the URL's other components, including any user information; this is not credential validation.
 *
 * @param value - Absolute URL to sanitize for diagnostics.
 * @returns The serialized URL with query redaction, or `[invalid URL]` if parsing fails.
 */
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
