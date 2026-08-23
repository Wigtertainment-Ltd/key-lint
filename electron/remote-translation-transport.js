const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;
const MAX_REQUESTS_PER_SCAN = 100;
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const REQUEST_KEYS = new Set([
	'scanId',
	'method',
	'url',
	'headers',
	'timeoutMs',
	'maxRedirects',
	'maxResponseBytes'
]);

class TranslationTransportError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'TranslationTransportError';
		this.code = code;
	}
}

function redactRemoteUrl(value) {
	try {
		const url = new URL(value);
		if (url.search) url.search = '?[redacted]';
		url.hash = '';
		return url.toString();
	} catch {
		return '[invalid URL]';
	}
}

function parseHttpUrl(value) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new TranslationTransportError('remote-invalid-request', 'Remote translation URL must be a non-empty string.');
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new TranslationTransportError('remote-invalid-request', 'Remote translation URL is invalid.');
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new TranslationTransportError('remote-invalid-request', `Remote translation URL must use HTTP or HTTPS: ${redactRemoteUrl(value)}`);
	}
	if (url.username || url.password) {
		throw new TranslationTransportError('remote-invalid-request', `Remote translation URL must not contain credentials: ${redactRemoteUrl(value)}`);
	}
	return url;
}

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateHeaders(value) {
	if (!isRecord(value)) {
		throw new TranslationTransportError('remote-invalid-request', 'Remote translation headers must be an object.');
	}
	const headers = {};
	const normalizedNames = new Set();
	for (const [name, headerValue] of Object.entries(value)) {
		if (!HEADER_NAME_PATTERN.test(name)) {
			throw new TranslationTransportError('remote-invalid-request', 'Remote translation request contains an invalid header name.');
		}
		if (typeof headerValue !== 'string' || /[\r\n]/.test(headerValue)) {
			throw new TranslationTransportError('remote-invalid-request', `Remote translation header "${name}" must contain a valid string value.`);
		}
		const normalizedName = name.toLowerCase();
		if (normalizedNames.has(normalizedName)) {
			throw new TranslationTransportError('remote-invalid-request', `Remote translation request contains duplicate header name "${name}".`);
		}
		normalizedNames.add(normalizedName);
		headers[name] = headerValue;
	}
	return headers;
}

function validateRequest(value) {
	if (!isRecord(value)) {
		throw new TranslationTransportError('remote-invalid-request', 'Remote translation IPC payload must be an object.');
	}
	for (const key of Object.keys(value)) {
		if (!REQUEST_KEYS.has(key)) {
			throw new TranslationTransportError('remote-invalid-request', `Remote translation IPC payload contains unsupported field "${key}".`);
		}
	}
	if (typeof value.scanId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.scanId)) {
		throw new TranslationTransportError('remote-invalid-request', 'Remote translation scan identifier is invalid.');
	}
	if (value.method !== 'GET') {
		throw new TranslationTransportError('remote-invalid-request', 'Only GET remote translation requests are allowed.');
	}
	if (value.timeoutMs !== DEFAULT_TIMEOUT_MS || value.maxRedirects !== DEFAULT_MAX_REDIRECTS) {
		throw new TranslationTransportError('remote-invalid-request', 'Remote translation timeout or redirect limits are invalid.');
	}
	if (!Number.isInteger(value.maxResponseBytes) || value.maxResponseBytes <= 0 || value.maxResponseBytes > MAX_RESPONSE_BYTES) {
		throw new TranslationTransportError('remote-invalid-request', `Remote translation response limit must be between 1 and ${MAX_RESPONSE_BYTES} bytes.`);
	}
	return {
		scanId: value.scanId,
		url: parseHttpUrl(value.url),
		headers: validateHeaders(value.headers),
		maxResponseBytes: value.maxResponseBytes
	};
}

function isSensitiveHeader(name) {
	return /^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(name) ||
		/(api[-_]?key|token|secret)/i.test(name);
}

function headersForRedirect(headers, from, to) {
	if (from.origin === to.origin) return { ...headers };
	return Object.fromEntries(Object.entries(headers).filter(([name]) => !isSensitiveHeader(name)));
}

function headerSignature(headers) {
	return Object.entries(headers)
		.map(([name, value]) => [name.toLowerCase(), value])
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, value]) => `${name}\u0000${value}`)
		.join('\u0001');
}

async function readLimitedBody(response, maxResponseBytes, url) {
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
		throw new TranslationTransportError('remote-response-too-large', `Remote translation response from ${redactRemoteUrl(url)} exceeds ${maxResponseBytes} bytes.`);
	}
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let body = '';
	let receivedBytes = 0;
	while (true) {
		const chunk = await reader.read();
		if (chunk.done) break;
		receivedBytes += chunk.value.byteLength;
		if (receivedBytes > maxResponseBytes) {
			await reader.cancel();
			throw new TranslationTransportError('remote-response-too-large', `Remote translation response from ${redactRemoteUrl(url)} exceeds ${maxResponseBytes} bytes.`);
		}
		body += decoder.decode(chunk.value, { stream: true });
	}
	return body + decoder.decode();
}

