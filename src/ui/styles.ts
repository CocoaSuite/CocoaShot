import type { App } from '../app'
import type { Tool } from '../tools/types'
import { GROUPS } from '../tools/types'
import { h, icon, tip } from './dom'
import { ACTIONS, fmtCombo } from './keys'
import { colorPanel, SIZE_PRESETS } from '../tools/common'
import { canvas, ctx2d } from '../core/util'

export type UIStyle = 'classic' | 'ps' | 'sai'

/** Toolbar slots for the Photoshop-style layout. Each slot is a group; the first tool is its default face. */
export const SLOTS: (string[] | '-')[] = [
  ['move', 'transform'], ['marquee', 'ellipse-sel'], ['lasso', 'poly'], ['wand', 'obj-sel', 'subject'], ['crop', 'persp', 'resize'], ['picker'], '-',
  ['ai-remove', 'ai-cleanup', 'ai-enhance', 'ai-upscale', 'ai-detect'], ['brush', 'pencil', 'highlight'], ['clone'], ['eraser', 'bg-remove', 'bg-refine'], ['fill', 'gradient'], ['blur', 'sharpen', 'smudge'], '-',
  ['text'], ['arrow', 'line', 'rect', 'ellipse', 'callout', 'label', 'marker'], ['outline', 'spotlight'], '-', ['hand'], ['zoom']
]
export const slotOf = (id: string) => SLOTS.find(s => s !== '-' && s.includes(id)) as string[] | undefined

export function shortcutOf(app: App, id: string) {
  const a = ACTIONS.find(a => a.id === 'tool:' + id)
  const k = a ? app.settings.shortcuts[a.id] ?? a.key : ''
  return k ? fmtCombo(k) : ''
}

const faces = new Map<string[], string>()
export function noteTool(id: string) { const s = slotOf(id); if (s) faces.set(s, id) }
export const faceOf = (s: string[]) => faces.get(s) || s[0]

/** Shortcut handling for grouped tools: the key picks the group's last tool, pressing it again cycles. */
export function groupKey(app: App, id: string) {
  const s = slotOf(id)
  if (!s || s.length < 2) return id
  if (s.includes(app.toolId)) return s[(s.indexOf(app.toolId) + 1) % s.length]
  return faceOf(s)
}

/** A label you can drag sideways to change the value, as in Photoshop's options bar. */
export function scrub(label: string, get: () => number, set: (v: number) => void, o: { min: number; max: number; unit?: string; step?: number; w?: number }) {
  const inp = h('input', { type: 'number', min: o.min, max: o.max, step: o.step || 1, value: get(), style: { width: (o.w || 52) + 'px' } }) as HTMLInputElement
  const apply = (v: number) => { v = Math.min(o.max, Math.max(o.min, Math.round(v / (o.step || 1)) * (o.step || 1))); set(v); inp.value = String(v) }
  inp.addEventListener('change', () => apply(+inp.value || 0))
  inp.addEventListener('keydown', e => e.stopPropagation())
  const lab = h('span', { class: 'olab' }, label)
  lab.addEventListener('pointerdown', e => {
    const x0 = e.clientX, v0 = get(), span = o.max - o.min
    lab.setPointerCapture(e.pointerId)
    const mv = (ev: PointerEvent) => apply(v0 + ((ev.clientX - x0) / 200) * Math.min(span, 200) * (span > 200 ? span / 200 : 1) * (ev.shiftKey ? 0.2 : 1))
    lab.addEventListener('pointermove', mv)
    lab.addEventListener('pointerup', () => lab.removeEventListener('pointermove', mv), { once: true })
  })
  return h('span', { class: 'ofld' }, lab, inp, o.unit ? h('span', { class: 'ounit' }, o.unit) : null)
}

