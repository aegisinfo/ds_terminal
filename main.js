const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');
const pty = require('node-pty');

let mainWindow;
const ptyProcesses = new Map(); // paneId -> { pty, shell }

// Which CLI pane 0 ("AEGIS" pane) should run, picked at launch time via
// `--session=aegis|claude` (e.g. from aegiscode's GUI, which spawns this app
// per-button instead of a bare OS terminal emulator). Defaults to aegis-cli
// so launching Terminal DS with no args keeps its original behavior.
const sessionArg = process.argv.find((a) => a.startsWith('--session='));
const initialSession = sessionArg ? sessionArg.slice('--session='.length) : 'aegis';

function getDefaultShell() {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

// Locate an installed aegis-cli entry point. It's always a self-contained
// executable/wrapper script (e.g. ~/.local/bin/aegis-cli execs a bundled
// node + main.js, or ~/.local/share/aegiscode-node/bin/aegis from a plain
// npm -g install) — never needs a separately-resolved Node binary here.
function findAegisCli() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const cmd = process.platform === 'win32' ? '.cmd' : '';
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', `aegis-cli${exe}`),
    path.join(home, '.local', 'bin', `aegis${exe}`),
    path.join(home, '.local', 'bin', `aegiscode${exe}`),
    path.join(home, '.local', 'share', 'aegiscode-node', 'bin', `aegis${exe}`),
    path.join(home, '.local', 'share', 'aegiscode-node', 'bin', `aegiscode${exe}`),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', `aegis-cli${cmd}`),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', `aegis${cmd}`),
    '/usr/local/bin/aegis-cli',
    '/usr/local/bin/aegis',
    '/usr/bin/aegis-cli',
    '/usr/bin/aegis',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  for (const name of ['aegis-cli', 'aegis']) {
    try {
      const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' })
        .trim().split(/\r?\n/)[0];
      if (found) return found;
    } catch {}
  }
  return null;
}

// Locate an installed Claude Code (`claude`) binary — same resolution
// strategy as findAegisCli() above.
function findClaudeCli() {
  const exe = process.platform === 'win32' ? '.exe' : '';
  const cmd = process.platform === 'win32' ? '.cmd' : '';
  const home = os.homedir();
  const candidates = [
    path.join(home, '.local', 'bin', `claude${exe}`),
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', `claude${cmd}`),
    path.join(home, '.npm-global', 'bin', `claude${exe}`),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  try {
    const found = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' })
      .trim().split(/\r?\n/)[0];
    if (found) return found;
  } catch {}
  return null;
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

  // 'aegis' / 'claude' are sentinels, not literal shell paths — the AEGIS
  // pane asks for aegis-cli or Claude Code specifically rather than an
  // explicit shell override.
  let shellPath;
  let aegisFound = true;
  let claudeFound = true;
  if (shell === 'aegis') {
    const aegisBin = findAegisCli();
    if (aegisBin) {
      shellPath = aegisBin;
    } else {
      aegisFound = false;
      shellPath = getDefaultShell();
    }
  } else if (shell === 'claude') {
    const claudeBin = findClaudeCli();
    if (claudeBin) {
      shellPath = claudeBin;
    } else {
      claudeFound = false;
      shellPath = getDefaultShell();
    }
  } else {
    shellPath = shell || getDefaultShell();
  }
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
  return { shell: shellName, aegisFound, claudeFound };
});

ipcMain.handle('session:getInitial', () => initialSession);

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
