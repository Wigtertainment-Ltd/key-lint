const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('path');
const fs = require('fs/promises');
const { autoUpdater } = require('electron-updater');
const { registerIpcHandlers } = require('./electron/ipc-handlers');

let mainWindow
const isSmokeTest = process.env.KEYLINT_SMOKE_TEST === '1';
registerIpcHandlers({ ipcMain, dialog, app, fs });

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		show: !isSmokeTest,
		icon: path.join(__dirname, 'build', 'icon.png'),
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			nodeIntegration: false,
			contextIsolation: true,
			sandbox: true
		}
	})

	const startUrl = process.env.ELECTRON_START_URL;
	let loadPromise;
	if (startUrl) {
		loadPromise = mainWindow.loadURL(startUrl);
	} else {
		loadPromise = mainWindow.loadFile(path.join(__dirname, 'dist', 'key-lint', 'browser', 'index.html'));
	}

	if (startUrl) {
		mainWindow.webContents.openDevTools();
	}

	mainWindow.setMenu(null);

	mainWindow.on('closed', function () {
		mainWindow = null
	})

	if (isSmokeTest) {
		const smokeTimeout = setTimeout(() => app.exit(1), 30000);
		loadPromise.then(() => {
			clearTimeout(smokeTimeout);
			app.quit();
		}).catch(() => {
			clearTimeout(smokeTimeout);
			app.exit(1);
		});
	}
}

// Auto-update applies to packaged Windows, macOS and Linux builds. The Windows
// portable executable, development server and CI smoke test are skipped on purpose.
function initAutoUpdater() {
	if (!app.isPackaged || process.env.ELECTRON_START_URL || process.env.PORTABLE_EXECUTABLE_DIR || isSmokeTest) {
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
