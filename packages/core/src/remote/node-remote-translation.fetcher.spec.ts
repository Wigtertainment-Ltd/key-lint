import { afterEach, describe, expect, it, vi, Mock } from 'vitest';

import { NodeRemoteTranslationFetcher } from './node-remote-translation.fetcher.js';
import { IRemoteTranslationFetchResponse, IRemoteTranslationFetchRequest } from './remote-translation.interfaces.js';

const request: IRemoteTranslationFetchRequest = {
	url: 'https://api.example.com/i18n/en.json?apiKey=super-secret',
	headers: { Authorization: 'Bearer credential', 'X-API-Key': 'key', 'X-Safe': 'value' },
	timeoutMs: 1_000,
	maxRedirects: 3,
	maxResponseBytes: 1_024
};

afterEach((): typeof vi => vi.unstubAllGlobals());

describe('NodeRemoteTranslationFetcher', (): void => {
	it('uses GET and returns a successful JSON body', async (): Promise<void> => {
		const fetch: Mock<typeof globalThis.fetch> = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('{"APP":{"TITLE":"Title"}}'));
		vi.stubGlobal('fetch', fetch);

		const response: IRemoteTranslationFetchResponse = await new NodeRemoteTranslationFetcher().fetch(request);

		expect(response.body).toContain('TITLE');
		expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
			method: 'GET',
			redirect: 'manual'
		}));
	});

	it('strips sensitive headers on a cross-origin redirect', async (): Promise<void> => {
		const fetch: Mock<typeof globalThis.fetch> = vi.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(new Response(null, {
				status: 302,
				headers: { Location: 'https://cdn.example.net/en.json' }
			}))
			.mockResolvedValueOnce(new Response('{}'));
		vi.stubGlobal('fetch', fetch);

		await new NodeRemoteTranslationFetcher().fetch(request);

		const redirectedOptions: RequestInit | undefined = fetch.mock.calls[1]?.[1];
		expect(redirectedOptions?.headers).toEqual({ 'X-Safe': 'value' });
	});

	it('rejects redirect loops, non-success responses, and oversized streams', async (): Promise<void> => {
		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null, {
			status: 302,
			headers: { Location: '/again' }
		})));
		await expect(new NodeRemoteTranslationFetcher().fetch({ ...request, maxRedirects: 1 }))
			.rejects.toMatchObject({ code: 'remote-redirect-error' });

		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('denied', { status: 401 })));
		await expect(new NodeRemoteTranslationFetcher().fetch(request))
			.rejects.toMatchObject({ code: 'remote-http-error' });

		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('1234567890')));
		await expect(new NodeRemoteTranslationFetcher().fetch({ ...request, maxResponseBytes: 5 }))
			.rejects.toMatchObject({ code: 'remote-response-too-large' });
	});

	it('enforces the total request timeout', async (): Promise<void> => {
		vi.stubGlobal('fetch', vi.fn((_url: URL, options: RequestInit): Promise<Response> => new Promise(
			(_resolve: (value: Response | PromiseLike<Response>) => void, reject: (reason?: unknown) => void): void => {
				options.signal?.addEventListener('abort', (): void => reject(new DOMException('Aborted', 'AbortError')));
			}
		)));

		await expect(new NodeRemoteTranslationFetcher().fetch({ ...request, timeoutMs: 5 }))
			.rejects.toMatchObject({ code: 'remote-timeout' });
	});

	it('does not expose query values or header secrets in errors', async (): Promise<void> => {
		vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('denied', { status: 500 })));

		let message: string = '';
		try {
			await new NodeRemoteTranslationFetcher().fetch(request);
		} catch (error: unknown) {
			message = error instanceof Error ? error.message : String(error);
		}
		expect(message).toContain('[redacted]');
		expect(message).not.toContain('super-secret');
		expect(message).not.toContain('credential');
	});
});
