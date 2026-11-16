const { contextBridge, ipcRenderer } = require('electron')

let seq = 0
const progress = new Map()
ipcRenderer.on('ai-progress', (_e, p) => { const f = progress.get(p.id); if (f) f(p) })
let updateProgress = null
ipcRenderer.on('update-progress', (_e, p) => { if (updateProgress) updateProgress(p) })
const clean = e => { throw new Error(String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, '')) }

contextBridge.exposeInMainWorld('cocoaNative', {
  platform: process.platform,
  openDialog: kind => ipcRenderer.invoke('openDialog', kind),
  readPath: p => ipcRenderer.invoke('readPath', p),
  saveDialog: (name, filters, dir) => ipcRenderer.invoke('saveDialog', name, filters, dir),
  pickFolder: dir => ipcRenderer.invoke('pickFolder', dir),
  writePath: (p, data) => ipcRenderer.invoke('writePath', p, data),
  joinPath: (a, b) => ipcRenderer.invoke('joinPath', a, b),
  defaultFolder: () => ipcRenderer.invoke('defaultFolder'),
  showInFolder: p => ipcRenderer.invoke('showInFolder', p),
  recent: () => ipcRenderer.invoke('recent'),
  addRecent: item => ipcRenderer.invoke('addRecent', item),
  saveRecovery: data => ipcRenderer.invoke('saveRecovery', data),
  loadRecovery: () => ipcRenderer.invoke('loadRecovery'),
  clearRecovery: () => ipcRenderer.invoke('clearRecovery'),
  clipboardImage: () => ipcRenderer.invoke('clipboardImage'),
  copyImage: png => ipcRenderer.invoke('copyImage', png),
  modelsSize: () => ipcRenderer.invoke('modelsSize'),
  modelsFolder: () => ipcRenderer.invoke('modelsFolder'),
  dataFolder: () => ipcRenderer.invoke('dataFolder'),
  ai: (op, args, onProgress) => {
    const cid = ++seq
    if (onProgress) progress.set(cid, onProgress)
    return ipcRenderer.invoke('ai', cid, op, args)
      .catch(e => { throw new Error(String(e.message).replace(/^Error invoking remote method '\w+': (Error: )?/, '')) })
      .finally(() => progress.delete(cid))
  },
  aiCancel: () => ipcRenderer.invoke('aiCancel'),
  onOpenFile: cb => ipcRenderer.on('open-file', (_e, f) => cb(f)),
  onWantClose: cb => ipcRenderer.on('want-close', () => cb()),
  closeNow: () => ipcRenderer.send('close-now'),
  setTitle: t => ipcRenderer.send('setTitle', t),
  toggleFullScreen: () => ipcRenderer.invoke('toggleFullScreen'),
  onFullScreen: cb => ipcRenderer.on('fullscreen', (_e, v) => cb(v)),
  setTitleBar: (color, symbolColor, height) => ipcRenderer.send('setTitleBar', color, symbolColor, height),
  appVersion: () => ipcRenderer.invoke('appVersion'),
  appStarted: () => ipcRenderer.send('appStarted'),
  updateCheck: () => ipcRenderer.invoke('updateCheck').catch(clean),
  updateDownload: onProgress => { updateProgress = onProgress || null; return ipcRenderer.invoke('updateDownload').catch(clean).finally(() => { updateProgress = null }) },
  updateInstall: () => ipcRenderer.invoke('updateInstall').catch(clean),
  openReleases: () => ipcRenderer.invoke('openReleases'),
  appIcon: () => ipcRenderer.invoke('appIcon'),
  setAppIcon: t => ipcRenderer.invoke('setAppIcon', t),
  createShortcut: () => ipcRenderer.invoke('createShortcut').catch(clean)
})
