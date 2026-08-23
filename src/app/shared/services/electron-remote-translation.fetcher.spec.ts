import { RemoteTranslationError } from '@key-lint/core';

import { ElectronRemoteTranslationFetcher } from './electron-remote-translation.fetcher';
import { ElectronService } from './electron.service';

describe('ElectronRemoteTranslationFetcher', () => {
	it('adapts the Core fetcher contract to the narrow Electron bridge', async () => {
		const electron = jasmine.createSpyObj<ElectronService>('ElectronService', [
			'fetchTranslationResource',
			'endTranslationScan'
		]);
		electron.fetchTranslationResource.and.resolveTo({
			ok: true,
			value: { body: '{"APP":{}}', finalUrl: 'https://example.com/en.json' }
		});
		electron.endTranslationScan.and.resolveTo({ ok: true });
		const fetcher = new ElectronRemoteTranslationFetcher(electron);

		const response = await fetcher.fetch({
			url: 'https://example.com/en.json',
			headers: { Authorization: 'Bearer secret' },
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: 2_048
		});

		expect(response.body).toContain('APP');
		expect(electron.fetchTranslationResource).toHaveBeenCalledWith(jasmine.objectContaining({
			method: 'GET',
			url: 'https://example.com/en.json',
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: 2_048
		}));
		await fetcher.close();
		expect(electron.endTranslationScan).toHaveBeenCalledOnceWith(jasmine.stringMatching(/^renderer-/));
	});

	it('normalizes safe IPC errors into Core errors', async () => {
		const electron = jasmine.createSpyObj<ElectronService>('ElectronService', [
			'fetchTranslationResource',
			'endTranslationScan'
		]);
		electron.fetchTranslationResource.and.resolveTo({
			ok: false,
			error: { code: 'remote-http-error', message: 'Request returned HTTP 401.' }
		});
		const fetcher = new ElectronRemoteTranslationFetcher(electron);

		let error: unknown;
		try {
			await fetcher.fetch({
				url: 'https://example.com/en.json',
				headers: {},
				timeoutMs: 15_000,
				maxRedirects: 3,
				maxResponseBytes: 2_048
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(RemoteTranslationError);
		expect(error).toEqual(jasmine.objectContaining({ code: 'remote-http-error' }));
	});
});