const stabSelect = (app: App, label: string) => {
  const s = h('select', { 'aria-label': label }, [0, 1, 2, 3, 4, 5, 6, 7].map(i => h('option', { value: i, selected: (app.settings.stabilizer || 0) === i }, i ? 'S-' + i : 'Off'))) as HTMLSelectElement
  s.addEventListener('change', () => { app.settings.stabilizer = +s.value; app.saveSettings() })
  return h('span', { class: 'ofld' }, h('span', { class: 'olab' }, label), s)
}

/** Options bar under the menus (Photoshop style). */
export function psOptions(app: App, run: Record<string, () => void>) {
  const bar = h('div', { id: 'opts' })
  const render = () => {
    bar.innerHTML = ''
    const t = app.tool
    if (!t || !app.doc) { bar.append(h('span', { class: 'mute' }, app.doc ? '' : 'Open an image to start')); return }
    bar.append(h('span', { class: 'otool' }, icon(t.icon), t.label), h('span', { class: 'sep' }))
    const b = t.brush?.()
    if (b) {
      bar.append(scrub('Size', b.getSize, v => { b.setSize(v); app.view.draw() }, { min: b.minSize ?? 1, max: b.maxSize ?? 1000, unit: 'px' }))
      const o = b.opts
      if (o) bar.append(scrub('Hardness', () => Math.round(o.hardness * 100), v => (o.hardness = v / 100), { min: 0, max: 100, unit: '%' }))
      if (b.getOpacity) bar.append(scrub('Opacity', () => Math.round(b.getOpacity!() * 100), v => b.setOpacity!(v / 100), { min: 1, max: 100, unit: '%' }))
      if (o) bar.append(scrub('Flow', () => Math.round(o.flow * 100), v => (o.flow = v / 100), { min: 1, max: 100, unit: '%' }))
      if (o) {
        const pr = tip(h('button', { class: 'ic' + (o.pressure ? ' on' : ''), onclick: () => { o.pressure = !o.pressure; render() } }, icon('pen')), 'Pen pressure changes size')
        bar.append(pr, stabSelect(app, 'Smoothing'))
      }
      const l = app.doc.active
      if (l?.canvas && b.opts) bar.append(tip(h('button', { class: 'ic' + (l.alphaLock ? ' on' : ''), onclick: () => app.hist!.op(l.alphaLock ? 'Unlock transparency' : 'Lock transparency', () => { l.alphaLock = !l.alphaLock }) }, icon('alpha')), 'Lock transparency'))
    } else bar.append(h('span', { class: 'mute', style: { fontSize: '12px' } }, 'Settings for this tool are in Properties on the right.'))
    bar.append(h('span', { class: 'sp' }))
    if (b) bar.append(h('span', { class: 'mute', style: { fontSize: '12px', display: 'flex', gap: '12px' } }, h('span', 'Ctrl-drag size'), h('span', 'Alt-drag opacity')), h('span', { class: 'sep' }))
    const z = h('button', { class: 'zoom', onclick: () => app.view.fit() }, Math.round(app.view.zoom * 100) + '%')
    bar.append(tip(h('button', { class: 'ic', onclick: () => run.zoomOut() }, icon('minus')), 'Zoom out'), tip(z, 'Fit to screen'), tip(h('button', { class: 'ic', onclick: () => run.zoomIn() }, icon('plus')), 'Zoom in'),
      tip(h('button', { class: 'ic' + (app.view.compare === 'split' ? ' on' : ''), onclick: () => run.compare() }, icon('compare')), 'Before and after'),
      tip(h('button', { class: 'ic', onclick: () => run.fullscreen() }, icon('fullscreen')), 'Full screen (F11)'),
      tip(h('button', { class: 'ic', onclick: () => run.settings() }, icon('gear')), 'Settings'))
  }
  for (const ev of ['tool', 'panel', 'doc', 'layers', 'zoom', 'compare']) app.on(ev, render)
  render()
  return bar
}

