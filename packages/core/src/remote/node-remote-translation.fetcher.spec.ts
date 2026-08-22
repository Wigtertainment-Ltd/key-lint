import { afterEach, describe, expect, it, vi } from 'vitest';

import { NodeRemoteTranslationFetcher } from './node-remote-translation.fetcher.js';

const request = {
	url: 'https://api.example.com/i18n/en.json?apiKey=super-secret',
	headers: { Authorization: 'Bearer credential', 'X-API-Key': 'key', 'X-Safe': 'value' },
	timeoutMs: 1_000,
	maxRedirects: 3,
	maxResponseBytes: 1_024
};

afterEach(() => vi.unstubAllGlobals());

describe('NodeRemoteTranslationFetcher', () => {
	it('uses GET and returns a successful JSON body', async () => {
		const fetch = vi.fn(async () => new Response('{"APP":{"TITLE":"Title"}}'));
		vi.stubGlobal('fetch', fetch);

		const response = await new NodeRemoteTranslationFetcher().fetch(request);

		expect(response.body).toContain('TITLE');
		expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
			method: 'GET',
			redirect: 'manual'
		}));
	});

	it('strips sensitive headers on a cross-origin redirect', async () => {
		const fetch = vi.fn()
			.mockResolvedValueOnce(new Response(null, {
				status: 302,
				headers: { Location: 'https://cdn.example.net/en.json' }
			}))
			.mockResolvedValueOnce(new Response('{}'));
		vi.stubGlobal('fetch', fetch);

		await new NodeRemoteTranslationFetcher().fetch(request);

		const redirectedOptions = fetch.mock.calls[1]?.[1] as RequestInit;
		expect(redirectedOptions.headers).toEqual({ 'X-Safe': 'value' });
	});

	it('rejects redirect loops, non-success responses, and oversized streams', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, {
			status: 302,
			headers: { Location: '/again' }
		})));
		await expect(new NodeRemoteTranslationFetcher().fetch({ ...request, maxRedirects: 1 }))
			.rejects.toMatchObject({ code: 'remote-redirect-error' });

		vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 401 })));
		await expect(new NodeRemoteTranslationFetcher().fetch(request))
			.rejects.toMatchObject({ code: 'remote-http-error' });

		vi.stubGlobal('fetch', vi.fn(async () => new Response('1234567890')));
		await expect(new NodeRemoteTranslationFetcher().fetch({ ...request, maxResponseBytes: 5 }))
			.rejects.toMatchObject({ code: 'remote-response-too-large' });
	});

	it('enforces the total request timeout', async () => {
		vi.stubGlobal('fetch', vi.fn((_url: URL, options: RequestInit) => new Promise((_resolve, reject) => {
			options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
		})));

		await expect(new NodeRemoteTranslationFetcher().fetch({ ...request, timeoutMs: 5 }))
			.rejects.toMatchObject({ code: 'remote-timeout' });
	});

	it('does not expose query values or header secrets in errors', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('denied', { status: 500 })));

		let message = '';
		try {
			await new NodeRemoteTranslationFetcher().fetch(request);
		} catch (error) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('[redacted]');
		expect(message).not.toContain('super-secret');
		expect(message).not.toContain('credential');
	});
});
