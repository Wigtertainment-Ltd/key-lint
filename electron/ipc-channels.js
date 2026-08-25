const IPC_CHANNELS = Object.freeze({
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

module.exports = { IPC_CHANNELS };
