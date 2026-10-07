const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Sandboxed preload scripts only receive Electron's limited require function,
// so this bridge intentionally has no local or Node.js imports.
const channels = Object.freeze({
	loadProjectSettings: 'keylint:settings:load-project',
	saveProjectSettings: 'keylint:settings:save-project',
	deleteProjectSettings: 'keylint:settings:delete-project',
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
	loadProjectSettings: (projectRoot) => ipcRenderer.invoke(channels.loadProjectSettings, projectRoot),
	saveProjectSettings: (projectRoot, sources, guardrails) => ipcRenderer.invoke(channels.saveProjectSettings, projectRoot, sources, guardrails),
	deleteProjectSettings: (projectRoot) => ipcRenderer.invoke(channels.deleteProjectSettings, projectRoot),
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
