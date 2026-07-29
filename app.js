const { app, BrowserWindow } = require('electron')
const url = require('url');
const path = require('path');
const remoteMain = require('@electron/remote/main');
const { autoUpdater } = require('electron-updater');

let mainWindow
remoteMain.initialize();

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		icon: path.join(__dirname, 'build', 'icon.png'),
		webPreferences: {
			nodeIntegration: true,
			enableRemoteModule: true,
			contextIsolation: false
		}
	})
	remoteMain.enable(mainWindow.webContents);

	const startUrl = process.env.ELECTRON_START_URL;
	if (startUrl) {
		mainWindow.loadURL(startUrl);
	} else {
		mainWindow.loadURL(
			url.format({
				pathname: path.join(__dirname, `/dist/key-lint/browser/index.html`),
				protocol: "file:",
				slashes: true
			})
		);
	}

	if (startUrl) {
		mainWindow.webContents.openDevTools();
	}

	mainWindow.setMenu(null);

	mainWindow.on('closed', function () {
		mainWindow = null
	})
}

// Auto-update only applies to the installed (NSIS) build. The portable executable
// and the dev server run are skipped on purpose.
function initAutoUpdater() {
	if (!app.isPackaged || process.env.ELECTRON_START_URL || process.env.PORTABLE_EXECUTABLE_DIR) {
		return;
	}

	// A failing update check (no published release yet, offline, ...) must never block startup.
	autoUpdater.on('error', (error) => {
		console.warn('Auto-update check failed:', error == null ? 'unknown error' : error.message);
	});

	const check = autoUpdater.checkForUpdatesAndNotify();
	if (check && typeof check.catch === 'function') {
		check.catch((error) => {
			console.warn('Auto-update check failed:', error.message);
		});
	}
}

app.on('ready', function () {
	createWindow();
	initAutoUpdater();
})

app.on('window-all-closed', function () {
	if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
	if (mainWindow === null) createWindow()
})