/** Narrow icon toolbar with grouped tools (Photoshop style). */
export function psStrip(app: App, run: Record<string, () => void>) {
  const strip = h('nav', { id: 'strip', 'aria-label': 'Tools' })
  let fly: HTMLElement | null = null
  const closeFly = () => { fly?.remove(); fly = null }
  addEventListener('pointerdown', e => { if (fly && !fly.contains(e.target as Node)) closeFly() }, true)
  const openFly = (s: string[], anchor: HTMLElement) => {
    closeFly()
    const r = anchor.getBoundingClientRect()
    fly = h('div', { class: 'fly', style: { left: r.right + 6 + 'px', top: r.top + 'px' } },
      s.map(id => { const t = app.tools.get(id)!; return h('button', { class: id === app.toolId ? 'on' : '', onclick: () => { closeFly(); app.setTool(id) } }, h('span', { class: 'mk' }, id === app.toolId ? '■' : ''), icon(t.icon), h('span', { class: 'sp' }, t.label), h('span', { class: 'mute' }, shortcutOf(app, id))) }))
    document.body.appendChild(fly)
  }
  let colorPop: HTMLElement | null = null
  const render = () => {
    strip.innerHTML = ''
    strip.classList.toggle('two', app.settings.toolCols === 2)
    strip.append(tip(h('button', { class: 'grip2', onclick: () => { app.settings.toolCols = app.settings.toolCols === 2 ? 1 : 2; app.saveSettings(); app.emit('style') } }), app.settings.toolCols === 2 ? 'One column' : 'Two columns'))
    const grid = h('div', { class: 'tgrid' })
    for (const s of SLOTS) {
      if (s === '-') { grid.append(h('span', { class: 'tsep' })); continue }
      const face = s.includes(app.toolId) ? app.toolId : faceOf(s)
      const t = app.tools.get(face)
      if (!t) continue
      const k = shortcutOf(app, face)
      const b = tip(h('button', { class: 'tb' + (s.includes(app.toolId) ? ' on' : '') }, icon(t.icon), s.length > 1 && h('span', { class: 'tri' })), t.label + (k ? ' (' + k + ')' : '') + (s.length > 1 ? ', hold for more' : ''))
      let hold = 0
      b.addEventListener('pointerdown', e => { if (e.button === 0 && s.length > 1) hold = window.setTimeout(() => { hold = -1; openFly(s, b) }, 380) })
      b.addEventListener('pointerup', () => { if (hold === -1) { hold = 0; return } clearTimeout(hold); hold = 0; app.setTool(face) })
      b.addEventListener('pointerleave', () => { if (hold > 0) clearTimeout(hold) })
      b.addEventListener('contextmenu', e => { e.preventDefault(); clearTimeout(hold); if (s.length > 1) openFly(s, b) })
      grid.append(b)
    }
    strip.append(grid)
    const fg = h('button', { class: 'sw fgs', style: { background: app.fg }, 'aria-label': 'Foreground colour' })
    const bg = h('button', { class: 'sw bgs', style: { background: app.bgc }, 'aria-label': 'Background colour' })
    const pop = () => {
      if (colorPop) { colorPop.remove(); colorPop = null; return }
      const r = fg.getBoundingClientRect()
      colorPop = h('div', { class: 'cpop', style: { left: r.right + 10 + 'px', top: Math.max(8, r.top - 300) + 'px' } }, colorPanel(app))
      document.body.appendChild(colorPop)
      const off = (e: PointerEvent) => { if (colorPop && !colorPop.contains(e.target as Node) && e.target !== fg) { colorPop.remove(); colorPop = null; removeEventListener('pointerdown', off, true) } }
      addEventListener('pointerdown', off, true)
    }
    fg.addEventListener('click', pop)
    bg.addEventListener('click', () => app.setColors(app.bgc, app.fg))
    strip.append(h('div', { class: 'fgbg2' }, bg, fg),
      tip(h('button', { class: 'ic small', onclick: () => run.swap() }, icon('swap')), 'Swap colours (X)'),
      h('span', { class: 'sp' }),
      tip(h('button', { class: 'tb', onclick: () => run.fullscreen() }, icon('fullscreen')), 'Full screen (F11)'))
  }
  app.on('tool', () => { noteTool(app.toolId); render() })
  app.on('colors', render)
  app.on('style', render)
  render()
  return strip
}

