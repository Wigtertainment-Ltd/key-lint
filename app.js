const { app, BrowserWindow } = require('electron')
const url = require('url');
const path = require('path');
const remoteMain = require('@electron/remote/main');

let mainWindow
remoteMain.initialize();

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		webPreferences: {
			nodeIntegration: true,
			enableRemoteModule: true,
			contextIsolation: false
		}
	})
	remoteMain.enable(mainWindow.webContents);

	mainWindow.loadURL(
		url.format({
			pathname: path.join(__dirname, `/dist/check-i18n/browser/index.html`),
			protocol: "file:",
			slashes: true
		})
	);
	// Open the DevTools.
	mainWindow.webContents.openDevTools()

	mainWindow.setMenu(null);

	mainWindow.on('closed', function () {
		mainWindow = null
	})
}

app.on('ready', createWindow)

app.on('window-all-closed', function () {
	if (process.platform !== 'darwin') app.quit()
})

app.on('activate', function () {
	if (mainWindow === null) createWindow()
})
