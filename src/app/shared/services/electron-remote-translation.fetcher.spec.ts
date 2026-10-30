import { RemoteTranslationError, IRemoteTranslationFetchResponse } from '@key-lint/core';

import { ElectronRemoteTranslationFetcher } from './electron-remote-translation.fetcher';
import { ElectronService } from './electron.service';

describe('ElectronRemoteTranslationFetcher', (): void => {
	it('adapts the Core fetcher contract to the narrow Electron bridge', async (): Promise<void> => {
		const electron: jasmine.SpyObj<ElectronService> = jasmine.createSpyObj<ElectronService>('ElectronService', [
			'fetchTranslationResource',
			'endTranslationScan'
		]);
		electron.fetchTranslationResource.and.resolveTo({
			ok: true,
			value: { body: '{"APP":{}}', finalUrl: 'https://example.com/en.json' }
		});
		electron.endTranslationScan.and.resolveTo({ ok: true });
		const fetcher: ElectronRemoteTranslationFetcher = new ElectronRemoteTranslationFetcher(electron);

		const response: IRemoteTranslationFetchResponse = await fetcher.fetch({
			url: 'https://example.com/en.json',
			headers: { Authorization: 'Bearer secret' },
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: 2_048
		});

		expect(response.body).toContain('APP');
		expect(electron.fetchTranslationResource.calls.allArgs()).toContain([jasmine.objectContaining({
			method: 'GET',
			url: 'https://example.com/en.json',
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: 2_048
		})]);
		await fetcher.close();
		expect(electron.endTranslationScan.calls.allArgs()).toEqual([[jasmine.stringMatching(/^renderer-/)]]);
	});

	it('normalizes safe IPC errors into Core errors', async (): Promise<void> => {
		const electron: jasmine.SpyObj<ElectronService> = jasmine.createSpyObj<ElectronService>('ElectronService', [
			'fetchTranslationResource',
			'endTranslationScan'
		]);
		electron.fetchTranslationResource.and.resolveTo({
			ok: false,
			error: { code: 'remote-http-error', message: 'Request returned HTTP 401.' }
		});
		const fetcher: ElectronRemoteTranslationFetcher = new ElectronRemoteTranslationFetcher(electron);

		let error: unknown;
		try {
			await fetcher.fetch({
				url: 'https://example.com/en.json',
				headers: {},
				timeoutMs: 15_000,
				maxRedirects: 3,
				maxResponseBytes: 2_048
			});
		} catch (caught: unknown) {
			error = caught;
		}
		expect(error).toBeInstanceOf(RemoteTranslationError);
		expect(error).toEqual(jasmine.objectContaining({ code: 'remote-http-error' }));
	});
});