/** Icon column beside the right-hand panels (Photoshop style). */
export function psDock(app: App, showTab: (t: 'props' | 'hist') => void, curTab: () => string) {
  const dock = h('div', { id: 'dock' })
  const items: [string, string, () => void, () => boolean][] = [
    ['props', 'Properties', () => showTab('props'), () => curTab() === 'props' && !['adjust', 'levels', 'alpha', 'bg-replace'].includes(app.toolId)],
    ['history', 'History', () => showTab('hist'), () => curTab() === 'hist'],
    ['adjust', 'Adjustments', () => { showTab('props'); app.setTool('adjust') }, () => curTab() === 'props' && app.toolId === 'adjust'],
    ['levels', 'Levels', () => { showTab('props'); app.setTool('levels') }, () => curTab() === 'props' && app.toolId === 'levels'],
    ['alpha', 'Layer alpha', () => { showTab('props'); app.setTool('alpha') }, () => curTab() === 'props' && app.toolId === 'alpha'],
    ['bg', 'Background', () => { showTab('props'); app.setTool('bg-replace') }, () => curTab() === 'props' && app.toolId === 'bg-replace']
  ]
  const render = () => {
    dock.innerHTML = ''
    for (const [ic, label, fn, on] of items) dock.append(tip(h('button', { class: 'dk' + (on() ? ' on' : ''), onclick: fn }, icon(ic)), label))
  }
  for (const ev of ['tool', 'insp-tab']) app.on(ev, render)
  render()
  return dock
}

/** Row of view and history controls under the menus (SAI style). */
export function saiBar(app: App, run: Record<string, () => void>) {
  const bar = h('div', { id: 'saibar' })
  const zin = h('input', { type: 'text', class: 'val', style: { width: '58px' }, 'aria-label': 'Zoom' }) as HTMLInputElement
  zin.addEventListener('change', () => { const v = parseFloat(zin.value); if (v > 0) app.view.setZoom(v / 100); zin.blur() })
  zin.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') zin.blur() })
  const ain = h('input', { type: 'text', class: 'val', style: { width: '48px' }, 'aria-label': 'Rotation' }) as HTMLInputElement
  ain.addEventListener('change', () => { app.view.setAngle(parseFloat(ain.value) || 0); ain.blur() })
  ain.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') ain.blur() })
  const sb = (ic: string, label: string, fn: () => void) => tip(h('button', { class: 'sb', onclick: fn }, icon(ic)), label)
  const undoB = sb('undo', 'Undo', () => run.undo()), redoB = sb('redo', 'Redo', () => run.redo())
  const flipB = sb('fliph', 'Flip view', () => app.view.setFlip(!app.view.flip))
  const ants = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement
  ants.addEventListener('change', () => app.view.setShowAnts(ants.checked))
  bar.append(undoB, redoB, h('span', { class: 'sep' }),
    sb('x', 'Deselect', () => run.deselect()), sb('swap', 'Invert selection', () => run.invert()),
    h('label', { class: 'ck' }, ants, 'Show selection'), h('span', { class: 'sep' }),
    sb('minus', 'Zoom out', () => run.zoomOut()), zin, sb('plus', 'Zoom in', () => run.zoomIn()), sb('fit', 'Fit to window', () => run.fit()), h('span', { class: 'sep' }),
    sb('rotl', 'Rotate view left', () => app.view.setAngle(app.view.angle - 15)), ain, sb('rotr', 'Rotate view right', () => app.view.setAngle(app.view.angle + 15)),
    tip(h('button', { class: 'sb txt', onclick: () => app.view.setAngle(0) }, 'Reset'), 'Reset rotation'), flipB, h('span', { class: 'sep' }),
    stabSelect(app, 'Stabilizer'),
    h('span', { class: 'sp' }),
    h('span', { class: 'mute hintx', style: { display: 'flex', gap: '12px' } }, h('span', 'Ctrl-drag size'), h('span', 'Alt-drag opacity')),
    sb('compare', 'Before and after', () => run.compare()), sb('fullscreen', 'Full screen (F11)', () => run.fullscreen()), sb('gear', 'Settings', () => run.settings()),
    h('button', { class: 'pri', onclick: () => run.export() }, icon('download'), 'Export'))
  const sync = () => {
    if (document.activeElement !== zin) zin.value = (Math.round(app.view.zoom * 1000) / 10) + '%'
    if (document.activeElement !== ain) ain.value = (app.view.angle > 0 ? '+' : '') + app.view.angle + '°'
    flipB.classList.toggle('on', app.view.flip)
    undoB.toggleAttribute('disabled', !app.canUndo())
    redoB.toggleAttribute('disabled', !app.canRedo())
  }
  let raf = 0
  for (const ev of ['view', 'zoom', 'history', 'doc', 'steps', 'tool']) app.on(ev, () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync() }) })
  sync()
  return bar
}

