import { RemoteTranslationError, redactRemoteUrl } from './remote-translation.error.js';
import { IRemoteTranslationFetcher, IRemoteTranslationFetchRequest, IRemoteTranslationFetchResponse } from './remote-translation.interfaces.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Parses an absolute HTTP(S) URL and rejects embedded username or password credentials.
 *
 * @param value - Initial or redirected remote translation URL.
 * @returns The validated URL object.
 * @throws {RemoteTranslationError} When the URL cannot be parsed, uses another scheme, or contains credentials.
 */
function parseHttpUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new RemoteTranslationError('remote-fetch-failed', 'Remote translation URL is invalid.', { cause: error });
	}
	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new RemoteTranslationError('remote-fetch-failed', `Remote translation URL must use HTTP or HTTPS: ${redactRemoteUrl(value)}`);
	}
	if (url.username || url.password) {
		throw new RemoteTranslationError('remote-fetch-failed', `Remote translation URL must not contain credentials: ${redactRemoteUrl(value)}`);
	}
	return url;
}

/**
 * Classifies standard credential headers and names containing API-key, token, or secret markers.
 * Matching is case-insensitive and heuristic rather than an exhaustive credential-header list.
 *
 * @param name - HTTP header name to inspect.
 * @returns Whether the header should be stripped on a cross-origin redirect.
 */
function isSensitiveHeader(name: string): boolean {
	return /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(name) ||
		/(api[-_]?key|token|secret)/i.test(name);
}

/**
 * Copies request headers, dropping recognized sensitive names when the redirect changes origin.
 *
 * @param headers - Headers of the preceding request, left unchanged.
 * @param from - Previous request URL.
 * @param to - Redirect target URL.
 * @returns A new header map suitable for the next request.
 */
function headersForRedirect(headers: Readonly<Record<string, string>>, from: URL, to: URL): Record<string, string> {
	if (from.origin === to.origin) {
		return { ...headers };
	}
	return Object.fromEntries(Object.entries(headers).filter(([name]) => !isSensitiveHeader(name)));
}

/**
 * Decodes a UTF-8 response stream while enforcing its declared and actual byte size.
 * Cancels the reader when the streamed body exceeds the limit.
 *
 * @param response - HTTP response whose body will be consumed.
 * @param maxResponseBytes - Maximum permitted body size in bytes.
 * @param url - Response URL used in redacted diagnostics.
 * @returns Decoded response text, or an empty string when no body exists.
 * @throws {RemoteTranslationError} When the declared or received body exceeds the limit.
 * @throws {Error} When stream reading or cancellation fails.
 */
async function readLimitedBody(response: Response, maxResponseBytes: number, url: string): Promise<string> {
	const declaredLength: number = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
		throw new RemoteTranslationError('remote-response-too-large', `Remote translation response from ${redactRemoteUrl(url)} exceeds ${maxResponseBytes} bytes.`);
	}
	if (!response.body) {
		return '';
	}

	const reader = (response.body as ReadableStream<Uint8Array>).getReader();
	const decoder: TextDecoder = new TextDecoder();
	let receivedBytes: number = 0;
	let body: string = '';
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		receivedBytes += chunk.value.byteLength;
		if (receivedBytes > maxResponseBytes) {
			await reader.cancel();
			throw new RemoteTranslationError('remote-response-too-large', `Remote translation response from ${redactRemoteUrl(url)} exceeds ${maxResponseBytes} bytes.`);
		}
		body += decoder.decode(chunk.value, { stream: true });
	}
	return body + decoder.decode();
}

/** Guarded Node transport used by the CLI. Redirects are handled manually. */
export class NodeRemoteTranslationFetcher implements IRemoteTranslationFetcher {
	/**
	 * Performs a GET with manual redirects, URL validation, and bounded UTF-8 response reading.
	 * Applies one timeout to the request chain and strips recognized sensitive headers across origins.
	 * Network consent is enforced by the collector rather than by this transport.
	 *
	 * @param request - URL, headers, timeout, redirect limit, and maximum response byte count.
	 * @returns Response text and the final URL after redirects; JSON is not parsed here.
	 * @throws {RemoteTranslationError} When URL validation, fetching, HTTP status, timeout, redirects, or size checks fail.
	 * @throws {Error} When another response-stream or redirect URL parsing error propagates.
	 */
	async fetch(request: IRemoteTranslationFetchRequest): Promise<IRemoteTranslationFetchResponse> {
		let currentUrl: URL = parseHttpUrl(request.url);
		let headers = { ...request.headers };
		let redirects: number = 0;
		const controller: AbortController = new AbortController();
		const timeout: NodeJS.Timeout = setTimeout(() => controller.abort(), request.timeoutMs);

		try {
			while (true) {
				let response: Response;
				try {
					response = await fetch(currentUrl, {
						method: 'GET',
						headers,
						redirect: 'manual',
						signal: controller.signal
					});
				} catch (error) {
					if (controller.signal.aborted) {
						throw new RemoteTranslationError(
							'remote-timeout',
							`Remote translation request to ${redactRemoteUrl(currentUrl.toString())} timed out after ${request.timeoutMs} ms.`,
							{ cause: error }
						);
					}
					throw new RemoteTranslationError(
						'remote-fetch-failed',
						`Remote translation request to ${redactRemoteUrl(currentUrl.toString())} failed.`,
						{ cause: error }
					);
				}

				if (REDIRECT_STATUSES.has(response.status)) {
					if (redirects >= request.maxRedirects) {
						throw new RemoteTranslationError(
							'remote-redirect-error',
							`Remote translation request exceeded ${request.maxRedirects} redirects at ${redactRemoteUrl(currentUrl.toString())}.`
						);
					}
					const location = response.headers.get('location');
					if (!location) {
						throw new RemoteTranslationError(
							'remote-redirect-error',
							`Remote translation redirect from ${redactRemoteUrl(currentUrl.toString())} has no location.`
						);
					}
					const nextUrl: URL = parseHttpUrl(new URL(location, currentUrl).toString());
					headers = headersForRedirect(headers, currentUrl, nextUrl);
					currentUrl = nextUrl;
					redirects += 1;
					continue;
				}

				if (!response.ok) {
					throw new RemoteTranslationError('remote-http-error',
						`Remote translation request to ${redactRemoteUrl(currentUrl.toString())} returned HTTP ${response.status}.`
					);
				}

				try {
					return {
						body: await readLimitedBody(response, request.maxResponseBytes, currentUrl.toString()),
						finalUrl: currentUrl.toString()
					};
				} catch (error) {
					if (controller.signal.aborted && !(error instanceof RemoteTranslationError)) {
						throw new RemoteTranslationError(
							'remote-timeout',
							`Remote translation request to ${redactRemoteUrl(currentUrl.toString())} timed out after ${request.timeoutMs} ms.`,
							{ cause: error }
						);
					}
					throw error;
				}
			}
		} finally {
			clearTimeout(timeout);
		}
	}
}
