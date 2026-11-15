import type { App } from '../app'
import { flatten } from '../core/compose'
import { encode, ExportFormat, ExportOpts } from '../core/io'
import { job } from '../core/jobs'
import { canvas, ctx2d, getData, putData, mkID } from '../core/util'
import { native, downloadLocal, isMac } from '../native'
import { h, icon, logo, modal, toast } from './dom'
import { hint, sec, seg, select, slider, toggle, numField } from './controls'
import { mb } from '../tools/common'
import { checkForUpdates } from './update'
import { ACTIONS, comboOf, fmtCombo } from './keys'

const EXT: Record<ExportFormat, string> = { png: 'png', jpg: 'jpg', webp: 'webp', tiff: 'tif', bmp: 'bmp' }

export function exportDialog(app: App) {
  const doc = app.doc
  if (!doc) return
  const o: ExportOpts = { format: app.settings.exportFormat, quality: app.settings.exportQuality, w: doc.w, h: doc.h, transparent: true, matte: '#ffffff', srgb: true, maxCompress: false }
  let name = doc.name
  let folder = app.settings.exportFolder
  const flat = flatten(doc)
  const est = h('span', { class: 'hint' }, '')
  let et = 0
  const estimate = () => {
    clearTimeout(et)
    et = window.setTimeout(async () => {
      const s = Math.min(1, Math.sqrt(400000 / (o.w * o.h)))
      const c = canvas(Math.max(1, Math.round(o.w * s)), Math.max(1, Math.round(o.h * s)))
      ctx2d(c).drawImage(flat, 0, 0, c.width, c.height)
      try { const b = await encode(c, { ...o, maxCompress: false }); est.textContent = 'About ' + mb(b.length / (s * s)) } catch { est.textContent = '' }
    }, 250)
  }
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } })
  const draw = () => {
    body.innerHTML = ''
    const lossy = o.format === 'jpg' || o.format === 'webp'
    const canAlpha = o.format !== 'jpg'
    const W = numField('Width', () => o.w, v => { o.w = v; o.h = Math.max(1, Math.round(v * doc.h / doc.w)); H.input.value = String(o.h); estimate() })
    const H = numField('Height', () => o.h, v => { o.h = v; o.w = Math.max(1, Math.round(v * doc.w / doc.h)); W.input.value = String(o.w); estimate() })
    const nameIn = h('input', { type: 'text', value: name }) as HTMLInputElement
    nameIn.addEventListener('input', () => (name = nameIn.value))
    body.append(...[
      h('h2', 'Export image'),
      hint('Exports a flattened copy. Save project keeps layers, masks and text editable.'),
      seg([['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['tiff', 'TIFF'], ['bmp', 'BMP']], () => o.format, v => { o.format = v as ExportFormat; draw(); estimate() }, 'Format'),
      lossy && slider('Quality', () => o.quality, v => { o.quality = v; estimate() }, { min: 10, max: 100 }),
      h('div', { class: 'fr' }, h('label', 'Size'), h('div', { class: 'g3 grow' }, W.el, H.el,
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--mute)' } }, 'Scale',
          h('select', { onchange: (e: Event) => { const k = +(e.target as HTMLSelectElement).value; o.w = Math.round(doc.w * k); o.h = Math.round(doc.h * k); draw(); estimate() } },
            [0.25, 0.5, 1, 2].map(k => h('option', { value: k, selected: Math.abs(o.w / doc.w - k) < 0.001 }, k * 100 + '%')))))),
      canAlpha && toggle('Keep transparent pixels', () => o.transparent, v => { o.transparent = v; estimate() }),
      o.format === 'png' && toggle('Smallest file (slower)', () => o.maxCompress, v => (o.maxCompress = v)),
      o.format === 'png' && toggle('Tag as sRGB colour', () => o.srgb, v => (o.srgb = v)),
      (!canAlpha || !o.transparent) && h('div', { class: 'fr' }, h('label', 'Background'), h('input', { type: 'color', value: o.matte, onchange: (e: Event) => { o.matte = (e.target as HTMLInputElement).value; estimate() } })),
      h('div', { class: 'fr' }, h('label', 'File name'), h('div', { class: 'grow' }, nameIn), h('span', { class: 'mute' }, '.' + EXT[o.format])),
      native && h('div', { class: 'fr' }, h('label', 'Folder'), h('input', { type: 'text', value: folder || 'Pictures', readOnly: true, class: 'grow' }),
        h('button', { onclick: async () => { const f = await native!.pickFolder(folder); if (f) { folder = f; draw() } } }, 'Browse')),
      h('div', { class: 'row' }, est, h('span', { class: 'sp' }),
        h('button', { onclick: () => close() }, 'Cancel'),
        h('button', { class: 'pri', onclick: go }, 'Export'))].filter(Boolean) as Node[])
  }
  const go = async () => {
    close()
    app.settings.exportFormat = o.format
    app.settings.exportQuality = o.quality
    if (folder) app.settings.exportFolder = folder
    app.saveSettings()
    await app.run('Exporting', async () => {
      let c = flat
      if (o.w !== doc.w || o.h !== doc.h) {
        const d = getData(flat)
        const out: Uint8ClampedArray = await job('lanczos', { data: d.data, w: doc.w, h: doc.h, dw: o.w, dh: o.h }, [d.data.buffer])
        c = canvas(o.w, o.h)
        putData(c, mkID(out, o.w, o.h))
      }
      const bytes = await encode(c, o)
      const file = (name.trim() || 'image') + '.' + EXT[o.format]
      if (native) {
        const p = await native.joinPath(folder || (await native.defaultFolder()), file)
        await native.writePath(p, bytes)
        toast(`Exported ${file}`, { action: 'Show in folder', onAction: () => native!.showInFolder(p) })
      } else { downloadLocal(file, bytes); toast(`Exported ${file}`) }
    })
  }
  draw(); estimate()
  const close = modal(() => body)
}

