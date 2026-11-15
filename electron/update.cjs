const { app, ipcMain, net, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const crypto = require('crypto')
const { spawn } = require('child_process')

const REPO = 'CocoaSuite/CocoaShot'
const API = `https://api.github.com/repos/${REPO}/releases/latest`
const PAGE = `https://github.com/${REPO}/releases/latest`

const parse = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0)
function newer(a, b) {
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

function pickAsset(assets) {
  const files = (assets || []).filter(a => !/\.(blockmap|yml|yaml|sig|sha\d+)$/i.test(a.name))
  const archOk = a => {
    const n = a.name.toLowerCase()
    if (process.arch === 'arm64') return !/x64|x86_64|amd64/.test(n) || /arm64|aarch64|universal/.test(n)
    return !/arm64|aarch64/.test(n)
  }
  const find = re => files.filter(a => re.test(a.name)).sort((a, b) => archOk(b) - archOk(a))[0] || null
  if (process.platform === 'win32') return find(/\.exe$/i)
  if (process.platform === 'darwin') return find(/\.dmg$/i) || find(/mac.*\.zip$|\.zip$/i)
  if (process.env.APPIMAGE) return find(/\.AppImage$/i)
  return find(/\.deb$/i) || find(/\.AppImage$/i)
}

let latest = null
let downloaded = null

async function check() {
  const current = app.getVersion()
  const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CocoaShot/' + current } })
  if (res.status === 404) return { current, latest: null, newer: false, page: PAGE }
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Try again later.`)
  const r = await res.json()
  const asset = pickAsset(r.assets)
  latest = { version: String(r.tag_name || '').replace(/^v/i, ''), asset }
  return {
    current, latest: latest.version, newer: newer(latest.version, current),
    name: r.name || r.tag_name, notes: String(r.body || '').slice(0, 4000), date: r.published_at,
    page: r.html_url || PAGE, asset: asset && { name: asset.name, size: asset.size }
  }
}

async function download(send) {
  if (!latest || !latest.asset) throw new Error('There is no download for this computer in the latest release')
  const a = latest.asset
  const dir = path.join(app.getPath('temp'), 'cocoashot-update')
  await fsp.mkdir(dir, { recursive: true })
  const file = path.join(dir, path.basename(a.name))
  const res = await net.fetch(a.browser_download_url, { headers: { 'User-Agent': 'CocoaShot/' + app.getVersion() } })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`)
  const total = a.size || +res.headers.get('content-length') || 0
  const tmp = file + '.part'
  const out = fs.createWriteStream(tmp)
  const hash = crypto.createHash('sha256')
  const reader = res.body.getReader()
  let loaded = 0, last = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r))
      loaded += value.length
      if (Date.now() - last > 150) { last = Date.now(); send({ loaded, total }) }
    }
  } finally { await new Promise(r => out.end(r)) }
  if (total && loaded !== total) { await fsp.rm(tmp, { force: true }); throw new Error('The download was incomplete. Try again.') }
  const digest = /^sha256:([0-9a-f]{64})$/i.exec(a.digest || '')
  if (digest && digest[1].toLowerCase() !== hash.digest('hex')) { await fsp.rm(tmp, { force: true }); throw new Error('The download did not match the release. Try again.') }
  await fsp.rename(tmp, file)
  send({ loaded, total })
  downloaded = file
  return { name: a.name }
}

async function install(quit) {
  const file = downloaded
  if (!file || !fs.existsSync(file)) throw new Error('Download the update first')
  if (process.platform === 'win32') {
    spawn(file, [], { detached: true, stdio: 'ignore' }).unref()
    setTimeout(quit, 300)
    return 'quitting'
  }
  if (process.platform === 'linux' && process.env.APPIMAGE && /\.AppImage$/i.test(file)) {
    const target = process.env.APPIMAGE
    const tmp = target + '.new'
    await fsp.copyFile(file, tmp)
    await fsp.chmod(tmp, 0o755)
    await fsp.rename(tmp, target)
    app.relaunch({ execPath: target, args: [] })
    setTimeout(quit, 300)
    return 'restarting'
  }
  const err = await shell.openPath(file)
  if (err) throw new Error(err)
  return 'opened'
}

function registerUpdates(getWin, quit) {
  ipcMain.handle('appVersion', () => app.getVersion())
  ipcMain.handle('updateCheck', () => check())
  ipcMain.handle('updateDownload', e => download(p => { if (!e.sender.isDestroyed()) e.sender.send('update-progress', p) }))
  ipcMain.handle('updateInstall', () => {
    if (!app.isPackaged) throw new Error('Updates install only in the packaged app')
    return install(quit)
  })
  ipcMain.handle('openReleases', () => shell.openExternal(PAGE))
}

module.exports = { registerUpdates, newer, pickAsset }
