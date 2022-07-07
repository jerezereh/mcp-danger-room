import { app, BrowserWindow, dialog, KeyboardEvent, Menu, MenuItem, MenuItemConstructorOptions } from 'electron';
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
        console.log(browserWindow);
        writeFileSync(app.getPath('userData') + '/data/roster.txt', 'test', 'utf-8');
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
              readFile(result.filePaths[0], (err, data) => {
                if (!err) {
                  browserWindow.webContents.send('loadRoster', data.toString());
                } else {
                  throw err;
                }
              });
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
