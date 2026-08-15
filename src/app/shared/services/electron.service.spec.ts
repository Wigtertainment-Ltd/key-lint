import { ElectronService } from './electron.service';

describe('ElectronService preload bridge', () => {
	const originalBridge = window.keyLint;

	afterEach(() => {
		Object.defineProperty(window, 'keyLint', {
			configurable: true,
			value: originalBridge
		});
	});

	it('reports a regular browser when no preload bridge exists', () => {
		Object.defineProperty(window, 'keyLint', { configurable: true, value: undefined });
		const service = new ElectronService();

		expect(service.isElectron).toBeFalse();
		expect(() => service.readFile('C:/project/en.json')).toThrowError(
			'Electron preload bridge is not available.'
		);
	});

	it('forwards only typed operations to the preload bridge', async () => {
		const bridge = jasmine.createSpyObj<IKeyLintDesktopApi>('keyLint', [
			'selectProjectDirectory',
			'getPathForFile',
			'getAppVersion',
			'pathExists',
			'readFile',
			'writeFile',
			'readDirectory'
		]);
		bridge.selectProjectDirectory.and.resolveTo('C:/project');
		bridge.getPathForFile.and.returnValue('C:/project/dropped');
		bridge.getAppVersion.and.resolveTo('1.2.3');
		bridge.pathExists.and.resolveTo(true);
		bridge.readFile.and.resolveTo('{}');
		bridge.writeFile.and.resolveTo();
		bridge.readDirectory.and.resolveTo([]);
		Object.defineProperty(window, 'keyLint', { configurable: true, value: bridge });
		const service = new ElectronService();

		expect(service.isElectron).toBeTrue();
		expect(await service.selectProjectDirectory()).toBe('C:/project');
		expect(service.getPathForFile({} as File)).toBe('C:/project/dropped');
		expect(await service.getAppVersion()).toBe('1.2.3');
		expect(await service.pathExists('C:/project')).toBeTrue();
		expect(await service.readFile('C:/project/en.json')).toBe('{}');
		await service.writeFile('C:/project/de.json', '{}');
		expect(await service.readDirectory('C:/project')).toEqual([]);
		expect(bridge.writeFile).toHaveBeenCalledOnceWith('C:/project/de.json', '{}');
	});
});
