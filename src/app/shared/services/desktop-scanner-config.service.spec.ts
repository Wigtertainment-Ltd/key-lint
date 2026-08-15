import { ElectronService } from './electron.service';
import { DesktopScannerConfigService } from './desktop-scanner-config.service';

function electronWithFiles(files: Record<string, string>, isElectron = true): ElectronService {
	return {
		isElectron,
		pathExists: async (path: string) => path in files,
		readFile: async (path: string) => files[path]
	} as unknown as ElectronService;
}

describe('DesktopScannerConfigService', () => {
	it('uses defaults when no project configuration exists', async () => {
		const loaded = await new DesktopScannerConfigService(electronWithFiles({})).load('C:\\project\\');

		expect(loaded.config.includeSourceGlobs).toContain('**/*.ts');
		expect(loaded.configFilePath).toBeUndefined();
		expect(loaded.packageJsonConfigApplied).toBeFalse();
	});

	it('loads package.json and lets keylint.config.json override it', async () => {
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

		const loaded = await service.load('C:/project');

		expect(loaded.config.baseLocale).toBe('en');
		expect(loaded.config.ignoreKeys).toEqual(['FILE.**']);
		expect(loaded.config.includeSourceGlobs).toEqual(['package/**/*.ts']);
		expect(loaded.configFilePath).toBe('C:/project/keylint.config.json');
		expect(loaded.packageJsonConfigApplied).toBeTrue();
	});

	it('fails clearly for malformed JSON and unknown options', async () => {
		await expectAsync(new DesktopScannerConfigService(electronWithFiles({
			'C:/project/keylint.config.json': '{invalid'
		})).load('C:/project')).toBeRejectedWithError(/Could not parse.*keylint\.config\.json/);

		await expectAsync(new DesktopScannerConfigService(electronWithFiles({
			'C:/project/keylint.config.json': JSON.stringify({ typoOption: true })
		})).load('C:/project')).toBeRejectedWithError(/Unknown configuration key "typoOption"/);
	});

	it('returns defaults in a non-Electron browser context', async () => {
		const loaded = await new DesktopScannerConfigService(electronWithFiles({}, false)).load('/project');

		expect(loaded.config.ignoreKeys).toEqual([]);
		expect(loaded.packageJsonConfigApplied).toBeFalse();
	});

	it('applies temporary overrides last and reports guardrail value sources', async () => {
		const service = new DesktopScannerConfigService(electronWithFiles({
			'C:/project/package.json': JSON.stringify({
				keylint: { guardrails: { maxFiles: 500 } }
			}),
			'C:/project/keylint.config.json': JSON.stringify({
				guardrails: { maxFileSizeBytes: 4096 }
			})
		}));

		const loaded = await service.load('C:/project', {
			guardrails: { maxFiles: 25 }
		});

		expect(loaded.config.guardrails).toEqual({ maxFiles: 25, maxFileSizeBytes: 4096 });
		expect(loaded.guardrailSources).toEqual({
			maxFiles: 'override',
			maxFileSizeBytes: 'config-file'
		});
	});
});
