import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import { cardBrowserMenu, fullMenuTemplate, gameViewMenu } from './menuTemplates';

let mainWindow: BrowserWindow | null;

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// const assetsPath =
//   process.env.NODE_ENV === 'production'
//     ? process.resourcesPath
//     : app.getAppPath()

function createWindow() {
  mainWindow = new BrowserWindow({
    // icon: path.join(assetsPath, 'assets', 'icon.png'),
    title: 'MCP: Danger Room',
    width: 1200,
    height: 800,
    backgroundColor: '#191622',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: true,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  mainWindow.webContents.openDevTools();

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  Menu.setApplicationMenu(cardBrowserMenu);
}

async function registerListeners() {
  /**
   * This comes from bridge integration, check bridge.ts
   */
  ipcMain.on('message', (_, message) => {
    console.log(message);
  });

  ipcMain.on('menu', (_, tabName) => {
    if (tabName === 'Card Browser') {
      Menu.setApplicationMenu(cardBrowserMenu);
    } else if (tabName === 'Game View') {
      Menu.setApplicationMenu(gameViewMenu);
    }
  });

  ipcMain.on('getPath', (event, name) => {
    event.returnValue = app.getPath(name);
  });
}

app
  .on('ready', createWindow)
  .whenReady()
  .then(registerListeners)
  .catch(e => console.error(e));

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
