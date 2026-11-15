import type { App } from '../app'
import type { Tool } from './types'
import { Layer, snapshot } from '../core/doc'
import { touch } from '../core/compose'
import { flood, morph, gauss } from '../core/px'
import { hitShape, shapeBounds } from '../core/shapes'
import { alphaOf, bboxOfAlpha, canvas, canvasFromAlpha, copyCanvas, ctx2d, getData } from '../core/util'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider, toggle } from '../ui/controls'
import { ai, jobBox, rgbaOf } from './common'
import type { Viewport, Pt } from '../view/viewport'

type Mode = 'new' | 'add' | 'sub' | 'int'
export const sel = { mode: 'new' as Mode, feather: 0, tol: 32, contiguous: true, sample: true, grow: 4 }

export function applySelection(app: App, mask: HTMLCanvasElement | null, mode: Mode, label: string) {
  const doc = app.doc!
  const before = snapshot(doc)
  if (!mask) doc.selection = null
  else {
    let m = mask
    if (sel.feather > 0) { m = canvas(doc.w, doc.h); const fx = ctx2d(m); fx.filter = `blur(${sel.feather}px)`; fx.drawImage(mask, 0, 0) }
    const res = canvas(doc.w, doc.h), x = ctx2d(res)
    if (mode === 'new' || !doc.selection) { if (mode !== 'sub') x.drawImage(m, 0, 0) }
    else {
      x.drawImage(doc.selection, 0, 0)
      x.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in'
      x.drawImage(m, 0, 0)
    }
    doc.selection = res
  }
  app.hist!.structural(label, before)
  doc.emit('selection')
}

function modeFrom(e: PointerEvent): Mode {
  if (e.shiftKey && e.altKey) return 'int'
  if (e.shiftKey) return 'add'
  if (e.altKey) return 'sub'
  return sel.mode
}

export function selectionOps(app: App): HTMLElement[] {
  const doc = app.doc
  const has = !!doc?.selection
  const out: HTMLElement[] = [
    sec('Selection'),
    h('div', { class: 'g2' },
      btn('Select all', () => selectAll(app)), btn('Deselect', () => applySelection(app, null, 'new', 'Deselect')),
      btn('Invert', () => invert(app)), btn('Copy to layer', () => toLayer(app))),
  ]
  if (has) {
    out.push(
      slider('Grow', () => sel.grow, v => (sel.grow = v), { min: -100, max: 100, unit: 'px' }),
      h('div', { class: 'g2' }, btn('Grow or shrink', () => growSel(app, sel.grow)), btn('Smooth edges', () => featherSel(app, 3))),
      h('div', { class: 'g2' }, btn('Delete pixels', () => deletePixels(app)), btn('Crop to selection', () => app.emit('crop-to-selection'))))
  }
  return out
}

export function selectAll(app: App) {
  const doc = app.doc!
  const m = canvas(doc.w, doc.h), x = ctx2d(m)
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h)
  applySelection(app, m, 'new', 'Select all')
}

export function invert(app: App) {
  const doc = app.doc!
  const m = canvas(doc.w, doc.h), x = ctx2d(m)
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h)
  if (doc.selection) { x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.selection, 0, 0) }
  applySelection(app, m, 'new', 'Invert selection')
}

function maskOp(app: App, label: string, fn: (a: Float32Array, w: number, h: number) => Float32Array) {
  const doc = app.doc!
  if (!doc.selection) return
  const a = alphaOf(doc.selection), f = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) f[i] = a[i] / 255
  const r = fn(f, doc.w, doc.h), u = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) u[i] = Math.max(0, Math.min(255, r[i] * 255))
  const f0 = sel.feather; sel.feather = 0
  applySelection(app, canvasFromAlpha(u, doc.w, doc.h), 'new', label)
  sel.feather = f0
}
export const growSel = (app: App, px: number) => maskOp(app, px >= 0 ? 'Grow selection' : 'Shrink selection', (f, w, h) => morph(f, w, h, px))
export const featherSel = (app: App, px: number) => maskOp(app, 'Feather selection', (f, w, h) => gauss(f, w, h, px))

export async function toLayer(app: App) {
  const doc = app.doc!
  const src = doc.active?.canvas
  if (!src) return
  await app.hist!.op('Copy to layer', () => {
    const l = { ...doc.active! }
    const nl = makeCopy(doc, doc.active!)
    if (doc.selection) { const x = ctx2d(nl.canvas!); x.globalCompositeOperation = 'destination-in'; x.drawImage(doc.selection, 0, 0) }
    nl.name = l.name + ' copy'
    doc.add(nl, doc.activeId)
  })
}

