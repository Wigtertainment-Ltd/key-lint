const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandboxed preload scripts only receive Electron's limited require function,
// so this bridge intentionally has no local or Node.js imports.
const channels = Object.freeze({
	selectProjectDirectory: 'keylint:dialog:select-project-directory',
	getAppVersion: 'keylint:app:get-version',
	pathExists: 'keylint:fs:path-exists',
	readFile: 'keylint:fs:read-file',
	writeFile: 'keylint:fs:write-file',
	readDirectory: 'keylint:fs:read-directory',
	analyzeTranslationLoaders: 'keylint:translations:analyze-loaders',
	fetchTranslationResource: 'keylint:translations:fetch-resource',
	endTranslationScan: 'keylint:translations:end-scan'
});

contextBridge.exposeInMainWorld('keyLint', Object.freeze({
	selectProjectDirectory: () => ipcRenderer.invoke(channels.selectProjectDirectory),
	getPathForFile: (file) => webUtils.getPathForFile(file),
	getAppVersion: () => ipcRenderer.invoke(channels.getAppVersion),
	pathExists: (filePath) => ipcRenderer.invoke(channels.pathExists, filePath),
	readFile: (filePath) => ipcRenderer.invoke(channels.readFile, filePath),
	writeFile: (filePath, content) => ipcRenderer.invoke(channels.writeFile, filePath, content),
	readDirectory: (directoryPath) => ipcRenderer.invoke(channels.readDirectory, directoryPath),
	analyzeTranslationLoaders: (files) => ipcRenderer.invoke(channels.analyzeTranslationLoaders, files),
	fetchTranslationResource: (request) => ipcRenderer.invoke(channels.fetchTranslationResource, request),
	endTranslationScan: (scanId) => ipcRenderer.invoke(channels.endTranslationScan, scanId)
}));
