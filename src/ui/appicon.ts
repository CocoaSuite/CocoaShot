import { native, type AppIconTheme } from '../native'
import { h, toast } from './dom'
import { tr } from '../i18n'

// Previews of the two app icons, the same artwork the desktop app ships.
const SVG: Record<AppIconTheme, string> = {
  amethyst: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="shot app icon"><rect width="100" height="100" rx="17.5" fill="#13203A"/><g transform="translate(23 21) scale(1.036)"><path d="M28.245 16.476L37.190 21.641L30.397 23.118L26.361 23.118Z" fill="#A3B9E0"/><path d="M38.104 22.451L38.104 32.780L33.428 27.636L31.410 24.140Z" fill="#A3B9E0"/><path d="M37.858 33.974L28.912 39.139L31.029 32.517L33.048 29.021Z" fill="#A3B9E0"/><path d="M27.756 39.524L18.810 34.359L25.604 32.882L29.640 32.882Z" fill="#A3B9E0"/><path d="M17.896 33.549L17.896 23.220L22.572 28.364L24.590 31.860Z" fill="#A3B9E0"/><path d="M18.143 22.024L27.089 16.860L24.971 23.482L22.953 26.977Z" fill="#A3B9E0"/><path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#A3B9E0"/></g></svg>',
  midnight: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="shot app icon"><rect width="100" height="100" rx="17.5" fill="#141A24"/><g transform="translate(23 21) scale(1.036)"><path d="M28.245 16.476L37.190 21.641L30.397 23.118L26.361 23.118Z" fill="#8AA7D9"/><path d="M38.104 22.451L38.104 32.780L33.428 27.636L31.410 24.140Z" fill="#8AA7D9"/><path d="M37.858 33.974L28.912 39.139L31.029 32.517L33.048 29.021Z" fill="#8AA7D9"/><path d="M27.756 39.524L18.810 34.359L25.604 32.882L29.640 32.882Z" fill="#8AA7D9"/><path d="M17.896 33.549L17.896 23.220L22.572 28.364L24.590 31.860Z" fill="#8AA7D9"/><path d="M18.143 22.024L27.089 16.860L24.971 23.482L22.953 26.977Z" fill="#8AA7D9"/><path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#8AA7D9"/></g></svg>'
}
const NAMES: [AppIconTheme, string][] = [['amethyst', tr('Amethyst')], ['midnight', tr('Midnight')]]

/** App icon choice and the desktop shortcut button, for the desktop app's settings. */
export function appIconSettings(): HTMLElement[] {
  const n = native
  if (!n?.setAppIcon) return []
  const pick = h('div', { class: 'iconpick', role: 'radiogroup', 'aria-label': tr('App icon') })
  const draw = (cur: AppIconTheme) => {
    pick.innerHTML = ''
    for (const [t, label] of NAMES) {
      const art = h('span', { class: 'art' }); art.innerHTML = SVG[t]
      pick.append(h('button', { class: t === cur ? 'on' : '', role: 'radio', 'aria-checked': String(t === cur), onclick: async () => {
        try { draw(await n.setAppIcon!(t)) } catch (e: any) { toast(e.message, { err: true }) }
      } }, art, label))
    }
  }
  draw('amethyst')
  n.appIcon?.().then(draw)
  const win = n.platform === 'win32'
  return [
    h('div', { class: 'fr' }, h('label', tr('App icon')), pick),
    h('p', { class: 'hint' }, win ? tr('Used for the window, the taskbar, CocoaShot shortcuts and the icons of files that open in CocoaShot.') : tr('Used for the window and the Dock.')),
    win && h('div', { class: 'fr' }, h('label', tr('Shortcut')), h('button', { onclick: async () => {
      try { await n.createShortcut!(); toast(tr('Shortcut created on the desktop')) } catch (e: any) { toast(e.message, { err: true }) }
    } }, tr('Create desktop shortcut')))
  ].filter(Boolean) as HTMLElement[]
}