export function makeCopy(doc: any, l: Layer): Layer {
  const n: Layer = { ...l, id: Math.random().toString(36).slice(2, 10), canvas: l.canvas ? copyCanvas(l.canvas) : null, mask: null, maskAI: null, cache: null, maskCache: null, dirty: true, maskDirty: null }
  if (l.mask && n.canvas) { const x = ctx2d(n.canvas); x.globalCompositeOperation = 'destination-in'; x.drawImage(l.cache || l.mask, 0, 0) }
  if (l.shape) n.shape = { ...l.shape }
  if (l.outline) n.outline = { ...l.outline }
  if (l.adjust) n.adjust = { ...l.adjust, levels: [...l.adjust.levels] }
  if (l.bg) n.bg = { ...l.bg }
  if (l.kind === 'image') n.kind = 'paint'
  return n
}

export function deletePixels(app: App) {
  const doc = app.doc!
  const l = app.activeRaster()
  if (!l) return
  if (!doc.selection) { toast('Make a selection first'); return }
  const r = { x: 0, y: 0, w: doc.w, h: doc.h }
  const before = getData(l.canvas!)
  const x = ctx2d(l.canvas!)
  x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.selection, 0, 0); x.restore()
  touch(l)
  app.hist!.raster('Delete pixels', l, 'canvas', r, before)
  doc.changed()
}

const modeSeg = () => seg<Mode>([['new', 'New'], ['add', 'Add'], ['sub', 'Subtract'], ['int', 'Intersect']], () => sel.mode, v => (sel.mode = v))

function shapeSelTool(app: App, id: string, label: string, ic: string, kind: 'rect' | 'ellipse' | 'lasso'): Tool {
  let a: { x: number; y: number } | null = null, b: { x: number; y: number } | null = null, pts: number[] = [], mode: Mode = 'new'
  return {
    id, label, icon: ic,
    cursor: () => 'crosshair',
    down(p) { a = { x: p.x, y: p.y }; b = a; pts = [p.x, p.y]; mode = modeFrom(p.e) },
    move(p, pressed) {
      if (!pressed || !a) return
      let x = p.x, y = p.y
      if (p.e.shiftKey && kind !== 'lasso') { const d = Math.max(Math.abs(x - a.x), Math.abs(y - a.y)); x = a.x + Math.sign(x - a.x || 1) * d; y = a.y + Math.sign(y - a.y || 1) * d }
      b = { x, y }
      if (kind === 'lasso') pts.push(p.x, p.y)
    },
    up() {
      if (!a || !b) return
      const doc = app.doc!
      const m = canvas(doc.w, doc.h), x = ctx2d(m)
      x.fillStyle = '#fff'
      const l = Math.min(a.x, b.x), t = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y)
      if (kind === 'lasso' ? pts.length < 6 : w < 2 || hh < 2) { a = b = null; if (mode === 'new' && doc.selection) applySelection(app, null, 'new', 'Deselect'); return }
      x.beginPath()
      if (kind === 'rect') x.rect(l, t, w, hh)
      else if (kind === 'ellipse') x.ellipse(l + w / 2, t + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2)
      else { x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]); x.closePath() }
      x.fill()
      a = b = null
      applySelection(app, m, mode, label)
    },
    overlay(x, v) {
      if (!a || !b) return
      x.save()
      x.translate(v.ox, v.oy); x.scale(v.zoom, v.zoom)
      x.lineWidth = 1 / v.zoom; x.setLineDash([4 / v.zoom, 4 / v.zoom]); x.strokeStyle = '#fff'
      x.beginPath()
      const l = Math.min(a.x, b.x), t = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y)
      if (kind === 'rect') x.rect(l, t, w, hh)
      else if (kind === 'ellipse') x.ellipse(l + w / 2, t + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2)
      else { x.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]) }
      x.stroke(); x.strokeStyle = '#000'; x.lineDashOffset = 4 / v.zoom; x.stroke()
      x.restore()
    },
    panel: () => h('div', { class: 'ib' }, sec(label), modeSeg(),
      slider('Feather', () => sel.feather, v => (sel.feather = v), { min: 0, max: 100, unit: 'px', def: 0 }),
      ...selectionOps(app))
  }
}