function validateJsonBody(body, url) {
	let parsed;
	try {
		parsed = JSON.parse(body);
	} catch {
		throw new TranslationTransportError('remote-invalid-json', `Remote translation response from ${redactRemoteUrl(url)} contains invalid JSON.`);
	}
	if (!isRecord(parsed)) {
		throw new TranslationTransportError('remote-invalid-root', `Remote translation response from ${redactRemoteUrl(url)} must contain a JSON object at the root.`);
	}
}

function createRemoteTranslationTransport({
	fetchImpl = globalThis.fetch,
	setTimeoutImpl = setTimeout,
	clearTimeoutImpl = clearTimeout
} = {}) {
	if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
	const sessions = new Map();

	async function execute(request, session) {
		let currentUrl = request.url;
		let headers = { ...request.headers };
		let redirects = 0;
		const controller = new AbortController();
		session.controllers.add(controller);
		const timeout = setTimeoutImpl(() => controller.abort(), DEFAULT_TIMEOUT_MS);
		try {
			while (true) {
				let response;
				try {
					response = await fetchImpl(currentUrl, { method: 'GET', headers, redirect: 'manual', signal: controller.signal });
				} catch {
					if (controller.signal.aborted) {
						throw new TranslationTransportError('remote-timeout', `Remote translation request to ${redactRemoteUrl(currentUrl.toString())} timed out after ${DEFAULT_TIMEOUT_MS} ms.`);
					}
					throw new TranslationTransportError('remote-fetch-failed', `Remote translation request to ${redactRemoteUrl(currentUrl.toString())} failed.`);
				}

				if (REDIRECT_STATUSES.has(response.status)) {
					if (redirects >= DEFAULT_MAX_REDIRECTS) {
						throw new TranslationTransportError('remote-redirect-error', `Remote translation request exceeded ${DEFAULT_MAX_REDIRECTS} redirects at ${redactRemoteUrl(currentUrl.toString())}.`);
					}
					const location = response.headers.get('location');
					if (!location) throw new TranslationTransportError('remote-redirect-error', `Remote translation redirect from ${redactRemoteUrl(currentUrl.toString())} has no location.`);
					let nextUrl;
					try {
						nextUrl = parseHttpUrl(new URL(location, currentUrl).toString());
					} catch {
						throw new TranslationTransportError('remote-redirect-error', `Remote translation redirect from ${redactRemoteUrl(currentUrl.toString())} has an invalid target.`);
					}
					headers = headersForRedirect(headers, currentUrl, nextUrl);
					currentUrl = nextUrl;
					redirects += 1;
					continue;
				}

				if (!response.ok) {
					throw new TranslationTransportError('remote-http-error', `Remote translation request to ${redactRemoteUrl(currentUrl.toString())} returned HTTP ${response.status}.`);
				}
				let body;
				try {
					body = await readLimitedBody(response, request.maxResponseBytes, currentUrl.toString());
				} catch (error) {
					if (controller.signal.aborted && !(error instanceof TranslationTransportError)) {
						throw new TranslationTransportError('remote-timeout', `Remote translation request to ${redactRemoteUrl(currentUrl.toString())} timed out after ${DEFAULT_TIMEOUT_MS} ms.`);
					}
					throw error;
				}
				validateJsonBody(body, currentUrl.toString());
				return { body, finalUrl: currentUrl.toString() };
			}
		} finally {
			clearTimeoutImpl(timeout);
			session.controllers.delete(controller);
		}
	}

	return Object.freeze({
		fetch: (rawRequest) => {
			const request = validateRequest(rawRequest);
			let session = sessions.get(request.scanId);
			if (!session) {
				session = { requests: new Map(), controllers: new Set() };
				sessions.set(request.scanId, session);
			}
			const key = request.url.toString();
			const signature = headerSignature(request.headers);
			const existing = session.requests.get(key);
			if (existing) {
				if (existing.signature !== signature || existing.maxResponseBytes !== request.maxResponseBytes) {
					throw new TranslationTransportError('remote-request-conflict', `Remote translation URL ${redactRemoteUrl(key)} is configured with conflicting request data.`);
				}
				return existing.promise;
			}
			if (session.requests.size >= MAX_REQUESTS_PER_SCAN) {
				throw new TranslationTransportError('remote-request-limit', `Remote translation scan exceeds the limit of ${MAX_REQUESTS_PER_SCAN} requests.`);
			}
			const promise = execute(request, session);
			session.requests.set(key, { signature, maxResponseBytes: request.maxResponseBytes, promise });
			return promise;
		},
		endScan: (scanId) => {
			if (typeof scanId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(scanId)) {
				throw new TranslationTransportError('remote-invalid-request', 'Remote translation scan identifier is invalid.');
			}
			const session = sessions.get(scanId);
			if (session) {
				for (const controller of session.controllers) controller.abort();
				sessions.delete(scanId);
			}
		}
	});
}

function serializeTransportError(error) {
	if (error instanceof TranslationTransportError) return { code: error.code, message: error.message };
	return { code: 'remote-fetch-failed', message: 'Remote translation request failed.' };
}

module.exports = {
	DEFAULT_MAX_REDIRECTS,
	DEFAULT_TIMEOUT_MS,
	MAX_REQUESTS_PER_SCAN,
	MAX_RESPONSE_BYTES,
	TranslationTransportError,
	createRemoteTranslationTransport,
	redactRemoteUrl,
	serializeTransportError,
	validateRequest
};
