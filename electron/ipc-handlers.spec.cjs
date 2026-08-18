const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { IPC_CHANNELS } = require('./ipc-channels');
const { MAX_WRITE_BYTES, registerIpcHandlers } = require('./ipc-handlers');

const PROJECT_PATH = path.resolve('project');
const MISSING_PATH = path.join(PROJECT_PATH, 'missing');
const TEXT_FILE_PATH = path.join(PROJECT_PATH, 'note.txt');
const TRANSLATION_FILE_PATH = path.join(PROJECT_PATH, 'de.json');

function createHarness() {
	const handlers = new Map();
	const writes = [];
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
		fs
	});

	return { handlers, writes };
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

test('rejects relative paths and unsafe writes before accessing the filesystem', async () => {
	const { handlers, writes } = createHarness();
	await assert.rejects(
		handlers.get(IPC_CHANNELS.readFile)(null, 'relative/en.json'),
		/absolute path/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.writeFile)(null, TEXT_FILE_PATH, 'text'),
		/Only JSON translation files/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.writeFile)(null, TRANSLATION_FILE_PATH, 'x'.repeat(MAX_WRITE_BYTES + 1)),
		/write limit/
	);
	assert.equal(writes.length, 0);

	await handlers.get(IPC_CHANNELS.writeFile)(null, TRANSLATION_FILE_PATH, '{}');
	assert.deepEqual(writes, [[TRANSLATION_FILE_PATH, '{}', 'utf8']]);
});
