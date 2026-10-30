import { describe, expect, it, vi, Mock } from 'vitest';

import { ITranslationSourceConfig, IHttpTranslationSourceConfig } from '../config/config.interfaces.js';
import { RemoteTranslationError } from './remote-translation.error.js';
import { collectRemoteTranslationResources } from './remote-translation-resource.util.js';
import { IRemoteTranslationFetcher, IRemoteTranslationFetchRequest, IRemoteTranslationFetchResponse } from './remote-translation.interfaces.js';
import { ITranslationResource } from '../models/translation-resource.model.js';

const guardrails: { maxFiles: number; maxFileSizeBytes: number; } = { maxFiles: 1_000, maxFileSizeBytes: 4_096 };

function httpSource(
	overrides: Partial<Extract<ITranslationSourceConfig, { type: 'http' }>> = {}
): Extract<ITranslationSourceConfig, { type: 'http' }> {
	return {
		type: 'http' as const,
		id: 'api',
		urlTemplate: 'https://example.com/i18n/{locale}.json?token=top-secret',
		locales: ['de', 'en'],
		...overrides
	};
}

describe('collectRemoteTranslationResources', (): void => {
	it('resolves environment headers and returns read-only resources', async (): Promise<void> => {
		const fetch: Mock<IRemoteTranslationFetcher['fetch']> = vi.fn(
			(request: IRemoteTranslationFetchRequest): Promise<IRemoteTranslationFetchResponse> => Promise.resolve({
				body: JSON.stringify({ APP: { TITLE: request.url.includes('/de.') ? 'Titel' : 'Title' } }),
				finalUrl: request.url
			})
		);
		const resources: Map<number, ITranslationResource[]> = await collectRemoteTranslationResources(
			[httpSource({ headersFromEnv: { Authorization: 'KEYLINT_AUTH' } })],
			{ allowNetwork: true, fetcher: { fetch }, environment: { KEYLINT_AUTH: 'Bearer secret' } },
			guardrails
		);

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch.mock.calls[0]?.[0]).toMatchObject({
			headers: { Authorization: 'Bearer secret' },
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: 4_096
		});
		expect(resources.get(0)?.map((resource: ITranslationResource): string => resource.locale)).toEqual(['de', 'en']);
		expect(resources.get(0)?.every((resource: ITranslationResource): boolean => !resource.writable)).toBe(true);
		expect(resources.get(0)?.every((resource: ITranslationResource): boolean => resource.origin.type === 'http')).toBe(true);
	});

	it('preflights opt-in and environment variables before any request', async (): Promise<void> => {
		const fetch: Mock<IRemoteTranslationFetcher['fetch']> = vi.fn<IRemoteTranslationFetcher['fetch']>();
		const source: IHttpTranslationSourceConfig = httpSource({ headersFromEnv: { Authorization: 'MISSING_AUTH' } });

		await expect(collectRemoteTranslationResources(
			[source], { allowNetwork: false, fetcher: { fetch }, environment: {} }, guardrails
		)).rejects.toMatchObject({ code: 'network-not-allowed' });
		await expect(collectRemoteTranslationResources(
			[source], { allowNetwork: true, fetcher: { fetch }, environment: {} }, guardrails
		)).rejects.toMatchObject({ code: 'remote-environment-missing' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('deduplicates equal URLs and rejects conflicting headers', async (): Promise<void> => {
		const fetch: Mock<IRemoteTranslationFetcher['fetch']> = vi.fn(
			(request: IRemoteTranslationFetchRequest): Promise<IRemoteTranslationFetchResponse> => Promise.resolve({ body: '{}', finalUrl: request.url })
		);
		const sources: ITranslationSourceConfig[] = [
			httpSource({ id: 'one', locales: ['en'], headersFromEnv: { Authorization: 'AUTH' } }),
			httpSource({ id: 'two', locales: ['en'], headersFromEnv: { Authorization: 'AUTH' } })
		];
		await collectRemoteTranslationResources(
			sources, { allowNetwork: true, fetcher: { fetch }, environment: { AUTH: 'same' } }, guardrails
		);
		expect(fetch).toHaveBeenCalledTimes(1);

		await expect(collectRemoteTranslationResources(
			[
				httpSource({ id: 'one', locales: ['en'], headersFromEnv: { Authorization: 'AUTH_ONE' } }),
				httpSource({ id: 'two', locales: ['en'], headersFromEnv: { Authorization: 'AUTH_TWO' } })
			],
			{
				allowNetwork: true,
				fetcher: { fetch },
				environment: { AUTH_ONE: 'first', AUTH_TWO: 'second' }
			},
			guardrails
		)).rejects.toMatchObject({ code: 'remote-request-conflict' });
	});

	it('enforces the per-scan request cap before fetching', async (): Promise<void> => {
		const fetch: Mock<IRemoteTranslationFetcher['fetch']> = vi.fn<IRemoteTranslationFetcher['fetch']>();
		const locales: string[] = Array.from({ length: 101 }, (_: unknown, index: number): string => `locale-${index}`);

		await expect(collectRemoteTranslationResources(
			[httpSource({ locales })], { allowNetwork: true, fetcher: { fetch } }, guardrails
		)).rejects.toMatchObject({ code: 'remote-request-limit' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('redacts query values and transport details from errors', async (): Promise<void> => {
		const fetch: Mock<IRemoteTranslationFetcher['fetch']> = vi.fn<IRemoteTranslationFetcher['fetch']>().mockRejectedValue(new Error('Bearer secret-from-transport'));

		let error: unknown;
		try {
			await collectRemoteTranslationResources(
				[httpSource({ locales: ['en'] })], { allowNetwork: true, fetcher: { fetch } }, guardrails
			);
		} catch (caught: unknown) {
			error = caught;
		}
		expect(error).toBeInstanceOf(RemoteTranslationError);
		expect((error as Error).message).not.toContain('top-secret');
		expect((error as Error).message).not.toContain('secret-from-transport');
		expect((error as Error).message).toContain('[redacted]');
	});
});
