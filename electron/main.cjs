const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, Menu, utilityProcess, clipboard, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { pathToFileURL } = require('url')

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

const DIST = path.join(__dirname, '..', 'dist')
const DATA = () => app.getPath('userData')
const MODELS = () => path.join(DATA(), 'models')
const RECENT = () => path.join(DATA(), 'recent.json')
const RECOVERY = () => path.join(DATA(), 'recovery.cocoashot')
const OPENABLE = /\.(png|jpe?g|webp|bmp|tiff?|gif|psd|cocoashot)$/i

let win = null
const pending = []

const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

async function writeAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  await fsp.writeFile(tmp, data)
  await fsp.rename(tmp, file)
}

async function readOpened(file) {
  try {
    const st = await fsp.stat(file)
    if (!st.isFile()) return null
    return { name: path.basename(file), path: file, data: ab(await fsp.readFile(file)) }
  } catch { return null }
}

async function deliver(file) {
  const f = await readOpened(file)
  if (!f) return
  if (win && !win.webContents.isLoading()) win.webContents.send('open-file', f)
  else pending.push(f)
}

const argvFiles = argv => argv.slice(1).filter(a => OPENABLE.test(a) && fs.existsSync(a))

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 900, minHeight: 560,
    title: 'CocoaShot',
    backgroundColor: '#121212',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, spellcheck: false }
  })
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' } })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault() })
  win.webContents.on('did-finish-load', () => { while (pending.length) win.webContents.send('open-file', pending.shift()) })
  win.on('close', e => {
    if (win.forceClose) return
    e.preventDefault()
    win.webContents.send('want-close')
  })
  win.loadURL(process.env.COCOA_DEV_URL || 'app://cocoashot/index.html')
  win.on('closed', () => { win = null })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_e, argv) => {
    for (const f of argvFiles(argv)) deliver(f)
    if (win) { if (win.isMinimized()) win.restore(); win.focus() }
  })
  app.on('open-file', (e, file) => { e.preventDefault(); deliver(file) })
  app.whenReady().then(() => {
    protocol.handle('app', req => {
      let p = decodeURIComponent(new URL(req.url).pathname)
      if (p === '/' || !p) p = '/index.html'
      const file = path.normalize(path.join(DIST, p))
      if (!file.startsWith(DIST)) return new Response('Not found', { status: 404 })
      return net.fetch(pathToFileURL(file).toString())
    })
    if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
    else Menu.setApplicationMenu(null)
    for (const f of argvFiles(process.argv)) deliver(f)
    createWindow()
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow() })
  })
  app.on('window-all-closed', () => { stopAI(); app.quit() })
}

ipcMain.on('close-now', () => { if (win) { win.forceClose = true; win.close() } })
ipcMain.on('setTitle', (_e, t) => { if (win) win.setTitle(String(t).slice(0, 200)) })

const IMG_FILTERS = [{ name: 'Images and projects', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'psd', 'cocoashot'] }]

ipcMain.handle('openDialog', async (_e, kind) => {
  const filters = kind === 'project' ? [{ name: 'CocoaShot project', extensions: ['cocoashot'] }] : kind === 'image-only' ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff', 'gif', 'psd'] }] : IMG_FILTERS
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters })
  if (r.canceled || !r.filePaths[0]) return null
  return readOpened(r.filePaths[0])
})
ipcMain.handle('readPath', (_e, p) => readOpened(p))
ipcMain.handle('saveDialog', async (_e, name, filters, dir) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(dir || app.getPath('pictures'), name), filters })
  return r.canceled ? null : r.filePath
})
ipcMain.handle('pickFolder', async (_e, dir) => {
  const r = await dialog.showOpenDialog(win, { defaultPath: dir || app.getPath('pictures'), properties: ['openDirectory', 'createDirectory'] })
  return r.canceled ? null : r.filePaths[0]
})
ipcMain.handle('writePath', async (_e, p, data) => { await writeAtomic(p, Buffer.from(data)); return p })
ipcMain.handle('joinPath', (_e, a, b) => path.join(a, b))
ipcMain.handle('defaultFolder', () => app.getPath('pictures'))
ipcMain.handle('showInFolder', (_e, p) => shell.showItemInFolder(p))