const ptitle = (t: string, ...right: (HTMLElement | string)[]) => h('div', { class: 'pt' }, h('span', t), ...right)

/** Whole-image preview with the visible area, zoom and rotation (SAI style). */
export function saiNavigator(app: App) {
  const W = 210, H = 140
  const cv = h('canvas', { width: W * 2, height: H * 2, style: { width: W + 'px', height: H + 'px' }, 'aria-label': 'Navigator' }) as HTMLCanvasElement
  let thumb: HTMLCanvasElement | null = null, geo = { s: 1, x: 0, y: 0 }
  const makeThumb = () => {
    const d = app.doc
    if (!d) { thumb = null; return }
    const s = Math.min((W * 2 - 8) / d.w, (H * 2 - 8) / d.h)
    geo = { s, x: (W * 2 - d.w * s) / 2, y: (H * 2 - d.h * s) / 2 }
    thumb = canvas(Math.max(1, Math.round(d.w * s)), Math.max(1, Math.round(d.h * s)))
    const x = ctx2d(thumb); x.imageSmoothingQuality = 'high'; x.drawImage(d.comp, 0, 0, thumb.width, thumb.height)
  }
  const draw = () => {
    const x = ctx2d(cv), d = app.doc
    x.clearRect(0, 0, cv.width, cv.height)
    if (!d || !thumb) return
    x.drawImage(thumb, geo.x, geo.y)
    const v = app.view, { w, h: hh } = v.size()
    const pts = [[0, 0], [w, 0], [w, hh], [0, hh]].map(([sx, sy]) => { const u = v.unrotate(sx, sy); return [geo.x + ((u.x - v.ox) / v.zoom) * geo.s, geo.y + ((u.y - v.oy) / v.zoom) * geo.s] })
    x.save(); x.beginPath(); x.rect(geo.x - 3, geo.y - 3, thumb.width + 6, thumb.height + 6); x.clip()
    x.strokeStyle = '#e5484d'; x.lineWidth = 3; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a, b) : x.moveTo(a, b))); x.closePath(); x.stroke(); x.restore()
  }
  const go = (e: PointerEvent) => {
    const d = app.doc
    if (!d) return
    const r = cv.getBoundingClientRect()
    const dx = ((e.clientX - r.left) * 2 - geo.x) / geo.s, dy = ((e.clientY - r.top) * 2 - geo.y) / geo.s
    const { w, h: hh } = app.view.size()
    app.view.ox = w / 2 - dx * app.view.zoom; app.view.oy = hh / 2 - dy * app.view.zoom
    app.view.draw()
  }
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); go(e); const mv = (ev: PointerEvent) => go(ev); cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', () => cv.removeEventListener('pointermove', mv), { once: true }) })
  const zr = h('input', { type: 'range', min: -400, max: 500, value: 0, 'aria-label': 'Zoom' }) as HTMLInputElement
  const zv = h('span', { class: 'val' })
  zr.addEventListener('input', () => app.view.setZoom(Math.pow(2, +zr.value / 100)))
  const ar = h('input', { type: 'range', min: -180, max: 180, value: 0, 'aria-label': 'Rotation' }) as HTMLInputElement
  const av = h('span', { class: 'val' })
  ar.addEventListener('input', () => app.view.setAngle(+ar.value))
  const sync = () => {
    zr.value = String(Math.round(Math.log2(app.view.zoom) * 100)); zv.textContent = Math.round(app.view.zoom * 1000) / 10 + '%'
    ar.value = String(app.view.angle); av.textContent = app.view.angle + '°'
    for (const r of [zr, ar]) r.style.setProperty('--v', ((+r.value - +r.min) / (+r.max - +r.min)) * 100 + '%')
    draw()
  }
  let raf = 0, tt = 0
  app.on('view', () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync() }) })
  for (const ev of ['doc', 'history', 'layers']) app.on(ev, () => { clearTimeout(tt); tt = window.setTimeout(() => { makeThumb(); sync() }, ev === 'doc' ? 0 : 300) })
  makeThumb(); sync()
  return h('div', { class: 'pnl' }, ptitle('Navigator'),
    h('div', { class: 'pb' }, h('div', { class: 'navbox' }, cv),
      h('div', { class: 'srow' }, h('span', 'Zoom'), zr, zv),
      h('div', { class: 'srow' }, h('span', 'Angle'), ar, av)))
}

