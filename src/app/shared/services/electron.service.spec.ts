import { ElectronService } from './electron.service';

describe('ElectronService preload bridge', (): void => {
	const originalBridge: IKeyLintDesktopApi | undefined = window.keyLint;

	afterEach((): void => {
		Object.defineProperty(window, 'keyLint', {
			configurable: true,
			value: originalBridge
		});
	});

	it('reports a regular browser when no preload bridge exists', (): void => {
		Object.defineProperty(window, 'keyLint', { configurable: true, value: undefined });
		const service: ElectronService = new ElectronService();

		expect(service.isElectron).toBeFalse();
		expect((): Promise<string> => service.readFile('C:/project/en.json')).toThrowError(
			'Electron preload bridge is not available.'
		);
	});

	it('forwards only typed operations to the preload bridge', async (): Promise<void> => {
		const bridge: jasmine.SpyObj<IKeyLintDesktopApi> = jasmine.createSpyObj<IKeyLintDesktopApi>('keyLint', [
			'selectProjectDirectory',
			'getPathForFile',
			'getAppVersion',
			'pathExists',
			'readFile',
			'writeFile',
			'readDirectory',
			'analyzeTranslationLoaders',
			'fetchTranslationResource',
			'endTranslationScan'
		]);
		bridge.selectProjectDirectory.and.resolveTo('C:/project');
		bridge.getPathForFile.and.returnValue('C:/project/dropped');
		bridge.getAppVersion.and.resolveTo('1.2.3');
		bridge.pathExists.and.resolveTo(true);
		bridge.readFile.and.resolveTo('{}');
		bridge.writeFile.and.resolveTo();
		bridge.readDirectory.and.resolveTo([]);
		bridge.analyzeTranslationLoaders.and.resolveTo({ candidates: [], diagnostics: [], sourceFiles: [] });
		bridge.fetchTranslationResource.and.resolveTo({
			ok: true,
			value: { body: '{}', finalUrl: 'https://example.com/en.json' }
		});
		bridge.endTranslationScan.and.resolveTo({ ok: true });
		Object.defineProperty(window, 'keyLint', { configurable: true, value: bridge });
		const service: ElectronService = new ElectronService();

		expect(service.isElectron).toBeTrue();
		expect(await service.selectProjectDirectory()).toBe('C:/project');
		expect(service.getPathForFile({} as File)).toBe('C:/project/dropped');
		expect(await service.getAppVersion()).toBe('1.2.3');
		expect(await service.pathExists('C:/project')).toBeTrue();
		expect(await service.readFile('C:/project/en.json')).toBe('{}');
		await service.writeFile('C:/project/de.json', '{}');
		expect(await service.readDirectory('C:/project')).toEqual([]);
		expect(await service.analyzeTranslationLoaders([])).toEqual({ candidates: [], diagnostics: [], sourceFiles: [] });
		const remoteRequest: IKeyLintTranslationFetchRequest = {
			scanId: 'scan-1',
			method: 'GET',
			url: 'https://example.com/en.json',
			headers: {},
			timeoutMs: 15_000,
			maxRedirects: 3,
			maxResponseBytes: 1_024
		};
		expect(await service.fetchTranslationResource(remoteRequest)).toEqual({
			ok: true,
			value: { body: '{}', finalUrl: 'https://example.com/en.json' }
		});
		expect(await service.endTranslationScan('scan-1')).toEqual({ ok: true });
		expect(bridge.writeFile.calls.allArgs()).toEqual([['C:/project/de.json', '{}']]);
	});
});
