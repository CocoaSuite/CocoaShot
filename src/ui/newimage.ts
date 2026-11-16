import type { App } from '../app'
import { Doc } from '../core/doc'
import { canvas, ctx2d } from '../core/util'
import { h, modal, toast } from './dom'
import { numField } from './controls'

export type NewBg = 'white' | 'black' | 'transparent' | 'front' | 'back' | 'custom'
export interface NewImageOpts { w: number; h: number; bg: NewBg; color: string }

/** Largest side and area CocoaShot will make. Bigger canvases fail to draw in the browser engine. */
export const MAX_SIDE = 16384
export const MAX_AREA = 200e6

const PRESETS: [string, [string, number, number][]][] = [
  ['Screen', [['Full HD', 1920, 1080], ['QHD', 2560, 1440], ['4K UHD', 3840, 2160], ['HD', 1280, 720]]],
  ['Social media', [['Square post', 1080, 1080], ['Portrait post', 1080, 1350], ['Story or reel', 1080, 1920], ['Video thumbnail', 1280, 720], ['Wide post', 1600, 900], ['Profile banner', 1500, 500]]],
  ['Print at 300 dpi', [['A4', 2480, 3508], ['A5', 1748, 2480], ['US Letter', 2550, 3300], ['Photo 4 × 6 in', 1200, 1800], ['Photo 5 × 7 in', 1500, 2100]]],
  ['Icons', [['Icon 256', 256, 256], ['Icon 512', 512, 512], ['Icon 1024', 1024, 1024]]]
]

/** Makes a blank document. A null fill leaves it transparent. */
export function blankDoc(w: number, h: number, fill: string | null, name: string): Doc {
  const c = canvas(w, h)
  if (fill) { const x = ctx2d(c); x.fillStyle = fill; x.fillRect(0, 0, w, h) }
  const d = new Doc(c, name)
  d.layers[0].name = fill ? 'Background' : 'Layer 1'
  return d
}

let untitled = 0

