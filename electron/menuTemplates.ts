import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  KeyboardEvent,
  Menu,
  MenuItem,
  MenuItemConstructorOptions,
} from 'electron';
import { readFile, writeFileSync } from 'fs';

const fileMenu: MenuItemConstructorOptions = {
  label: 'File',
  id: 'fileMenu',
  enabled: true,
  submenu: [
    {
      label: 'New Local Game',
      click: function () {},
    },
  ],
};

const rosterMenu: MenuItemConstructorOptions = {
  label: 'Roster',
  id: 'cardBrowserMenu',
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
      click: function saveRoster(_menuItem: MenuItem, browserWindow: BrowserWindow | undefined, _event: KeyboardEvent) {
        try {
          if (browserWindow === undefined) {
            throw new Error();
          }
          dialog
            .showSaveDialog(browserWindow, {
              defaultPath: app.getPath('userData') + '/data/',
              properties: ['createDirectory'],
            })
            .then(result => {
              if (!result.canceled) {
                browserWindow.webContents.send('saveRoster'); // needs return value of roster data
                ipcMain.handleOnce('saveRoster', (_, data: string) => {
                  if (result.filePath !== undefined) {
                    writeFileSync(result.filePath, data);
                  }
                });
              }
            });
        } catch (e: any) {
          console.log(e);
        }
      },
    },
    {
      label: 'Load Roster',
      click: function (_menuItem: MenuItem, browserWindow: BrowserWindow | undefined, _event: KeyboardEvent) {
        try {
          if (browserWindow === undefined) {
            throw new Error();
          }
          dialog
            .showOpenDialog(browserWindow, {
              defaultPath: app.getPath('userData') + '/data/',
              properties: ['openFile'],
            })
            .then(result => {
              if (!result.canceled) {
                readFile(result.filePaths[0], (err, data) => {
                  if (!err) {
                    browserWindow.webContents.send('loadRoster', data.toString());
                  } else {
                    throw err;
                  }
                });
              }
            });
        } catch (e: any) {
          console.log(e);
        }
      },
    },
  ],
};

const gameMenu = {
  label: 'Game',
  id: 'gameViewMenu',
  enabled: true,
  submenu: [
    {
      label: 'Test',
      click: function () {},
    },
  ],
};

const optionsMenu: MenuItemConstructorOptions = {
  label: 'Options',
  id: 'optionsMenu',
  enabled: true,
  submenu: [
    {
      role: 'selectAll',
    },
    {
      role: 'reload',
    },
    {
      role: 'toggleDevTools',
    },
  ],
};

export const fullMenuTemplate = Menu.buildFromTemplate([fileMenu, rosterMenu, gameMenu, optionsMenu]);

export const cardBrowserMenu = Menu.buildFromTemplate([fileMenu, rosterMenu, optionsMenu]);

export const gameViewMenu = Menu.buildFromTemplate([fileMenu, gameMenu, optionsMenu]);
