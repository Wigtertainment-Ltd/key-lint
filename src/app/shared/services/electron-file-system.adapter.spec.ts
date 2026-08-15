import { ElectronService } from './electron.service';
import { ElectronFileSystemAdapter } from './electron-file-system.adapter';

interface IFakeEntry {
	name: string;
	type: 'directory' | 'file';
	sizeBytes?: number;
	symbolicLink?: boolean;
}

function electronWithTree(
	tree: Record<string, IFakeEntry[]>,
	files: Record<string, string> = {},
	unreadablePaths: string[] = []
): ElectronService {
	return {
		isElectron: true,
		pathExists: async (path: string) => path in tree || path in files,
		readFile: async (path: string) => files[path],
		readDirectory: async (path: string) => {
			if (unreadablePaths.includes(path)) {
				throw new Error('Access denied');
			}

			return (tree[path] ?? []).map((entry) => ({
				name: entry.name,
				isDirectory: entry.type === 'directory',
				isFile: entry.type === 'file',
				isSymbolicLink: entry.symbolicLink ?? false,
				sizeBytes: entry.sizeBytes
			}));
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

	it('enforces file count, file size, and symlink guardrails', async () => {
		const guardedTree: Record<string, IFakeEntry[]> = {
			'C:/project': [
				{ name: 'large.json', type: 'file', sizeBytes: 20 },
				{ name: 'linked.json', type: 'file', symbolicLink: true },
				{ name: 'first.json', type: 'file', sizeBytes: 2 },
				{ name: 'second.json', type: 'file', sizeBytes: 2 }
			]
		};
		const adapter = new ElectronFileSystemAdapter(
			electronWithTree(guardedTree),
			{ maxFiles: 1, maxFileSizeBytes: 10 }
		);

		expect(await adapter.listFiles('C:/project', ['**/*.json'], [])).toEqual([
			'C:/project/first.json'
		]);
		expect(adapter.warnings.map((warning) => warning.code)).toEqual([
			'file-too-large',
			'symlink-skipped',
			'max-files-reached'
		]);
	});

	it('continues the scan with a structured warning for unreadable directories', async () => {
		const guardedTree: Record<string, IFakeEntry[]> = {
			'C:/project': [{ name: 'restricted', type: 'directory' }]
		};
		const adapter = new ElectronFileSystemAdapter(
			electronWithTree(guardedTree, {}, ['C:/project/restricted'])
		);

		expect(await adapter.listFiles('C:/project', ['**/*.json'], [])).toEqual([]);
		expect(adapter.warnings).toEqual([jasmine.objectContaining({
			code: 'unreadable-directory',
			filePath: 'C:/project/restricted',
			message: jasmine.stringContaining('Access denied')
		})]);
	});
});
