import { app, BrowserWindow, ipcMain, Menu } from 'electron';

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

  const menu = Menu.buildFromTemplate([
    {
      label: 'Menu',
      submenu: [
        {
          label: 'New Local Game',
          click: function () {},
        },
      ],
    },
    {
      label: 'Roster',
      id: 'Card Browser',
      enabled: true,
      submenu: [
        {
          label: 'New Roster',
          click: function () {
            console.log(app.getPath('appData'), app.getPath('home'));
          },
        },
        {
          label: 'Save Roster',
          click: function () {
            console.log(app.getPath('appData'), app.getPath('home'));
          },
        },
        {
          label: 'Load Roster',
          click: function () {
            console.log(app.getPath('appData'), app.getPath('home'));
          },
        },
      ],
    },
    {
      label: 'Game',
      id: 'Game View',
      enabled: false,
      submenu: [
        {
          label: 'Test',
          click: function () {},
        },
      ],
    },
    {
      label: 'Options',
      submenu: [{ role: 'selectAll' }, { role: 'reload' }, { role: 'toggleDevTools' }],
    },
  ]);

  Menu.setApplicationMenu(menu);
}

async function registerListeners() {
  /**
   * This comes from bridge integration, check bridge.ts
   */
  ipcMain.on('message', (_, message) => {
    console.log(message);
  });

  ipcMain.on('menu', (_, tabName) => {
    const menu = app.applicationMenu!.getMenuItemById(tabName)!;
    menu.enabled = !menu?.enabled;
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
