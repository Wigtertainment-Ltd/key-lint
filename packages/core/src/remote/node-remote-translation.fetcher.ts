import { RemoteTranslationError, redactRemoteUrl } from './remote-translation.error.js';
import {
	IRemoteTranslationFetcher,
	IRemoteTranslationFetchRequest,
	IRemoteTranslationFetchResponse
} from './remote-translation.interfaces.js';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function parseHttpUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch (error) {
		throw new RemoteTranslationError(
			'remote-fetch-failed',
			'Remote translation URL is invalid.',
			{ cause: error }
		);
	}
	if (!['http:', 'https:'].includes(url.protocol)) {
		throw new RemoteTranslationError(
			'remote-fetch-failed',
			`Remote translation URL must use HTTP or HTTPS: ${redactRemoteUrl(value)}`
		);
	}
	if (url.username || url.password) {
		throw new RemoteTranslationError(
			'remote-fetch-failed',
			`Remote translation URL must not contain credentials: ${redactRemoteUrl(value)}`
		);
	}
	return url;
}

function isSensitiveHeader(name: string): boolean {
	return /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(name) ||
		/(api[-_]?key|token|secret)/i.test(name);
}

function headersForRedirect(
	headers: Readonly<Record<string, string>>,
	from: URL,
	to: URL
): Record<string, string> {
	if (from.origin === to.origin) {
		return { ...headers };
	}
	return Object.fromEntries(
		Object.entries(headers).filter(([name]) => !isSensitiveHeader(name))
	);
}

async function readLimitedBody(
	response: Response,
	maxResponseBytes: number,
	url: string
): Promise<string> {
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
		throw new RemoteTranslationError(
			'remote-response-too-large',
			`Remote translation response from ${redactRemoteUrl(url)} exceeds ${maxResponseBytes} bytes.`
		);
	}
	if (!response.body) {
		return '';
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let receivedBytes = 0;
	let body = '';
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) {
			break;
		}
		receivedBytes += chunk.value.byteLength;
		if (receivedBytes > maxResponseBytes) {
			await reader.cancel();
			throw new RemoteTranslationError(
				'remote-response-too-large',
				`Remote translation response from ${redactRemoteUrl(url)} exceeds ${maxResponseBytes} bytes.`
			);
		}
		body += decoder.decode(chunk.value, { stream: true });
	}
	return body + decoder.decode();
}

/** Guarded Node transport used by the CLI. Redirects are handled manually. */
export class NodeRemoteTranslationFetcher implements IRemoteTranslationFetcher {
	async fetch(request: IRemoteTranslationFetchRequest): Promise<IRemoteTranslationFetchResponse> {
		let currentUrl = parseHttpUrl(request.url);
		let headers = { ...request.headers };
		let redirects = 0;
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

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
					const nextUrl = parseHttpUrl(new URL(location, currentUrl).toString());
					headers = headersForRedirect(headers, currentUrl, nextUrl);
					currentUrl = nextUrl;
					redirects += 1;
					continue;
				}

				if (!response.ok) {
					throw new RemoteTranslationError(
						'remote-http-error',
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
