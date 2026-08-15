const IPC_CHANNELS = Object.freeze({
	selectProjectDirectory: 'keylint:dialog:select-project-directory',
	getAppVersion: 'keylint:app:get-version',
	pathExists: 'keylint:fs:path-exists',
	readFile: 'keylint:fs:read-file',
	writeFile: 'keylint:fs:write-file',
	readDirectory: 'keylint:fs:read-directory'
});

module.exports = { IPC_CHANNELS };
