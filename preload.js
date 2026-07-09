const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('terminal', {
  // PTY lifecycle (multi-pane)
  spawn: (paneId, cols, rows, shell) =>
    ipcRenderer.invoke('pty:spawn', paneId, cols, rows, shell),
  resize: (paneId, cols, rows) =>
    ipcRenderer.invoke('pty:resize', paneId, cols, rows),
  write: (paneId, data) =>
    ipcRenderer.invoke('pty:write', paneId, data),
  kill: (paneId) =>
    ipcRenderer.invoke('pty:kill', paneId),
  getShell: (paneId) =>
    ipcRenderer.invoke('pty:getShell', paneId),

  // Incoming data from PTY (all panes multiplexed by paneId)
  onData: (callback) => {
    const handler = (_event, paneId, data) => callback(paneId, data);
    ipcRenderer.on('pty:data', handler);
    return () => ipcRenderer.removeListener('pty:data', handler);
  },

  onExit: (callback) => {
    const handler = (_event, paneId, exitCode) => callback(paneId, exitCode);
    ipcRenderer.on('pty:exit', handler);
    return () => ipcRenderer.removeListener('pty:exit', handler);
  },

  // Menu events from main process
  onMenuSplit: (callback) => {
    const handler = (_event, direction) => callback(direction);
    ipcRenderer.on('menu:split', handler);
    return () => ipcRenderer.removeListener('menu:split', handler);
  },

  // Window controls
  setTitle: (title) => ipcRenderer.invoke('window:setTitle', title),

  getPlatform: () => process.platform,
});
