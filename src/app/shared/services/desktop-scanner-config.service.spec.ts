import { ElectronService } from './electron.service';
import { DesktopScannerConfigService } from './desktop-scanner-config.service';

function electronWithFiles(files: Record<string, string>, isElectron = true): ElectronService {
	return {
		isElectron,
		fs: {
			existsSync: (path: string) => path in files,
			readFileSync: (path: string) => files[path]
		}
	} as unknown as ElectronService;
}

describe('DesktopScannerConfigService', () => {
	it('uses defaults when no project configuration exists', () => {
		const loaded = new DesktopScannerConfigService(electronWithFiles({})).load('C:\\project\\');

		expect(loaded.config.includeSourceGlobs).toContain('**/*.ts');
		expect(loaded.configFilePath).toBeUndefined();
		expect(loaded.packageJsonConfigApplied).toBeFalse();
	});

	it('loads package.json and lets keylint.config.json override it', () => {
		const service = new DesktopScannerConfigService(electronWithFiles({
			'C:/project/package.json': JSON.stringify({
				keylint: {
					baseLocale: 'de',
					ignoreKeys: ['PACKAGE.**'],
					includeSourceGlobs: ['package/**/*.ts']
				}
			}),
			'C:/project/keylint.config.json': JSON.stringify({
				baseLocale: 'en',
				ignoreKeys: ['FILE.**']
			})
		}));

		const loaded = service.load('C:/project');

		expect(loaded.config.baseLocale).toBe('en');
		expect(loaded.config.ignoreKeys).toEqual(['FILE.**']);
		expect(loaded.config.includeSourceGlobs).toEqual(['package/**/*.ts']);
		expect(loaded.configFilePath).toBe('C:/project/keylint.config.json');
		expect(loaded.packageJsonConfigApplied).toBeTrue();
	});

	it('fails clearly for malformed JSON and unknown options', () => {
		expect(() => new DesktopScannerConfigService(electronWithFiles({
			'C:/project/keylint.config.json': '{invalid'
		})).load('C:/project')).toThrowError(/Could not parse.*keylint\.config\.json/);

		expect(() => new DesktopScannerConfigService(electronWithFiles({
			'C:/project/keylint.config.json': JSON.stringify({ typoOption: true })
		})).load('C:/project')).toThrowError(/Unknown configuration key "typoOption"/);
	});

	it('returns defaults in a non-Electron browser context', () => {
		const loaded = new DesktopScannerConfigService(electronWithFiles({}, false)).load('/project');

		expect(loaded.config.ignoreKeys).toEqual([]);
		expect(loaded.packageJsonConfigApplied).toBeFalse();
	});
});