/** Colour panel (SAI style). */
export function saiColor(app: App) {
  return h('div', { class: 'pnl' }, ptitle('Colour'), h('div', { class: 'pb' }, colorPanel(app, false, undefined, undefined, 200)))
}

/** Tools as named tiles, picked by group (SAI style). */
export function saiTools(app: App) {
  const box = h('div', { class: 'pnl' })
  let group = ''
  const render = () => {
    const cur = GROUPS.find(g => g.tools.includes(app.toolId))
    if (!group) group = cur?.id || 'paint'
    const g = GROUPS.find(x => x.id === group) || GROUPS[0]
    box.innerHTML = ''
    box.append(ptitle('Tools', h('span', { class: 'mute' }, g.name)),
      h('div', { class: 'pb' },
        h('div', { class: 'gsel' }, GROUPS.map(x => tip(h('button', { class: x.id === g.id ? 'on' : '', onclick: () => { group = x.id; render() } }, icon(x.icon)), x.name))),
        h('div', { class: 'tiles' }, g.tools.map(id => { const t = app.tools.get(id); return t && h('button', { class: 'tile' + (id === app.toolId ? ' on' : ''), onclick: () => app.setTool(id) }, t.label) }))))
  }
  app.on('tool', () => { group = ''; render() })
  render()
  return box
}

/** Brush size presets as dots (SAI style). Hidden for tools without a brush. */
export function saiSizes(app: App) {
  const box = h('div', { class: 'sizes' })
  const render = () => {
    box.innerHTML = ''
    const b = app.tool?.brush?.()
    box.hidden = !b
    if (!b) return
    const cur = b.getSize()
    for (const s of SIZE_PRESETS) {
      if (s < (b.minSize ?? 1) || s > (b.maxSize ?? 1000)) continue
      const d = Math.max(2, Math.min(24, Math.round(2 + Math.sqrt(s) * 1.05)))
      box.append(h('button', { class: 'szc' + (s === cur ? ' on' : ''), 'aria-label': s + ' px', onclick: () => { b.setSize(s); app.emit('panel'); render(); app.view.draw() } },
        h('span', { class: 'dot2', style: { width: d + 'px', height: d + 'px' } }), String(s)))
    }
  }
  for (const ev of ['tool', 'panel']) app.on(ev, render)
  render()
  return box
}

export function toolTitle(t: Tool | undefined) { return t ? t.label : '' }
