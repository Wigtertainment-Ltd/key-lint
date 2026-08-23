const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
	DEFAULT_MAX_REDIRECTS,
	DEFAULT_TIMEOUT_MS,
	MAX_REQUESTS_PER_SCAN,
	createRemoteTranslationTransport,
	serializeTransportError
} = require('./remote-translation-transport');

function request(overrides = {}) {
	return {
		scanId: 'scan-1',
		method: 'GET',
		url: 'https://api.example.com/en.json?token=query-secret',
		headers: { Authorization: 'Bearer header-secret', 'X-Safe': 'safe' },
		timeoutMs: DEFAULT_TIMEOUT_MS,
		maxRedirects: DEFAULT_MAX_REDIRECTS,
		maxResponseBytes: 1024,
		...overrides
	};
}

async function withServer(handler, callback) {
	const server = http.createServer(handler);
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	try {
		const address = server.address();
		await callback(`http://127.0.0.1:${address.port}`);
	} finally {
		await new Promise((resolve) => server.close(resolve));
	}
}

test('performs authenticated main-process requests without browser CORS', async () => {
	await withServer((incoming, response) => {
		assert.equal(incoming.method, 'GET');
		assert.equal(incoming.headers.authorization, 'Bearer server-token');
		assert.equal(incoming.headers.origin, undefined);
		response.setHeader('Content-Type', 'application/json');
		response.end('{"APP":{"TITLE":"Title"}}');
	}, async (origin) => {
		const transport = createRemoteTranslationTransport();
		const result = await transport.fetch(request({
			url: `${origin}/en.json`,
			headers: { Authorization: 'Bearer server-token' }
		}));
		assert.equal(JSON.parse(result.body).APP.TITLE, 'Title');
	});
});

test('rejects invalid IPC request fields before network access', async () => {
	let calls = 0;
	const transport = createRemoteTranslationTransport({ fetchImpl: async () => {
		calls += 1;
		return new Response('{}');
	} });
	const invalidRequests = [
		request({ method: 'POST' }),
		request({ url: 'file:///translations/en.json' }),
		request({ url: 'https://user:pass@example.com/en.json' }),
		request({ headers: { 'Bad Header': 'value' } }),
		request({ headers: { Authorization: 42 } }),
		request({ timeoutMs: 1 }),
		request({ extraPayload: true }),
		null
	];
	for (const invalidRequest of invalidRequests) {
		await assert.rejects(Promise.resolve().then(() => transport.fetch(invalidRequest)), { code: 'remote-invalid-request' });
	}
	assert.equal(calls, 0);
});

test('revalidates redirects and strips sensitive cross-origin headers', async () => {
	const calls = [];
	const fetchImpl = async (url, options) => {
		calls.push({ url: url.toString(), headers: options.headers });
		if (calls.length === 1) {
			return new Response(null, { status: 302, headers: { Location: 'https://cdn.example.net/en.json' } });
		}
		return new Response('{}');
	};
	const transport = createRemoteTranslationTransport({ fetchImpl });
	await transport.fetch(request({ headers: {
		Authorization: 'Bearer secret',
		'X-API-Key': 'api-secret',
		Cookie: 'session=secret',
		'X-Safe': 'safe'
	} }));
	assert.deepEqual(calls[1].headers, { 'X-Safe': 'safe' });

	const unsafeRedirect = createRemoteTranslationTransport({
		fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'file:///secret.json' } })
	});
	await assert.rejects(unsafeRedirect.fetch(request()), { code: 'remote-redirect-error' });
});

test('enforces timeout, redirect, streamed-size, and HTTP limits', async () => {
	const timeoutTransport = createRemoteTranslationTransport({
		fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
			options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
		}),
		setTimeoutImpl: (callback) => {
			queueMicrotask(callback);
			return 1;
		},
		clearTimeoutImpl: () => undefined
	});
	await assert.rejects(timeoutTransport.fetch(request()), { code: 'remote-timeout' });

	const redirectTransport = createRemoteTranslationTransport({
		fetchImpl: async () => new Response(null, { status: 302, headers: { Location: '/again' } })
	});
	await assert.rejects(redirectTransport.fetch(request()), { code: 'remote-redirect-error' });

	const sizeTransport = createRemoteTranslationTransport({
		fetchImpl: async () => new Response('1234567890')
	});
	await assert.rejects(sizeTransport.fetch(request({ maxResponseBytes: 5 })), { code: 'remote-response-too-large' });

	const httpTransport = createRemoteTranslationTransport({
		fetchImpl: async () => new Response('denied', { status: 403 })
	});
	await assert.rejects(httpTransport.fetch(request()), { code: 'remote-http-error' });
});

test('deduplicates URLs and caps each scan at 100 distinct requests', async () => {
	let calls = 0;
	const transport = createRemoteTranslationTransport({ fetchImpl: async () => {
		calls += 1;
		return new Response('{}');
	} });
	const first = request({ url: 'https://example.com/same.json' });
	await Promise.all([transport.fetch(first), transport.fetch(first)]);
	assert.equal(calls, 1);

	for (let index = 1; index < MAX_REQUESTS_PER_SCAN; index += 1) {
		await transport.fetch(request({ url: `https://example.com/${index}.json` }));
	}
	await assert.rejects(
		Promise.resolve().then(() => transport.fetch(request({ url: 'https://example.com/overflow.json' }))),
		{ code: 'remote-request-limit' }
	);
	assert.equal(calls, MAX_REQUESTS_PER_SCAN);
	transport.endScan('scan-1');
	await transport.fetch(request({ url: 'https://example.com/new-scan.json' }));
	assert.equal(calls, MAX_REQUESTS_PER_SCAN + 1);
});

test('rejects conflicting deduplicated requests and invalid JSON roots', async () => {
	const transport = createRemoteTranslationTransport({ fetchImpl: async () => new Response('{}') });
	await transport.fetch(request({ url: 'https://example.com/same.json', headers: { Authorization: 'one' } }));
	await assert.rejects(
		Promise.resolve().then(() => transport.fetch(request({ url: 'https://example.com/same.json', headers: { Authorization: 'two' } }))),
		{ code: 'remote-request-conflict' }
	);

	const invalidJson = createRemoteTranslationTransport({ fetchImpl: async () => new Response('{invalid') });
	await assert.rejects(invalidJson.fetch(request()), { code: 'remote-invalid-json' });
	const invalidRoot = createRemoteTranslationTransport({ fetchImpl: async () => new Response('[]') });
	await assert.rejects(invalidRoot.fetch(request()), { code: 'remote-invalid-root' });
});

test('serialized failures never expose header or sensitive query values', async () => {
	const transport = createRemoteTranslationTransport({ fetchImpl: async () => new Response('denied', { status: 500 }) });
	let serialized;
	try {
		await transport.fetch(request());
	} catch (error) {
		serialized = serializeTransportError(error);
	}
	const snapshot = JSON.stringify(serialized);
	assert.match(snapshot, /redacted/);
	assert.doesNotMatch(snapshot, /query-secret|header-secret|Bearer/);
	assert.deepEqual(serializeTransportError(new Error('Bearer unknown-secret')), {
		code: 'remote-fetch-failed',
		message: 'Remote translation request failed.'
	});
});
