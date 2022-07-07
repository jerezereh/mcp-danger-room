import { app, Menu, MenuItemConstructorOptions } from 'electron';

const fileMenu = {
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

const rosterMenu = {
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
