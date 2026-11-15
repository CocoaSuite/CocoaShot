import type { App } from '../app'
import { native, isMac, UpdateInfo } from '../native'
import { h, icon, modal, toast } from './dom'
import { mb } from '../tools/common'

let dialogOpen = false

export async function checkForUpdates(app: App, silent = false) {
  if (!native) return
  let info: UpdateInfo
  try { info = await native.updateCheck() } catch (e: any) {
    if (!silent) toast('Could not check for updates: ' + (e.message || 'no connection'), { err: true })
    return
  }
  if (!info.newer) { if (!silent) updateDialog(app, info); return }
  if (silent) toast(`CocoaShot ${info.latest} is available`, { action: 'View', onAction: () => updateDialog(app, info), ms: 12000 })
  else updateDialog(app, info)
}

export function updateDialog(app: App, info: UpdateInfo) {
  if (dialogOpen) return
  dialogOpen = true
  const linux = !isMac && native!.platform === 'linux'
  const win = native!.platform === 'win32'
  modal(close => {
    const status = h('p', { class: 'hint' })
    const bar = h('i', { style: { width: '0%' } })
    const prog = h('div', { class: 'prog', hidden: true }, bar)
    const actions = h('div', { class: 'row' })
    const page = h('button', { onclick: () => native!.openReleases() }, 'Release page')
    const later = h('button', { onclick: close }, info.newer ? 'Later' : 'Close')
    const go = h('button', { class: 'pri' }, 'Download and install') as HTMLButtonElement
    const install = async () => {
      if (win && !(await app.closeAll())) { go.disabled = false; return }
      try {
        const r = await native!.updateInstall()
        if (r === 'opened') {
          status.textContent = isMac
            ? 'The update is open. Quit CocoaShot, drag the new CocoaShot into Applications to replace the old one, then open it again.'
            : 'The installer is open. Finish it, then restart CocoaShot.'
          go.hidden = true
        } else status.textContent = r === 'restarting' ? 'Restarting with the new version…' : 'Closing CocoaShot to run the installer…'
      } catch (e: any) { status.textContent = e.message; go.disabled = false }
    }
    go.onclick = async () => {
      go.disabled = true
      prog.hidden = false
      status.textContent = 'Downloading…'
      try {
        await native!.updateDownload(p => {
          bar.style.width = (p.total ? (p.loaded / p.total) * 100 : 50) + '%'
          status.textContent = `Downloading ${mb(p.loaded)}${p.total ? ' of ' + mb(p.total) : ''}`
        })
      } catch (e: any) { status.textContent = e.message; go.disabled = false; prog.hidden = true; return }
      bar.style.width = '100%'
      status.textContent = win ? 'Downloaded. CocoaShot will close and the installer will start.' : 'Downloaded.'
      go.textContent = win ? 'Install now' : linux ? 'Install and restart' : 'Open update'
      go.onclick = () => { go.disabled = true; install() }
      go.disabled = false
    }
    if (!info.latest) status.textContent = `You have version ${info.current}. No releases have been published yet.`
    else if (!info.newer) status.textContent = `You have the latest version, ${info.current}.`
    else if (!info.asset) status.textContent = `Version ${info.latest} is out, but it has no download for this computer yet. Use the release page.`
    else status.textContent = `You have ${info.current}. The download is ${mb(info.asset.size)}.`
    actions.append(page, h('span', { class: 'sp' }), later)
    if (info.newer && info.asset) actions.append(go)
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'fr' }, h('h2', info.newer ? `CocoaShot ${info.latest} is available` : 'CocoaShot is up to date'), h('span', { class: 'sp' }), h('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))),
      info.newer && info.notes ? h('pre', { class: 'notes' }, info.notes) : null,
      status, prog, actions)
  }, false, () => { dialogOpen = false })
}
