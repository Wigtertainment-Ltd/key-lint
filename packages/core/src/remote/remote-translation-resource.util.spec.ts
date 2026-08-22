import { describe, expect, it, vi } from 'vitest';

import { ITranslationSourceConfig } from '../config/config.interfaces.js';
import { RemoteTranslationError } from './remote-translation.error.js';
import { collectRemoteTranslationResources } from './remote-translation-resource.util.js';

const guardrails = { maxFiles: 1_000, maxFileSizeBytes: 4_096 };

function httpSource(overrides: Partial<Extract<ITranslationSourceConfig, { type: 'http' }>> = {}) {
	return {
		type: 'http' as const,
		id: 'api',
		urlTemplate: 'https://example.com/i18n/{locale}.json?token=top-secret',
		locales: ['de', 'en'],
		...overrides
	};
}

describe('collectRemoteTranslationResources', () => {
	it('resolves environment headers and returns read-only resources', async () => {
		const fetch = vi.fn(async (request: { url: string; headers: Readonly<Record<string, string>> }) => ({
			body: JSON.stringify({ APP: { TITLE: request.url.includes('/de.') ? 'Titel' : 'Title' } }),
			finalUrl: request.url
		}));
		const resources = await collectRemoteTranslationResources(
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
		expect(resources.get(0)?.map((resource) => resource.locale)).toEqual(['de', 'en']);
		expect(resources.get(0)?.every((resource) => !resource.writable)).toBe(true);
		expect(resources.get(0)?.every((resource) => resource.origin.type === 'http')).toBe(true);
	});

	it('preflights opt-in and environment variables before any request', async () => {
		const fetch = vi.fn();
		const source = httpSource({ headersFromEnv: { Authorization: 'MISSING_AUTH' } });

		await expect(collectRemoteTranslationResources(
			[source], { allowNetwork: false, fetcher: { fetch }, environment: {} }, guardrails
		)).rejects.toMatchObject({ code: 'network-not-allowed' });
		await expect(collectRemoteTranslationResources(
			[source], { allowNetwork: true, fetcher: { fetch }, environment: {} }, guardrails
		)).rejects.toMatchObject({ code: 'remote-environment-missing' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('deduplicates equal URLs and rejects conflicting headers', async () => {
		const fetch = vi.fn(async (request: { url: string }) => ({ body: '{}', finalUrl: request.url }));
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

	it('enforces the per-scan request cap before fetching', async () => {
		const fetch = vi.fn();
		const locales = Array.from({ length: 101 }, (_, index) => `locale-${index}`);

		await expect(collectRemoteTranslationResources(
			[httpSource({ locales })], { allowNetwork: true, fetcher: { fetch } }, guardrails
		)).rejects.toMatchObject({ code: 'remote-request-limit' });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('redacts query values and transport details from errors', async () => {
		const fetch = vi.fn(async () => {
			throw new Error('Bearer secret-from-transport');
		});

		let error: unknown;
		try {
			await collectRemoteTranslationResources(
				[httpSource({ locales: ['en'] })], { allowNetwork: true, fetcher: { fetch } }, guardrails
			);
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(RemoteTranslationError);
		expect((error as Error).message).not.toContain('top-secret');
		expect((error as Error).message).not.toContain('secret-from-transport');
		expect((error as Error).message).toContain('[redacted]');
	});
});
