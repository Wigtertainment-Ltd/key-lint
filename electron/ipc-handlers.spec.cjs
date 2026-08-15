const assert = require('node:assert/strict');
const test = require('node:test');

const { IPC_CHANNELS } = require('./ipc-channels');
const { MAX_WRITE_BYTES, registerIpcHandlers } = require('./ipc-handlers');

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
		readdir: async () => [{
			name: 'en.json',
			isDirectory: () => false,
			isFile: () => true
		}]
	};
	registerIpcHandlers({
		ipcMain,
		dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\project'] }) },
		app: { getVersion: () => '1.2.3' },
		fs
	});

	return { handlers, writes };
}

test('registers the fixed IPC surface and returns serializable values', async () => {
	const { handlers } = createHarness();
	assert.deepEqual([...handlers.keys()].sort(), Object.values(IPC_CHANNELS).sort());
	assert.equal(await handlers.get(IPC_CHANNELS.selectProjectDirectory)(), 'C:\\project');
	assert.equal(await handlers.get(IPC_CHANNELS.getAppVersion)(), '1.2.3');
	assert.equal(await handlers.get(IPC_CHANNELS.pathExists)(null, 'C:\\project'), true);
	assert.equal(await handlers.get(IPC_CHANNELS.pathExists)(null, 'C:\\missing'), false);
	assert.deepEqual(
		await handlers.get(IPC_CHANNELS.readDirectory)(null, 'C:\\project'),
		[{ name: 'en.json', isDirectory: false, isFile: true }]
	);
});

test('rejects relative paths and unsafe writes before accessing the filesystem', async () => {
	const { handlers, writes } = createHarness();
	await assert.rejects(
		handlers.get(IPC_CHANNELS.readFile)(null, 'relative/en.json'),
		/absolute path/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.writeFile)(null, 'C:\\project\\note.txt', 'text'),
		/Only JSON translation files/
	);
	await assert.rejects(
		handlers.get(IPC_CHANNELS.writeFile)(null, 'C:\\project\\de.json', 'x'.repeat(MAX_WRITE_BYTES + 1)),
		/write limit/
	);
	assert.equal(writes.length, 0);

	await handlers.get(IPC_CHANNELS.writeFile)(null, 'C:\\project\\de.json', '{}');
	assert.deepEqual(writes, [['C:\\project\\de.json', '{}', 'utf8']]);
});