export function selectTools(app: App): Tool[] {
  let drag: { x: number; y: number; orig: HTMLCanvasElement | null; mask: HTMLCanvasElement | null; shape: any; handle: number; l: Layer } | null = null
  const handles = (l: Layer) => {
    const s = l.shape!
    if (s.type === 'text' || s.type === 'label' || s.type === 'marker') return []
    return [[s.x1, s.y1], [s.x2, s.y2]]
  }
  const move: Tool = {
    id: 'move', label: 'Move', icon: 'move',
    cursor: () => 'move',
    down(p) {
      const doc = app.doc!
      let l = doc.active
      const tol = 6 / app.view.zoom
      const hitL = [...doc.layers].reverse().find(x => x.visible && !x.locked && x.shape && hitShape(x.shape, p.x, p.y, tol))
      if (l?.shape) {
        const hs = handles(l)
        const hi = hs.findIndex(([hx, hy]) => Math.hypot(hx - p.x, hy - p.y) < 8 / app.view.zoom)
        if (hi >= 0) { drag = { x: p.x, y: p.y, orig: null, mask: null, shape: { ...l.shape! }, handle: hi, l }; return }
      }
      if (hitL && hitL !== l) { doc.activeId = hitL.id; l = hitL; app.emit('layers') }
      if (!l || l.locked) return
      if (l.shape) { drag = { x: p.x, y: p.y, orig: null, mask: null, shape: { ...l.shape }, handle: -1, l }; return }
      if (!l.canvas || l.kind === 'outline' || l.kind === 'background') return
      drag = { x: p.x, y: p.y, orig: copyCanvas(l.canvas), mask: l.mask ? copyCanvas(l.mask) : null, shape: null, handle: -1, l }
    },
    move(p, pressed) {
      if (!pressed || !drag) return
      const dx = p.x - drag.x, dy = p.y - drag.y, l = drag.l
      if (drag.shape) {
        const s = l.shape!, o = drag.shape
        if (drag.handle === 0) { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy }
        else if (drag.handle === 1) { s.x2 = o.x2 + dx; s.y2 = o.y2 + dy }
        else { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; s.x2 = o.x2 + dx; s.y2 = o.y2 + dy }
        touch(l); app.doc!.changed()
        return
      }
      const put = (c: HTMLCanvasElement, src: HTMLCanvasElement) => { const x = ctx2d(c); x.clearRect(0, 0, c.width, c.height); x.drawImage(src, Math.round(dx), Math.round(dy)) }
      put(l.canvas!, drag.orig!)
      if (drag.mask && l.mask) { put(l.mask, drag.mask); l.maskDirty = true }
      touch(l); app.doc!.changed()
    },
    up(p) {
      if (!drag) return
      const d = drag
      drag = null
      const moved = Math.hypot(p.x - d.x, p.y - d.y) > 0.5
      if (!moved) return
      const doc = app.doc!
      if (d.shape) {
        const now = { ...d.l.shape! }
        const before = snapshot(doc)
        before.layers.find(x => x.ref === d.l)!.p.shape = d.shape
        d.l.shape = now
        app.hist!.structural('Move ' + d.l.name, before)
        return
      }
      const before = snapshot(doc)
      const bl = before.layers.find(x => x.ref === d.l)!.p
      bl.canvas = d.orig; bl.mask = d.mask
      d.l.canvas = copyCanvas(d.l.canvas!)
      if (d.l.mask) d.l.mask = copyCanvas(d.l.mask)
      app.hist!.structural('Move ' + d.l.name, before)
      touch(d.l)
      doc.changed()
    },
    overlay(x, v) {
      const l = app.doc?.active
      if (!l?.shape) return
      const b = shapeBounds(l.shape)
      const p = v.toScreen(b.x, b.y)
      x.save()
      x.strokeStyle = '#8AA7D9'; x.lineWidth = 1; x.setLineDash([4, 3])
      x.strokeRect(p.x, p.y, b.w * v.zoom, b.h * v.zoom)
      x.setLineDash([])
      for (const [hx, hy] of handles(l)) {
        const q = v.toScreen(hx, hy)
        x.fillStyle = '#fff'; x.strokeStyle = '#8AA7D9'; x.lineWidth = 1.5
        x.beginPath(); x.arc(q.x, q.y, 5, 0, Math.PI * 2); x.fill(); x.stroke()
      }
      x.restore()
    },
    panel: () => h('div', { class: 'ib' }, sec('Move'), hint('Drag to move the selected layer. Click a text or shape to select it, and drag its round handles to reshape it.'), ...selectionOps(app))
  }

  const wand: Tool = {
    id: 'wand', label: 'Magic wand', icon: 'wand',
    cursor: () => 'crosshair',
    down(p) {
      const doc = app.doc!
      const x = Math.floor(p.x), y = Math.floor(p.y)
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return
      const src = sel.sample ? doc.comp : doc.active?.canvas || doc.comp
      const d = getData(src).data
      const m = flood(d, doc.w, doc.h, x, y, sel.tol, sel.contiguous)
      applySelection(app, canvasFromAlpha(m, doc.w, doc.h), modeFrom(p.e), 'Magic wand')
    },
    panel: () => h('div', { class: 'ib' }, sec('Magic wand'), hint('Click an area to select similar colours.'), modeSeg(),
      slider('Tolerance', () => sel.tol, v => (sel.tol = v), { min: 0, max: 255, def: 32 }),
      slider('Feather', () => sel.feather, v => (sel.feather = v), { min: 0, max: 100, def: 0 }),
      toggle('Connected areas only', () => sel.contiguous, v => (sel.contiguous = v)),
      toggle('Sample all layers', () => sel.sample, v => (sel.sample = v)),
      ...selectionOps(app))
  }

  let samFor: any = null
  let pts: { x: number; y: number; pos: boolean }[] = []
  let addPart = true
  const obj: Tool = {
    id: 'obj-sel', label: 'Object', icon: 'sparkle',
    cursor: () => 'crosshair',
    async down(p) {
      const doc = app.doc!
      if (p.x < 0 || p.y < 0 || p.x > doc.w || p.y > doc.h) return
      const mode = modeFrom(p.e)
      pts.push({ x: p.x, y: p.y, pos: addPart && !p.e.altKey })
      app.view.draw()
      await app.run('Finding the object', async prog => {
        const key = doc.comp
        const src = rgbaOf(doc.comp, 1024)
        const s = src.w / doc.w
        if (samFor !== key) { await ai(app, 'samEmbed', src, prog); samFor = key }
        const r = await ai(app, 'samMask', { points: pts.map(q => [q.x * s, q.y * s]), labels: pts.map(q => (q.pos ? 1 : 0)) }, prog)
        const m = canvasFromAlpha(r.mask, r.w, r.h)
        const full = canvas(doc.w, doc.h); const fx = ctx2d(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(m, 0, 0, doc.w, doc.h)
        applySelection(app, full, pts.length > 1 && mode === 'new' ? 'new' : mode, 'Select object')
      })
    },
    overlay(x, v) {
      for (const q of pts) {
        const s = v.toScreen(q.x, q.y)
        x.beginPath(); x.arc(s.x, s.y, 5, 0, Math.PI * 2)
        x.fillStyle = q.pos ? '#8AA7D9' : '#ff8a73'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke()
      }
    },
    activate() { pts = [] },
    deactivate() { pts = [] },
    panel: () => h('div', { class: 'ib' }, sec('Select object'),
      hint('Click an object to select it. Keep clicking to refine the selection.'),
      seg<'a' | 'r'>([['a', 'Include part'], ['r', 'Exclude part']], () => (addPart ? 'a' : 'r'), v => (addPart = v === 'a')),
      jobBox(app), btn('Start over', () => { pts = []; applySelection(app, null, 'new', 'Deselect') }, 'wide'), ...selectionOps(app))
  }

  const subject: Tool = {
    id: 'subject', label: 'Subject', icon: 'person',
    panel: () => h('div', { class: 'ib' }, sec('Select subject'),
      hint('Finds the main subject of the photo and selects it.'),
      h('button', { class: 'pri big wide', onclick: () => selectSubject(app) }, icon('sparkle'), 'Select subject'), jobBox(app), ...selectionOps(app))
  }

  return [move,
    shapeSelTool(app, 'marquee', 'Rectangle', 'rect', 'rect'),
    shapeSelTool(app, 'ellipse-sel', 'Ellipse', 'ellipse', 'ellipse'),
    shapeSelTool(app, 'lasso', 'Lasso', 'lasso', 'lasso'),
    wand, obj, subject]
}

export async function selectSubject(app: App) {
  const doc = app.doc
  if (!doc) return
  await app.run('Finding the subject', async prog => {
    const src = rgbaOf(doc.comp, 1024)
    const r = await ai(app, 'removeBg', { ...src, model: app.settings.bgModel }, prog)
    const m = canvasFromAlpha(r.mask, r.w, r.h)
    const full = canvas(doc.w, doc.h); const fx = ctx2d(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(m, 0, 0, doc.w, doc.h)
    applySelection(app, full, 'new', 'Select subject')
  })
}

export const selectionBBox = (doc: any) => (doc.selection ? bboxOfAlpha(alphaOf(doc.selection), doc.w, doc.h) : null)
