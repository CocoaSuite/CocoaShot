import type { App } from '../app'
import { native, isMac, UpdateInfo } from '../native'
import { h, icon, modal, toast } from './dom'
import { mb } from '../tools/common'
import { tr, trMessage, tx } from '../i18n'

let dialogOpen = false

export async function checkForUpdates(app: App, silent = false) {
  if (!native) return
  let info: UpdateInfo
  try { info = await native.updateCheck() } catch (e: any) {
    if (!silent) toast(tr('Could not check for updates: {0}', e.message ? trMessage(e.message) : tr('no connection')), { err: true })
    return
  }
  if (!info.newer) { if (!silent) updateDialog(app, info); return }
  if (silent) toast(tr('CocoaShot {0} is available', info.latest!), { action: tx('verb', 'View'), onAction: () => updateDialog(app, info), ms: 12000 })
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
    const page = h('button', { onclick: () => native!.openReleases() }, tr('Release page'))
    const later = h('button', { onclick: close }, info.newer ? tr('Later') : tr('Close'))
    const code = info.asset?.kind === 'code'
    const go = h('button', { class: 'pri' }, code ? tr('Update') : tr('Download and install')) as HTMLButtonElement
    const install = async () => {
      if ((code || win || linux) && !(await app.closeAll())) { go.disabled = false; return }
      try {
        const r = await native!.updateInstall()
        if (r === 'opened') {
          status.textContent = isMac
            ? tr('The update is open. Quit CocoaShot, drag the new CocoaShot into Applications to replace the old one, then open it again.')
            : tr('The installer is open. Finish it, then restart CocoaShot.')
          go.hidden = true
        } else status.textContent = r === 'restarting' ? tr('Restarting with the new version…') : tr('Closing CocoaShot to run the installer…')
      } catch (e: any) { status.textContent = trMessage(e.message); go.disabled = false }
    }
    go.onclick = async () => {
      go.disabled = true
      prog.hidden = false
      status.textContent = tr('Downloading…')
      try {
        await native!.updateDownload(p => {
          bar.style.width = (p.total ? (p.loaded / p.total) * 100 : 50) + '%'
          status.textContent = p.total ? tr('Downloading {0} of {1}', mb(p.loaded), mb(p.total)) : tr('Downloading {0}', mb(p.loaded))
        })
      } catch (e: any) { status.textContent = trMessage(e.message); go.disabled = false; prog.hidden = true; return }
      bar.style.width = '100%'
      status.textContent = code ? tr('Downloaded. CocoaShot restarts to finish. Open images are closed first, and you are asked about unsaved changes.') : win ? tr('Downloaded. CocoaShot will close and the installer will start.') : tr('Downloaded.')
      go.textContent = code ? tr('Restart now') : win ? tr('Install now') : linux ? tr('Install and restart') : tr('Open update')
      go.onclick = () => { go.disabled = true; install() }
      go.disabled = false
    }
    if (!info.latest) status.textContent = tr('You have version {0}. No releases have been published yet.', info.current)
    else if (!info.newer) status.textContent = tr('You have the latest version, {0}.', info.current)
    else if (!info.asset) status.textContent = tr('Version {0} is out, but it has no download for this computer yet. Use the release page.', info.latest)
    else if (code) status.textContent = tr('You have {0}. This is a small update to CocoaShot itself, {1}, applied with a quick restart.', info.current, mb(info.asset.size))
    else status.textContent = tr('You have {0}. The download is {1}, the full installer, because this version also updates the parts CocoaShot runs on.', info.current, mb(info.asset.size))
    actions.append(page, h('span', { class: 'sp' }), later)
    if (info.newer && info.asset) actions.append(go)
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('div', { class: 'fr' }, h('h2', info.newer ? tr('CocoaShot {0} is available', info.latest!) : tr('CocoaShot is up to date')), h('span', { class: 'sp' }), h('button', { class: 'ic', 'aria-label': tr('Close'), onclick: close }, icon('x'))),
      info.newer && info.notes ? h('pre', { class: 'notes' }, info.notes) : null,
      status, prog, actions)
  }, false, () => { dialogOpen = false })
}
