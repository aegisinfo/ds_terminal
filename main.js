const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const pty = require('node-pty');

let mainWindow;
const ptyProcesses = new Map(); // paneId -> { pty, shell }

function getDefaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 700,
    minHeight: 450,
    title: 'Terminal DS',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Build application menu
  const menuTemplate = [
    {
      label: 'Terminal DS',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow(),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Split Vertically',
          accelerator: 'CmdOrCtrl+Shift+5',
          click: () => mainWindow.webContents.send('menu:split', 'vertical'),
        },
        {
          label: 'Split Horizontally',
          accelerator: 'CmdOrCtrl+Shift+6',
          click: () => mainWindow.webContents.send('menu:split', 'horizontal'),
        },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'F12',
          click: () => mainWindow.webContents.toggleDevTools(),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];

  if (process.platform === 'darwin') {
    menuTemplate.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Kill all PTYs
    for (const [paneId, proc] of ptyProcesses) {
      proc.pty.kill();
    }
    ptyProcesses.clear();
  });
}

// ─── PTY IPC handlers (multi-pane) ────────────────────────────────

ipcMain.handle('pty:spawn', (_event, paneId, cols, rows, shell) => {
  // Kill existing PTY for this pane if any
  if (ptyProcesses.has(paneId)) {
    ptyProcesses.get(paneId).pty.kill();
    ptyProcesses.delete(paneId);
  }

  const shellPath = shell || getDefaultShell();
  const shellName = path.basename(shellPath);

  const proc = pty.spawn(shellPath, [], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: process.env.HOME || process.cwd(),
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  proc.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:data', paneId, data);
    }
  });

  proc.onExit(({ exitCode }) => {
    ptyProcesses.delete(paneId);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('pty:exit', paneId, exitCode);
    }
  });

  ptyProcesses.set(paneId, { pty: proc, shell: shellName });
  return { shell: shellName };
});

ipcMain.handle('pty:resize', (_event, paneId, cols, rows) => {
  const proc = ptyProcesses.get(paneId);
  if (proc) {
    proc.pty.resize(cols, rows);
  }
});

ipcMain.handle('pty:write', (_event, paneId, data) => {
  const proc = ptyProcesses.get(paneId);
  if (proc) {
    proc.pty.write(data);
  }
});

ipcMain.handle('pty:kill', (_event, paneId) => {
  const proc = ptyProcesses.get(paneId);
  if (proc) {
    proc.pty.kill();
    ptyProcesses.delete(paneId);
  }
});

ipcMain.handle('pty:getShell', (_event, paneId) => {
  const proc = ptyProcesses.get(paneId);
  return proc ? proc.shell : 'unknown';
});

ipcMain.handle('window:setTitle', (_event, title) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setTitle(title);
  }
});

// ─── App lifecycle ────────────────────────────────────────────────

app.whenReady().then(createWindow);

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
