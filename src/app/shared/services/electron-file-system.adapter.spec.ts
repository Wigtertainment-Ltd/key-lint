import { ElectronService } from './electron.service';
import { ElectronFileSystemAdapter } from './electron-file-system.adapter';

interface IFakeEntry {
	name: string;
	type: 'directory' | 'file';
}

function electronWithTree(tree: Record<string, IFakeEntry[]>, files: Record<string, string> = {}): ElectronService {
	return {
		isElectron: true,
		fs: {
			existsSync: (path: string) => path in tree || path in files,
			readFileSync: (path: string) => files[path],
			readdirSync: (path: string) => (tree[path] ?? []).map((entry) => ({
				name: entry.name,
				isDirectory: () => entry.type === 'directory',
				isFile: () => entry.type === 'file'
			}))
		}
	} as unknown as ElectronService;
}

describe('ElectronFileSystemAdapter', () => {
	const tree: Record<string, IFakeEntry[]> = {
		'C:/project': [
			{ name: 'src', type: 'directory' },
			{ name: 'node_modules', type: 'directory' },
			{ name: 'README.md', type: 'file' }
		],
		'C:/project/src': [
			{ name: 'app', type: 'directory' },
			{ name: 'assets', type: 'directory' }
		],
		'C:/project/src/app': [{ name: 'app.component.ts', type: 'file' }],
		'C:/project/src/assets': [{ name: 'i18n', type: 'directory' }],
		'C:/project/src/assets/i18n': [
			{ name: 'en.json', type: 'file' },
			{ name: 'notes.txt', type: 'file' }
		],
		'C:/project/node_modules': [{ name: 'ignored.ts', type: 'file' }]
	};

	it('lists only included files and prunes excluded directories', async () => {
		const adapter = new ElectronFileSystemAdapter(electronWithTree(tree));

		const translationFiles = await adapter.listFiles(
			'C:/project',
			['src/assets/i18n/**/*.json'],
			['**/node_modules/**']
		);
		const sourceFiles = await adapter.listFiles(
			'C:/project',
			['**/*.ts'],
			['**/node_modules/**']
		);

		expect(translationFiles).toEqual(['C:/project/src/assets/i18n/en.json']);
		expect(sourceFiles).toEqual(['C:/project/src/app/app.component.ts']);
	});

	it('reads files and checks paths through the Electron fs bridge', async () => {
		const adapter = new ElectronFileSystemAdapter(
			electronWithTree(tree, { 'C:/project/src/assets/i18n/en.json': '{"APP":"App"}' })
		);

		expect(await adapter.fileExists('C:/project/src/assets/i18n/en.json')).toBeTrue();
		expect(await adapter.readFile('C:/project/src/assets/i18n/en.json')).toBe('{"APP":"App"}');
	});

	it('returns no files and rejects reads outside Electron', async () => {
		const adapter = new ElectronFileSystemAdapter({ isElectron: false } as ElectronService);

		expect(await adapter.fileExists('/project/file.ts')).toBeFalse();
		expect(await adapter.listFiles('/project', ['**/*.ts'], [])).toEqual([]);
		await expectAsync(adapter.readFile('/project/file.ts')).toBeRejectedWithError(
			'Electron runtime is required for filesystem access.'
		);
	});
});