export function settingsDialog(app: App, page = 'general') {
  const nav = h('nav')
  const sect = h('section')
  const pages: [string, string, () => any[]][] = [
    ['general', 'General', () => [
      seg([['dark', 'Dark'], ['light', 'Light']], () => app.settings.theme, v => { app.settings.theme = v as any; app.saveSettings(); app.applyTheme(); app.view.resize() }, 'Theme'),
      select('Autosave', [['0', 'Off'], ['1', 'Every minute'], ['3', 'Every 3 minutes'], ['10', 'Every 10 minutes']], () => String(app.settings.autosave) as any, v => { app.settings.autosave = +v; app.saveSettings() }),
      hint('Autosave keeps a recovery copy of unsaved work so it can be restored after a crash.'),
      select('Large images', [['0', 'Keep full resolution'], ['4096', 'Reduce to 4096 px'], ['2048', 'Reduce to 2048 px']], () => String(app.settings.openLimit) as any, v => { app.settings.openLimit = +v; app.saveSettings() }),
      hint('Applies when opening images. The original file is never changed.')
    ]],
    ['export', 'Export', () => [
      select('Default format', [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['tiff', 'TIFF'], ['bmp', 'BMP']], () => app.settings.exportFormat, v => { app.settings.exportFormat = v; app.saveSettings() }),
      slider('Default quality', () => app.settings.exportQuality, v => { app.settings.exportQuality = v; app.saveSettings() }, { min: 10, max: 100 }),
      native && h('div', { class: 'fr' }, h('label', 'Folder'), h('span', { class: 'grow mute' }, app.settings.exportFolder || 'Pictures'),
        h('button', { onclick: async () => { const f = await native!.pickFolder(app.settings.exportFolder); if (f) { app.settings.exportFolder = f; app.saveSettings(); show('export') } } }, 'Change'))
    ]],
    ['ai', 'AI models', () => {
      const list = h('div', {}, h('p', { class: 'hint' }, native ? 'Loading' : 'AI tools are available in the desktop app.'))
      const size = h('span', { class: 'hint' })
      if (native) {
        native.modelsSize().then(s => (size.textContent = 'Using ' + mb(s) + ' on disk'))
        native.ai('status').then((st: any) => {
          list.innerHTML = ''
          for (const k of Object.keys(st)) {
            const m = st[k]
            const prog = h('div', { class: 'prog', hidden: true }, h('i'))
            const b = h('button', {
              class: m.installed ? 'danger' : '', onclick: async () => {
                b.disabled = true
                try {
                  if (m.installed) await native!.ai('remove', { key: k })
                  else { prog.hidden = false; await native!.ai('download', { key: k }, p => p.total && ((prog.firstChild as HTMLElement).style.width = (p.loaded / p.total) * 100 + '%')) }
                } catch (e: any) { toast(e.message, { err: true }) }
                show('ai')
              }
            }, m.installed ? 'Delete' : 'Download')
            list.appendChild(h('div', { class: 'mrow' }, h('div', { class: 'grow' }, h('b', m.name), h('div', { class: 'hint' }, `${m.use}. ${mb(m.size)}, ${m.license}.`), prog), m.installed && h('span', { class: 'mute' }, icon('check')), b))
          }
        })
      }
      return [
        toggle('Use the graphics card when available', () => app.settings.gpu, v => { app.settings.gpu = v; app.saveSettings(); native?.ai('setGpu', { on: v }) }),
        select('Background model', [['isnet', 'ISNet, general'], ['birefnet', 'BiRefNet, maximum detail']], () => (app.settings.bgModel === 'modnet' ? 'isnet' : app.settings.bgModel) as any, v => { app.settings.bgModel = v; app.saveSettings() }),
        hint('Models run on this computer. They are downloaded once, from huggingface.co or github.com, the first time a tool needs them. Images are never uploaded.'),
        list,
        h('div', { class: 'fr' }, size, h('span', { class: 'sp' }), native && h('button', { onclick: () => native!.modelsFolder() }, icon('folder'), 'Open models folder'))
      ]
    }],
    ['keys', 'Shortcuts', () => {
      const rows: HTMLElement[] = []
      for (const a of ACTIONS) {
        const cur = app.settings.shortcuts[a.id] ?? a.key
        const b = h('button', { class: 'kbd' }, cur ? fmtCombo(cur) : 'None')
        b.addEventListener('click', () => {
          b.textContent = 'Press keys'
          const k = (e: KeyboardEvent) => {
            e.preventDefault(); e.stopPropagation()
            if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
            removeEventListener('keydown', k, true)
            app.settings.shortcuts[a.id] = e.key === 'Escape' ? '' : comboOf(e)
            app.saveSettings()
            show('keys')
          }
          addEventListener('keydown', k, true)
        })
        rows.push(h('div', { class: 'mrow' }, h('span', { class: 'grow' }, a.label), b))
      }
      return [h('div', { class: 'fr' }, hint('Click a shortcut, then press the new keys.'), h('span', { class: 'sp' }), h('button', { onclick: () => { app.settings.shortcuts = {}; app.saveSettings(); show('keys') } }, 'Restore defaults')), ...rows]
    }],
    ['about', 'About', () => [
      h('div', { class: 'fr', style: { gap: '12px' } }, h('span', { style: { width: '40px', height: '40px', display: 'block' } }, logo()), h('div', {}, h('b', { style: { fontSize: '15px' } }, 'CocoaShot'), (() => { const v = h('div', { class: 'hint' }, 'Image editing without the complexity.'); native?.appVersion().then(n => { v.textContent = `Version ${n}. Image editing without the complexity.` }); return v })())),
      native && h('div', { class: 'fr' }, h('button', { onclick: () => checkForUpdates(app) }, 'Check for updates'), h('span', { class: 'sp' })),
      native && toggle('Check for updates when CocoaShot starts', () => app.settings.checkUpdates, v => { app.settings.checkUpdates = v; app.saveSettings() }),
      hint('Part of the Cocoa suite. Everything runs on this computer. No account, no subscription and no uploads.'),
      hint('Open source components: ONNX Runtime (MIT), Transformers.js (Apache-2.0), fflate (MIT), UTIF (MIT), ag-psd (MIT), Inter (OFL). AI models are listed with their licences under AI models.')
    ]]
  ]
  const show = (id: string) => {
    nav.innerHTML = ''
    for (const [pid, t] of pages) nav.appendChild(h('button', { class: pid === id ? 'on' : '', onclick: () => show(pid) }, t))
    sect.innerHTML = ''
    sect.append(...pages.find(p => p[0] === id)![2]().filter(Boolean) as HTMLElement[])
  }
  show(page)
  modal(close => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('div', { class: 'fr' }, h('h2', 'Settings'), h('span', { class: 'sp' }), h('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))),
    h('div', { class: 'set' }, nav, sect)), true)
}

export function helpDialog() {
  const steps: [string, string][] = [
    ['Remove a background', 'Open an image, choose Background, then Remove background. Use Refine to paint fixes, then Export as PNG.'],
    ['Highlight something', 'Choose Highlight & Outline, pick Highlight, then drag over the area or use a selection.'],
    ['Outline a subject', 'Remove the background or select the subject, then choose Outline and Outline layer.'],
    ['Resize or crop', 'Choose Crop & Resize. Pick a ratio or preset, adjust the frame and Apply.'],
    ['Remove an object', 'Choose AI Tools, then Remove object, and paint over it.'],
    ['Keep your work editable', 'Save project keeps layers, masks and text. Export makes a flat image for sharing.']
  ]
  modal(close => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('div', { class: 'fr' }, h('h2', 'Quick guide'), h('span', { class: 'sp' }), h('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))),
    ...steps.map(([t, d]) => h('div', {}, h('b', { style: { fontWeight: 500 } }, t), h('p', { class: 'hint', style: { marginTop: '2px' } }, d)))), true)
}