ipcMain.handle('recent', async () => { try { return JSON.parse(await fsp.readFile(RECENT(), 'utf8')) } catch { return [] } })
ipcMain.handle('addRecent', async (_e, item) => {
  let list = []
  try { list = JSON.parse(await fsp.readFile(RECENT(), 'utf8')) } catch {}
  list = [item, ...list.filter(x => x.path !== item.path)].slice(0, 12)
  await writeAtomic(RECENT(), JSON.stringify(list))
  return list
})
ipcMain.handle('saveRecovery', (_e, data) => writeAtomic(RECOVERY(), Buffer.from(data)))
ipcMain.handle('loadRecovery', async () => { try { return ab(await fsp.readFile(RECOVERY())) } catch { return null } })
ipcMain.handle('clearRecovery', () => fsp.rm(RECOVERY(), { force: true }))

ipcMain.handle('clipboardImage', async () => {
  if (clipboard.readImage) {
    const img = clipboard.readImage()
    return img.isEmpty() ? null : ab(img.toPNG())
  }
  for (const item of await clipboard.read()) {
    const t = item.types.find(t => t.startsWith('image/'))
    if (t) return await (await item.getType(t)).arrayBuffer()
  }
  return null
})
ipcMain.handle('copyImage', async (_e, png) => {
  if (clipboard.writeImage) return clipboard.writeImage(nativeImage.createFromBuffer(Buffer.from(png)))
  const { ClipboardItem } = require('electron')
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([Buffer.from(png)], { type: 'image/png' }) })])
})

async function dirSize(p) {
  let s = 0
  try {
    for (const e of await fsp.readdir(p, { withFileTypes: true })) {
      const f = path.join(p, e.name)
      s += e.isDirectory() ? await dirSize(f) : (await fsp.stat(f)).size
    }
  } catch {}
  return s
}
ipcMain.handle('modelsSize', () => dirSize(MODELS()))
ipcMain.handle('modelsFolder', () => { fs.mkdirSync(MODELS(), { recursive: true }); shell.openPath(MODELS()) })
ipcMain.handle('dataFolder', () => shell.openPath(DATA()))

let ai = null
let aiSeq = 0
const aiWait = new Map()

let aiLog = ''
let aiStopping = false
const AILOG = () => path.join(DATA(), 'ai.log')
function logAI(t) {
  aiLog = (aiLog + t).slice(-4000)
  fs.appendFile(AILOG(), t, () => {})
}

let aiCpu = false
function startAI() {
  if (ai) return ai
  aiLog = ''
  aiStopping = false
  const env = { ...process.env, COCOA_MODELS: MODELS() }
  if (aiCpu) env.COCOA_AI_CPU = '1'
  ai = utilityProcess.fork(path.join(__dirname, 'ai.mjs'), [], { env, serviceName: 'CocoaShot AI', stdio: 'pipe' })
  logAI(`\n--- ${new Date().toISOString()} AI engine started\n`)
  ai.stdout?.on('data', d => logAI(String(d)))
  ai.stderr?.on('data', d => logAI(String(d)))
  ai.on('message', m => {
    const w = aiWait.get(m.id)
    if (!w) return
    if (m.progress) { w.sender.send('ai-progress', { id: w.cid, ...m.progress }); return }
    aiWait.delete(m.id)
    m.ok ? w.res(m.result) : w.rej(new Error(m.error))
  })
  ai.on('exit', code => {
    ai = null
    logAI(`--- AI engine stopped, code ${code}\n`)
    if (!aiStopping && !aiCpu && aiWait.size && [...aiWait.values()].every(w => !w.retried)) {
      aiCpu = true
      logAI('--- restarting the AI engine on the CPU\n')
      const p = startAI()
      for (const [id, w] of aiWait) { w.retried = true; p.postMessage({ id, op: w.op, args: w.args }) }
      return
    }
    const why = aiStopping ? 'Cancelled' : 'The AI engine stopped unexpectedly (code ' + code + '). ' + (aiLog.trim().split('\n').filter(l => /error|cannot|failed|not found/i.test(l)).slice(-2).join(' ') || 'Details are in ai.log in the CocoaShot data folder.')
    for (const w of aiWait.values()) w.rej(new Error(why))
    aiWait.clear()
  })
  return ai
}
function stopAI() { if (ai) { aiStopping = true; ai.kill(); ai = null } }

ipcMain.handle('ai', (e, cid, op, args) => new Promise((res, rej) => {
  const id = ++aiSeq
  aiWait.set(id, { res, rej, sender: e.sender, cid, op, args })
  startAI().postMessage({ id, op, args })
}))
ipcMain.handle('aiCancel', () => stopAI())
