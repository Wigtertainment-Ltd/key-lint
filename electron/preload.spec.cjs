const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { IPC_CHANNELS } = require('./ipc-channels');

test('sandboxed preload exposes only the approved operations and fixed IPC channels', async () => {
	const calls = [];
	let exposedName;
	let api;
	const electron = {
		contextBridge: {
			exposeInMainWorld: (name, value) => {
				exposedName = name;
				api = value;
			}
		},
		ipcRenderer: {
			invoke: async (channel, ...args) => {
				calls.push([channel, ...args]);
			}
		},
		webUtils: { getPathForFile: () => 'C:\\project\\dropped' }
	};
	const source = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
	vm.runInNewContext(source, {
		require: (specifier) => {
			assert.equal(specifier, 'electron');
			return electron;
		}
	});

	assert.equal(exposedName, 'keyLint');
	assert.deepEqual(Object.keys(api).sort(), [
		'getAppVersion',
		'getPathForFile',
		'pathExists',
		'readDirectory',
		'readFile',
		'selectProjectDirectory',
		'writeFile'
	]);
	assert.equal(Object.isFrozen(api), true);

	await api.selectProjectDirectory();
	assert.equal(api.getPathForFile({}), 'C:\\project\\dropped');
	await api.getAppVersion();
	await api.pathExists('C:\\project');
	await api.readFile('C:\\project\\en.json');
	await api.writeFile('C:\\project\\de.json', '{}');
	await api.readDirectory('C:\\project');

	assert.deepEqual(calls, [
		[IPC_CHANNELS.selectProjectDirectory],
		[IPC_CHANNELS.getAppVersion],
		[IPC_CHANNELS.pathExists, 'C:\\project'],
		[IPC_CHANNELS.readFile, 'C:\\project\\en.json'],
		[IPC_CHANNELS.writeFile, 'C:\\project\\de.json', '{}'],
		[IPC_CHANNELS.readDirectory, 'C:\\project']
	]);
});
