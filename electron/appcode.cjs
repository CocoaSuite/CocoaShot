// Code-only updates: newer interface code is unpacked into the user's data folder and served in
// place of the code inside the installed app, as long as it was built for this exact Electron side
// (see scripts/shell-id.mjs). If the new code fails to start once, the built-in code comes back.
const { app } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const zlib = require('zlib')
const crypto = require('crypto')

const ROOT = () => path.join(app.getPath('userData'), 'app-code')
const STATE = () => path.join(ROOT(), 'state.json')

const parse = v => String(v || '').replace(/^v/i, '').split(/[.+-]/).slice(0, 3).map(n => parseInt(n, 10) || 0)
function newer(a, b) {
  const x = parse(a), y = parse(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

let shellCache
function installedShell() {
  if (shellCache === undefined) { try { shellCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'shell-id.json'), 'utf8')).shell || null } catch { shellCache = null } }
  return shellCache
}

const readState = () => { try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')) } catch { return {} } }
const writeState = s => { fs.mkdirSync(ROOT(), { recursive: true }); fs.writeFileSync(STATE(), JSON.stringify(s)) }
const reset = () => { try { fs.rmSync(ROOT(), { recursive: true, force: true }) } catch {} }

let active = null

/** Picks the folder the interface is served from at start-up. */
function chooseDist(builtin) {
  active = { dir: builtin, version: app.getVersion(), code: false }
  const st = readState()
  if (!st.active) return active
  const dir = path.join(ROOT(), st.active)
  const usable = installedShell() && st.shell === installedShell() && newer(st.active, app.getVersion()) && fs.existsSync(path.join(dir, 'index.html'))
  if (!usable || (!st.confirmed && (st.tries || 0) >= 1)) { reset(); return active }
  if (!st.confirmed) writeState({ ...st, tries: (st.tries || 0) + 1 })
  active = { dir, version: st.active, code: true }
  return active
}

/** The interface reports that it started; keep the code it is running. */
function confirmStarted() {
  if (!active || !active.code) return
  const st = readState()
  if (st.active === active.version && !st.confirmed) writeState({ ...st, confirmed: true, tries: 0 })
}

/** Checks and unpacks a downloaded code update; it is used from the next start. */
async function installBundle(buf, m) {
  if (crypto.createHash('sha256').update(buf).digest('hex') !== m.sha256) throw new Error('The download did not match the release. Try again.')
  const b = JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
  if (b.app !== 'CocoaShot' || b.version !== m.version || b.shell !== installedShell() || !b.files || !b.files['index.html']) throw new Error('This update does not fit this installation')
  const dest = path.join(ROOT(), b.version), tmp = dest + '.tmp'
  await fsp.rm(tmp, { recursive: true, force: true })
  for (const [rel, data] of Object.entries(b.files)) {
    if (typeof data !== 'string' || !/^[\w@.\-/]+$/.test(rel) || rel.split('/').some(p => p === '..' || p === '' || p === '.')) throw new Error('This update contains an unexpected file')
    const f = path.join(tmp, rel)
    await fsp.mkdir(path.dirname(f), { recursive: true })
    await fsp.writeFile(f, Buffer.from(data, 'base64'))
  }
  for (const n of await fsp.readdir(ROOT()).catch(() => [])) if (n !== 'state.json' && n !== path.basename(tmp) && !(active && active.code && n === active.version)) await fsp.rm(path.join(ROOT(), n), { recursive: true, force: true })
  await fsp.rename(tmp, dest)
  writeState({ active: b.version, shell: b.shell, confirmed: false, tries: 0 })
}

module.exports = { newer, installedShell, chooseDist, confirmStarted, installBundle, current: () => active }
