const path = require('path');

const { IPC_CHANNELS } = require('./ipc-channels');
const { createRemoteTranslationTransport, serializeTransportError } = require('./remote-translation-transport');

const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_ANALYSIS_FILES = 2000;
const MAX_ANALYSIS_BYTES = 20 * 1024 * 1024;

async function defaultLoaderAnalyzer(files) {
	const detection = await import('@key-lint/core/detection');
	const ngx = detection.analyzeNgxTranslateHttpLoaders(files);
	const transloco = detection.analyzeTranslocoHttpLoaders(files);
	return {
		candidates: [...ngx.candidates, ...transloco.candidates],
		diagnostics: [...ngx.diagnostics, ...transloco.diagnostics],
		sourceFiles: files.map((file) => file.filePath)
	};
}

function assertAbsolutePath(value, label = 'Path') {
	if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
		throw new TypeError(`${label} must be a non-empty absolute path.`);
	}

	return path.normalize(value);
}

function registerIpcHandlers({ ipcMain, dialog, app, fs, remoteTransport = createRemoteTranslationTransport(), loaderAnalyzer = defaultLoaderAnalyzer }) {
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
		const resolvedDirectoryPath = assertAbsolutePath(directoryPath, 'Directory path');
		const entries = await fs.readdir(resolvedDirectoryPath, {
			withFileTypes: true
		});
		return Promise.all(entries.map(async (entry) => {
			const isSymbolicLink = entry.isSymbolicLink();
			let sizeBytes;
			if (entry.isFile() && !isSymbolicLink) {
				const stats = await fs.stat(path.join(resolvedDirectoryPath, entry.name));
				sizeBytes = stats.size;
			}

			return {
				name: entry.name,
				isDirectory: entry.isDirectory(),
				isFile: entry.isFile(),
				isSymbolicLink,
				sizeBytes
			};
		}));
	});

	ipcMain.handle(IPC_CHANNELS.analyzeTranslationLoaders, async (_event, files) => {
		if (!Array.isArray(files) || files.length > MAX_ANALYSIS_FILES) {
			throw new TypeError(`Loader analysis accepts at most ${MAX_ANALYSIS_FILES} source files.`);
		}
		let totalBytes = 0;
		const normalizedFiles = files.map((file) => {
			if (!file || typeof file !== 'object' || typeof file.filePath !== 'string' || typeof file.content !== 'string') {
				throw new TypeError('Loader analysis files require filePath and content strings.');
			}
			const filePath = assertAbsolutePath(file.filePath, 'Loader analysis file path');
			if (!/\.tsx?$/i.test(filePath)) throw new TypeError('Loader analysis accepts only TypeScript source files.');
			totalBytes += Buffer.byteLength(file.content, 'utf8');
			if (totalBytes > MAX_ANALYSIS_BYTES) throw new RangeError(`Loader analysis exceeds the ${MAX_ANALYSIS_BYTES} byte limit.`);
			return { filePath, content: file.content };
		});
		return loaderAnalyzer(normalizedFiles);
	});

	ipcMain.handle(IPC_CHANNELS.fetchTranslationResource, async (_event, request) => {
		try {
			return { ok: true, value: await remoteTransport.fetch(request) };
		} catch (error) {
			return { ok: false, error: serializeTransportError(error) };
		}
	});

	ipcMain.handle(IPC_CHANNELS.endTranslationScan, async (_event, scanId) => {
		try {
			remoteTransport.endScan(scanId);
			return { ok: true };
		} catch (error) {
			return { ok: false, error: serializeTransportError(error) };
		}
	});
}

module.exports = { MAX_ANALYSIS_BYTES, MAX_ANALYSIS_FILES, MAX_WRITE_BYTES, assertAbsolutePath, defaultLoaderAnalyzer, registerIpcHandlers };
