const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { IPC_CHANNELS } = require('./ipc-channels');
const { MAX_WRITE_BYTES, defaultLoaderAnalyzer, registerIpcHandlers } = require('./ipc-handlers');

const PROJECT_PATH = path.resolve('project');
const MISSING_PATH = path.join(PROJECT_PATH, 'missing');
const TEXT_FILE_PATH = path.join(PROJECT_PATH, 'note.txt');
const TRANSLATION_FILE_PATH = path.join(PROJECT_PATH, 'de.json');

function createHarness(remoteTransport, loaderAnalyzer) {
	const handlers = new Map();
	const writes = [];
	const remoteCalls = [];
	const ipcMain = {
		handle: (channel, handler) => handlers.set(channel, handler)
	};
	const fs = {
		access: async (filePath) => {
			if (filePath.endsWith('missing')) throw new Error('missing');
		},
		readFile: async (filePath, encoding) => `${filePath}:${encoding}`,
		writeFile: async (...args) => void writes.push(args),
		stat: async () => ({ size: 42 }),
		readdir: async () => [
			{
				name: 'en.json',
				isDirectory: () => false,
				isFile: () => true,
				isSymbolicLink: () => false
			},
			{
				name: 'linked',
				isDirectory: () => false,
				isFile: () => false,
				isSymbolicLink: () => true
			}
		]
	};
	registerIpcHandlers({
		ipcMain,
		dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [PROJECT_PATH] }) },
		app: { getVersion: () => '1.2.3' },
		fs,
		remoteTransport: remoteTransport ?? {
			fetch: async (request) => {
				remoteCalls.push(['fetch', request]);
				return { body: '{}', finalUrl: request.url };
			},
			endScan: (scanId) => void remoteCalls.push(['end', scanId])
		},
		loaderAnalyzer: loaderAnalyzer ?? (async (files) => ({ candidates: [], diagnostics: [], sourceFiles: files.map((file) => file.filePath) }))
	});

	return { handlers, writes, remoteCalls };
}

test('registers the fixed IPC surface and returns serializable values', async () => {
	const { handlers } = createHarness();
	assert.deepEqual([...handlers.keys()].sort(), Object.values(IPC_CHANNELS).sort());
	assert.equal(await handlers.get(IPC_CHANNELS.selectProjectDirectory)(), PROJECT_PATH);
	assert.equal(await handlers.get(IPC_CHANNELS.getAppVersion)(), '1.2.3');
	assert.equal(await handlers.get(IPC_CHANNELS.pathExists)(null, PROJECT_PATH), true);
	assert.equal(await handlers.get(IPC_CHANNELS.pathExists)(null, MISSING_PATH), false);
	assert.deepEqual(
		await handlers.get(IPC_CHANNELS.readDirectory)(null, PROJECT_PATH),
		[
			{ name: 'en.json', isDirectory: false, isFile: true, isSymbolicLink: false, sizeBytes: 42 },
			{ name: 'linked', isDirectory: false, isFile: false, isSymbolicLink: true, sizeBytes: undefined }
		]
	);
});

test('exposes only normalized translation transport responses', async () => {
	const { handlers, remoteCalls } = createHarness();
	const request = { scanId: 'scan-1', method: 'GET', url: 'https://example.com/en.json' };

	assert.deepEqual(
		await handlers.get(IPC_CHANNELS.fetchTranslationResource)(null, request),
		{ ok: true, value: { body: '{}', finalUrl: request.url } }
	);
	assert.deepEqual(await handlers.get(IPC_CHANNELS.endTranslationScan)(null, 'scan-1'), { ok: true });
	assert.deepEqual(remoteCalls, [['fetch', request], ['end', 'scan-1']]);
});

test('validates loader analysis input and returns only analyzer data', async () => {
	const calls = [];
	const { handlers } = createHarness(undefined, async (files) => {
		calls.push(files);
		return { candidates: [{ framework: 'transloco' }], diagnostics: [], sourceFiles: files.map((file) => file.filePath) };
	});
	const filePath = path.join(PROJECT_PATH, 'app.config.ts');
	const result = await handlers.get(IPC_CHANNELS.analyzeTranslationLoaders)(null, [{ filePath, content: 'source' }]);

	assert.deepEqual(result.candidates, [{ framework: 'transloco' }]);
	assert.equal(calls.length, 1);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.analyzeTranslationLoaders)(null, [{ filePath: 'relative.ts', content: '' }]),
		/absolute path/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.analyzeTranslationLoaders)(null, [{ filePath: path.join(PROJECT_PATH, 'app.js'), content: '' }]),
		/TypeScript/
	);
});

test('loads the Core static analyzers in the Electron main process', async () => {
	const result = await defaultLoaderAnalyzer([{
		filePath: path.join(PROJECT_PATH, 'app.config.ts'),
		content: `
			import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
			const AVAILABLE_LANGS = ['en'];
			provideTranslateHttpLoader({ prefix: '/assets/i18n/' });`
	}]);

	assert.equal(result.candidates.length, 1);
	assert.equal(result.candidates[0].framework, 'ngx-translate');
	assert.deepEqual(result.candidates[0].locales, ['en']);
});

test('does not serialize unknown transport secrets across IPC', async () => {
	const { handlers } = createHarness({
		fetch: async () => { throw new Error('Bearer ipc-secret'); },
		endScan: () => undefined
	});
	const result = await handlers.get(IPC_CHANNELS.fetchTranslationResource)(null, {});

	assert.deepEqual(result, {
		ok: false,
		error: { code: 'remote-fetch-failed', message: 'Remote translation request failed.' }
	});
	assert.doesNotMatch(JSON.stringify(result), /ipc-secret|Bearer/);
});

test('rejects relative paths and unsafe writes before accessing the filesystem', async () => {
	const { handlers, writes } = createHarness();
	await assert.rejects(
		handlers.get(IPC_CHANNELS.readFile)(null, 'relative/en.json'),
		// Match the stable error fragment explaining that relative paths are rejected.
		/absolute path/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.writeFile)(null, TEXT_FILE_PATH, 'text'),
		// Match the stable error fragment restricting writes to JSON translation files.
		/Only JSON translation files/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.writeFile)(null, TRANSLATION_FILE_PATH, 'x'.repeat(MAX_WRITE_BYTES + 1)),
		// Match the stable error fragment emitted when the configured write-size limit is exceeded.
		/write limit/
	);
	assert.equal(writes.length, 0);

	await handlers.get(IPC_CHANNELS.writeFile)(null, TRANSLATION_FILE_PATH, '{}');
	assert.deepEqual(writes, [[TRANSLATION_FILE_PATH, '{}', 'utf8']]);
});