/** File, New image: pick a size and background for a blank canvas. */
export function newImageDialog(app: App) {
  const o: NewImageOpts = { ...app.settings.newImage }
  const doc = app.doc
  const suggested = 'Untitled ' + (untitled + 1)
  let name = suggested

  const fillOf = (): string | null => ({ white: '#ffffff', black: '#000000', transparent: null, front: app.fg, back: app.bgc, custom: o.color })[o.bg]

  modal(close => {
    const W = numField('Width (px)', () => o.w, v => { o.w = v; sync() }, 1, MAX_SIDE)
    const H = numField('Height (px)', () => o.h, v => { o.h = v; sync() }, 1, MAX_SIDE)
    const preset = h('select', { 'aria-label': 'Preset' }) as HTMLSelectElement
    const fill = (sel: string) => {
      preset.innerHTML = ''
      preset.appendChild(h('option', { value: '' }, 'Custom size'))
      if (doc) preset.appendChild(h('option', { value: `${doc.w}x${doc.h}` }, `Same as ${doc.name} (${doc.w} × ${doc.h})`))
      for (const [group, items] of PRESETS) {
        const g = h('optgroup', { label: group })
        for (const [n, w, hh] of items) g.appendChild(h('option', { value: `${w}x${hh}` }, `${n} (${w} × ${hh})`))
        preset.appendChild(g)
      }
      preset.value = sel
      if (preset.value !== sel) preset.value = ''
    }
    preset.addEventListener('change', () => {
      if (!preset.value) return
      const [w, hh] = preset.value.split('x').map(Number)
      o.w = w; o.h = hh
      W.input.value = String(w); H.input.value = String(hh)
      sync()
    })
    const info = h('span', { class: 'hint' })
    const orient = h('span', { style: { display: 'flex', gap: '4px' } })
    const swap = (portrait: boolean) => {
      if ((o.h > o.w) === portrait || o.w === o.h) return
      ;[o.w, o.h] = [o.h, o.w]
      W.input.value = String(o.w); H.input.value = String(o.h)
      sync()
    }
    const portraitBtn = h('button', { class: 'ic', title: 'Portrait', 'aria-label': 'Portrait', onclick: () => swap(true) }, h('span', { style: { display: 'inline-block', width: '10px', height: '14px', border: '1.5px solid currentColor', borderRadius: '2px' } }))
    const landBtn = h('button', { class: 'ic', title: 'Landscape', 'aria-label': 'Landscape', onclick: () => swap(false) }, h('span', { style: { display: 'inline-block', width: '14px', height: '10px', border: '1.5px solid currentColor', borderRadius: '2px' } }))
    orient.append(portraitBtn, landBtn)
    const create = h('button', { class: 'pri', onclick: () => go() }, 'Create') as HTMLButtonElement

    const sync = () => {
      fill(`${o.w}x${o.h}`)
      portraitBtn.classList.toggle('on', o.h > o.w)
      landBtn.classList.toggle('on', o.w > o.h)
      const mp = (o.w * o.h) / 1e6
      const tooBig = o.w * o.h > MAX_AREA
      info.textContent = tooBig ? 'Too large: keep it under 200 megapixels.' : `${mp < 1 ? (o.w * o.h).toLocaleString() + ' pixels' : mp.toFixed(1) + ' megapixels'}`
      info.style.color = tooBig ? 'var(--danger, #e55)' : ''
      create.disabled = tooBig
    }

    const bgBtn = (v: NewBg, label: string, swatch: string | null) => {
      const b = h('button', { class: 'bgopt' + (o.bg === v ? ' on' : ''), onclick: () => { o.bg = v; for (const x of bgRow.children) x.classList.remove('on'); b.classList.add('on'); if (v === 'custom') colour.click() } },
        h('span', { class: 'sw' + (swatch ? '' : ' chk'), style: swatch ? { background: swatch } : {} }), label)
      return b
    }
    const colour = h('input', { type: 'color', value: o.color, style: { position: 'absolute', opacity: '0', pointerEvents: 'none', width: '0', height: '0' } }) as HTMLInputElement
    colour.addEventListener('input', () => { o.color = colour.value; (bgRow.lastElementChild!.querySelector('.sw') as HTMLElement).style.background = o.color })
    const bgRow = h('div', { class: 'bgopts' },
      bgBtn('white', 'White', '#ffffff'), bgBtn('black', 'Black', '#000000'), bgBtn('transparent', 'Transparent', null),
      bgBtn('front', 'Front colour', app.fg), bgBtn('back', 'Back colour', app.bgc), bgBtn('custom', 'Pick…', o.color))

    const nameIn = h('input', { type: 'text', value: name }) as HTMLInputElement
    nameIn.addEventListener('input', () => (name = nameIn.value))

    const go = () => {
      W.input.dispatchEvent(new Event('change')); H.input.dispatchEvent(new Event('change'))
      if (o.w * o.h > MAX_AREA) return
      app.settings.newImage = { ...o }
      app.saveSettings()
      const n = name.trim() || suggested
      if (n === suggested) untitled++
      close()
      try { app.setDoc(blankDoc(o.w, o.h, fillOf(), n)) }
      catch { toast('There is not enough memory for an image that large') }
    }

    const box = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: '380px' } },
      h('h2', 'New image'),
      h('div', { class: 'fr' }, h('label', 'Name'), h('div', { class: 'grow' }, nameIn)),
      h('div', { class: 'fr' }, h('label', 'Preset'), h('div', { class: 'grow' }, preset)),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '8px', alignItems: 'end' } }, W.el, H.el, orient),
      info,
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } }, h('label', { class: 'hint' }, 'Background'), bgRow, colour),
      h('div', { class: 'row' }, h('span', { class: 'sp' }), h('button', { onclick: () => close() }, 'Cancel'), create))
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); go() } })
    sync()
    setTimeout(() => { W.input.focus(); W.input.select() }, 0)
    return box
  })
}

