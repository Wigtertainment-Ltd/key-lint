const path = require('path');

const { IPC_CHANNELS } = require('./ipc-channels');

const MAX_WRITE_BYTES = 2 * 1024 * 1024;

function assertAbsolutePath(value, label = 'Path') {
	if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
		throw new TypeError(`${label} must be a non-empty absolute path.`);
	}

	return path.normalize(value);
}

function registerIpcHandlers({ ipcMain, dialog, app, fs }) {
	ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, async () => {
		const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
		return result.canceled ? undefined : result.filePaths[0];
	});

	ipcMain.handle(IPC_CHANNELS.getAppVersion, () => app.getVersion());

	ipcMain.handle(IPC_CHANNELS.pathExists, async (_event, filePath) => {
		const resolvedPath = assertAbsolutePath(filePath);
		try {
			await fs.access(resolvedPath);
			return true;
		} catch {
			return false;
		}
	});

	ipcMain.handle(IPC_CHANNELS.readFile, async (_event, filePath) => {
		return fs.readFile(assertAbsolutePath(filePath), 'utf8');
	});

	ipcMain.handle(IPC_CHANNELS.writeFile, async (_event, filePath, content) => {
		const resolvedPath = assertAbsolutePath(filePath);
		if (path.extname(resolvedPath).toLowerCase() !== '.json') {
			throw new TypeError('Only JSON translation files may be written.');
		}
		if (typeof content !== 'string') {
			throw new TypeError('File content must be a string.');
		}
		if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
			throw new RangeError(`File content exceeds the ${MAX_WRITE_BYTES} byte write limit.`);
		}

		await fs.writeFile(resolvedPath, content, 'utf8');
	});

	ipcMain.handle(IPC_CHANNELS.readDirectory, async (_event, directoryPath) => {
		const entries = await fs.readdir(assertAbsolutePath(directoryPath, 'Directory path'), {
			withFileTypes: true
		});
		return entries.map((entry) => ({
			name: entry.name,
			isDirectory: entry.isDirectory(),
			isFile: entry.isFile()
		}));
	});
}

module.exports = { MAX_WRITE_BYTES, assertAbsolutePath, registerIpcHandlers };
