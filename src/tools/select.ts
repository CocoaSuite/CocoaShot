import type { App } from '../app'
import type { Tool } from './types'
import { cloneAdjust, cloneFx, Layer, shownLocked, shownVisible, snapshot, subtree } from '../core/doc'
import { effectiveMask, holdFx, layerFull, touch } from '../core/compose'
import { flood, morph, gauss } from '../core/px'
import { canRotate, flatBounds, hitShape, shapeCenter, turn } from '../core/shapes'
import { alphaOf, bboxOfAlpha, canvas, canvasFromAlpha, copyCanvas, ctx2d, fingerprint, getData, uid } from '../core/util'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider, toggle } from '../ui/controls'
import { ai, drawBrushCursor, jobBox, rgbaOf, samCache } from './common'
import { Stroke, type BrushOpts } from '../core/brush'
import { keyOf } from '../ui/keys'
import type { Viewport, Pt } from '../view/viewport'
import { toolSteps } from '../core/steps'

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
  const a = doc.active
  if (!a?.canvas) { toast('Select a layer with pixels first'); return }
  await app.hist!.op('Copy to layer', () => {
    const nl = makeCopy(doc, a)
    // Text, shapes, outlines and backgrounds are redrawn from their settings; the copy keeps their pixels instead.
    if (nl.kind !== 'paint' && nl.kind !== 'highlight') {
      const img = layerFull(doc, a)
      if (img) { const x = ctx2d(nl.canvas!); x.clearRect(0, 0, doc.w, doc.h); x.drawImage(img, 0, 0) }
      nl.kind = 'paint'; nl.shape = null; nl.outline = null; nl.bg = null; nl.bgFor = null
    }
    if (doc.selection) { const x = ctx2d(nl.canvas!); x.globalCompositeOperation = 'destination-in'; x.drawImage(doc.selection, 0, 0) }
    nl.name = a.name + ' copy'
    doc.add(nl, doc.activeId)
  })
}

/** A pixel copy of a layer with its mask applied. Nothing is shared with the original (effects included). */
export function makeCopy(doc: any, l: Layer): Layer {
  const n: Layer = {
    ...l, id: uid(), canvas: l.canvas ? copyCanvas(l.canvas) : null, mask: null, maskAI: null, cache: null, maskCache: null, dirty: true, maskDirty: null,
    maskOpts: { ...l.maskOpts }, shape: l.shape && { ...l.shape }, outline: l.outline && { ...l.outline }, adjust: l.adjust && cloneAdjust(l.adjust),
    bg: l.bg && { ...l.bg }, fx: cloneFx(l.fx), fxCache: null, fxKey: '', fxHold: null
  }
  if (l.mask && !l.maskOff && n.canvas) { const x = ctx2d(n.canvas); x.globalCompositeOperation = 'destination-in'; x.drawImage(effectiveMask(l) || l.mask, 0, 0) }
  if (l.kind === 'image') n.kind = 'paint'
  return n
}

export function deletePixels(app: App, label = 'Delete pixels') {
  const doc = app.doc!
  const l = app.activeRaster()
  if (!l) return
  if (!doc.selection) { toast('Make a selection first'); return }
  const r = { x: 0, y: 0, w: doc.w, h: doc.h }
  const before = getData(l.canvas!)
  const x = ctx2d(l.canvas!)
  x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.selection, 0, 0); x.restore()
  touch(l)
  app.hist!.raster(label, l, 'canvas', r, before)
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
      // Rectangles and ellipses snap to whole pixels, so their edges are crisp rather than half-selected.
      const snap = kind !== 'lasso'
      const l = snap ? Math.round(Math.min(a.x, b.x)) : Math.min(a.x, b.x), t = snap ? Math.round(Math.min(a.y, b.y)) : Math.min(a.y, b.y)
      const w = snap ? Math.round(Math.max(a.x, b.x)) - l : Math.abs(b.x - a.x), hh = snap ? Math.round(Math.max(a.y, b.y)) - t : Math.abs(b.y - a.y)
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
      const snap = kind !== 'lasso'
      const l = snap ? Math.round(Math.min(a.x, b.x)) : Math.min(a.x, b.x), t = snap ? Math.round(Math.min(a.y, b.y)) : Math.min(a.y, b.y)
      const w = snap ? Math.round(Math.max(a.x, b.x)) - l : Math.abs(b.x - a.x), hh = snap ? Math.round(Math.max(a.y, b.y)) - t : Math.abs(b.y - a.y)
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

export const moveOpts = { autoPick: false }

export function selectTools(app: App): Tool[] {
  /**
   * A move in progress. Shapes move their points; raster layers move their pixels (and mask). With a
   * selection, only the selected pixels move, and the selection moves with them.
   */
  type Drag = {
    x: number; y: number; l: Layer; handle: number; shape: any
    orig: HTMLCanvasElement | null; mask: HTMLCanvasElement | null
    float: HTMLCanvasElement | null; base: HTMLCanvasElement | null; sel: HTMLCanvasElement | null
    dx: number; dy: number
  }
  let drag: Drag[] | null = null
  let dragName = ''
  let rotSnap = false
  let hold: ReturnType<typeof holdFx> = null
  /** Where a shape's handles are on the image: its two points (0, 1) and the rotate handle (2). */
  const handles = (l: Layer): [number, number, number][] => {
    const s = l.shape!
    const a = canRotate(s) && s.rot ? (s.rot * Math.PI) / 180 : 0
    const c = shapeCenter(s)
    const out: [number, number, number][] = []
    if (s.type !== 'text' && s.type !== 'label' && s.type !== 'marker') for (const [i, px, py] of [[0, s.x1, s.y1], [1, s.x2, s.y2]]) { const q = turn(px, py, c, a); out.push([q.x, q.y, i]) }
    if (canRotate(s)) {
      const b = flatBounds(s)
      const q = turn(c.x, b.y - 24 / app.view.zoom, c, a)
      out.push([q.x, q.y, 2])
    }
    return out
  }
  /** The topmost visible, unlocked layer with something at (x, y). */
  const layerAt = (x: number, y: number): Layer | undefined => {
    const doc = app.doc!
    const tol = 6 / app.view.zoom
    const ix = Math.floor(x), iy = Math.floor(y)
    for (const l of [...doc.layers].reverse()) {
      if (l.kind === 'group' || l.kind === 'adjust' || !shownVisible(doc, l) || shownLocked(doc, l)) continue
      if (l.shape) { if (hitShape(l.shape, x, y, tol)) return l; continue }
      if (ix < 0 || iy < 0 || ix >= doc.w || iy >= doc.h) continue
      const img = layerFull(doc, l)
      if (img && getData(img, { x: ix, y: iy, w: 1, h: 1 }).data[3] > 8) return l
    }
  }
  const begin = (l: Layer, x: number, y: number, handle = -1, inFolder = false): Drag | null => {
    const doc = app.doc!
    const d: Drag = { x, y, l, handle, shape: null, orig: null, mask: null, float: null, base: null, sel: null, dx: 0, dy: 0 }
    if (l.shape) { d.shape = { ...l.shape }; return d }
    if (!l.canvas || l.kind === 'outline' || l.kind === 'background') return null
    d.orig = copyCanvas(l.canvas)
    if (doc.selection && !inFolder) {
      if (!selectionBBox(doc)) return null
      d.sel = doc.selection
      d.float = copyCanvas(d.orig)
      const fx = ctx2d(d.float); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(d.sel, 0, 0)
      d.base = copyCanvas(d.orig)
      const bx = ctx2d(d.base); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(d.sel, 0, 0)
    } else {
      d.mask = l.mask ? copyCanvas(l.mask) : null
      if (!inFolder) hold = holdFx(doc, l)
    }
    return d
  }
  const apply = (d: Drag, dx: number, dy: number) => {
    const doc = app.doc!, l = d.l
    d.dx = dx; d.dy = dy
    if (d.shape) {
      const s = l.shape!, o = d.shape
      if (d.handle === 2) {
        // Turn about the centre so the handle points at the cursor; Shift snaps to 15°.
        const c = shapeCenter(o)
        let deg = (Math.atan2(d.y + dy - c.y, d.x + dx - c.x) * 180) / Math.PI + 90
        if (rotSnap) deg = Math.round(deg / 15) * 15
        s.rot = ((deg % 360) + 540) % 360 - 180
      } else if (d.handle >= 0) {
        // Handle drags happen along the shape's own (turned) axes.
        const a = o.rot ? (-o.rot * Math.PI) / 180 : 0
        const ux = dx * Math.cos(a) - dy * Math.sin(a), uy = dx * Math.sin(a) + dy * Math.cos(a)
        if (d.handle === 0) { s.x1 = o.x1 + ux; s.y1 = o.y1 + uy } else { s.x2 = o.x2 + ux; s.y2 = o.y2 + uy }
      } else { s.x1 = o.x1 + dx; s.y1 = o.y1 + dy; s.x2 = o.x2 + dx; s.y2 = o.y2 + dy }
      touch(l); doc.changed()
      return
    }
    const rx = Math.round(dx), ry = Math.round(dy)
    const put = (c: HTMLCanvasElement, src: HTMLCanvasElement, under?: HTMLCanvasElement | null) => {
      const x = ctx2d(c); x.clearRect(0, 0, c.width, c.height)
      if (under) x.drawImage(under, 0, 0)
      x.drawImage(src, rx, ry)
    }
    if (d.float) {
      put(l.canvas!, d.float, d.base)
      const ns = canvas(doc.w, doc.h); ctx2d(ns).drawImage(d.sel!, rx, ry)
      doc.selection = ns
      doc.emit('selection-live', null)
    } else {
      put(l.canvas!, d.orig!)
      hold?.draw(new DOMMatrix().translate(rx, ry), false)
      if (d.mask && l.mask) { put(l.mask, d.mask); l.maskDirty = true }
    }
    touch(l); doc.changed()
  }
  /** Ends a move of one or more layers as a single undo step. */
  const finish = (list: Drag[], label?: string) => {
    hold?.end(); hold = null
    const doc = app.doc!
    if (!list.length) return
    const d0 = list[0]
    if (Math.hypot(d0.dx, d0.dy) < 0.5 && d0.handle !== 2) {
      for (const d of list) {
        if (d.float) { doc.selection = d.sel; doc.emit('selection') }
        if (d.shape) { d.l.shape = { ...d.shape }; touch(d.l) }
        else if (d.orig) { const x = ctx2d(d.l.canvas!); x.globalCompositeOperation = 'copy'; x.drawImage(d.orig, 0, 0); x.globalCompositeOperation = 'source-over'; touch(d.l) }
      }
      doc.changed()
      return
    }
    const before = snapshot(doc)
    for (const d of list) {
      const bl = before.layers.find(x => x.ref === d.l)!.p
      if (d.shape) { bl.shape = d.shape; d.l.shape = { ...d.l.shape! }; continue }
      bl.canvas = d.orig
      if (d.float) before.selection = d.sel
      else bl.mask = d.mask
      d.l.canvas = copyCanvas(d.l.canvas!)
      if (!d.float && d.l.mask) d.l.mask = copyCanvas(d.l.mask)
      touch(d.l)
    }
    app.hist!.structural(label || (d0.handle === 2 ? 'Rotate ' + d0.l.name : 'Move ' + (d0.float ? 'selection' : d0.l.name)), before)
    doc.changed()
    if (list.some(d => d.float)) doc.emit('selection')
  }
  /** Starts moving a layer, or everything inside a folder. */
  const beginAll = (l: Layer, x: number, y: number): Drag[] => {
    const doc = app.doc!
    if (l.kind !== 'group') { const d = begin(l, x, y); return d ? [d] : [] }
    const out: Drag[] = []
    for (const k of subtree(doc, l)) {
      if (k.kind === 'group' || k.kind === 'adjust' || shownLocked(doc, k)) continue
      const d = begin(k, x, y, -1, true)
      if (d) out.push(d)
    }
    return out
  }
  const move: Tool = {
    id: 'move', label: 'Move', icon: 'move',
    cursor: () => 'move',
    down(p) {
      const doc = app.doc!
      let l = doc.active
      if (l?.shape && !shownLocked(doc, l)) {
        const hit = handles(l).find(([hx, hy]) => Math.hypot(hx - p.x, hy - p.y) < 8 / app.view.zoom)
        if (hit) { const d = begin(l, p.x, p.y, hit[2]); drag = d ? [d] : null; dragName = ''; return }
      }
      // Text and shapes are picked by clicking them; any layer is picked with Ctrl-click or Pick layer.
      const pickAny = moveOpts.autoPick || p.e.ctrlKey || p.e.metaKey
      const tol = 6 / app.view.zoom
      const hit = pickAny ? layerAt(p.x, p.y) : [...doc.layers].reverse().find(x => shownVisible(doc, x) && !shownLocked(doc, x) && x.shape && hitShape(x.shape, p.x, p.y, tol))
      if (hit && hit !== l) { doc.activeId = hit.id; l = hit; app.emit('layers') }
      if (!l) return
      if (shownLocked(doc, l)) { toast(`${l.name} is locked`); return }
      if (!shownVisible(doc, l)) toast(`${l.name} is hidden`)
      drag = beginAll(l, p.x, p.y)
      dragName = l.kind === 'group' ? 'Move ' + l.name : ''
      if (!drag.length) drag = null
    },
    move(p, pressed) {
      if (!pressed || !drag) return
      const d0 = drag[0]
      let dx = p.x - d0.x, dy = p.y - d0.y
      if (p.e.shiftKey && d0.handle < 0) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      rotSnap = p.e.shiftKey
      for (const d of drag) apply(d, dx, dy)
    },
    up() {
      if (!drag) return
      const d = drag
      drag = null
      finish(d, dragName || undefined)
    },
    key(e) {
      const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const v = dir[e.key]
      if (!v || drag || e.ctrlKey || e.metaKey || e.altKey) return false
      const doc = app.doc
      const l = doc?.active
      if (!doc || !l) return true
      if (shownLocked(doc, l)) { toast(`${l.name} is locked`); return true }
      const k = e.shiftKey ? 10 : 1
      const list = beginAll(l, 0, 0)
      for (const d of list) apply(d, v[0] * k, v[1] * k)
      finish(list, 'Nudge ' + (doc.selection && l.kind !== 'group' ? 'selection' : l.name))
      return true
    },
    overlay(x, v) {
      const l = app.doc?.active
      if (!l?.shape) return
      const s = l.shape
      const b = flatBounds(s)
      const a = canRotate(s) && s.rot ? (s.rot * Math.PI) / 180 : 0
      const c = shapeCenter(s)
      const corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([px, py]) => { const q = turn(px, py, c, a); return v.toScreen(q.x, q.y) })
      x.save()
      x.strokeStyle = '#8AA7D9'; x.lineWidth = 1; x.setLineDash([4, 3])
      x.beginPath(); corners.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); x.closePath(); x.stroke()
      x.setLineDash([])
      for (const [hx, hy, i] of handles(l)) {
        const q = v.toScreen(hx, hy)
        if (i === 2) { const t0 = turn(c.x, b.y, c, a), top = v.toScreen(t0.x, t0.y); x.beginPath(); x.moveTo(top.x, top.y); x.lineTo(q.x, q.y); x.stroke() }
        x.fillStyle = i === 2 ? '#8AA7D9' : '#fff'; x.strokeStyle = i === 2 ? '#fff' : '#8AA7D9'; x.lineWidth = 1.5
        x.beginPath(); x.arc(q.x, q.y, 5, 0, Math.PI * 2); x.fill(); x.stroke()
      }
      x.restore()
    },
    panel: () => h('div', { class: 'ib' }, sec('Move'),
      hint('Drag to move the selected layer, or only the selected pixels when there is a selection. Arrow keys nudge by 1 px, Shift+arrow by 10 px, and Shift-drag keeps the move straight. Ctrl-click picks the layer under the cursor. Drag the filled handle above text and shapes to turn them.'),
      toggle('Pick layer by clicking', () => moveOpts.autoPick, v => (moveOpts.autoPick = v)),
      ...selectionOps(app))
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

  let pts: { x: number; y: number; pos: boolean }[] = []
  let addPart = true
  // Undo takes back the last click and the selection it made.
  let ptsAhead: { x: number; y: number; pos: boolean }[] = []
  const objSteps = {
    get canUndo() { return pts.length > 0 },
    get canRedo() { return ptsAhead.length > 0 && !!app.hist?.future.length },
    undo() { if (!pts.length || app.job) return false; ptsAhead.push(pts.pop()!); app.hist?.undo(); app.emit('steps'); return true },
    redo() { if (!ptsAhead.length || !app.hist?.future.length) return false; pts.push(ptsAhead.pop()!); app.hist.redo(); app.emit('steps'); return true },
    reset() { pts = []; ptsAhead = []; app.emit('steps') }
  }
  const obj: Tool = {
    id: 'obj-sel', label: 'Object', icon: 'sparkle', steps: objSteps,
    cursor: () => 'crosshair',
    async down(p) {
      const doc = app.doc!
      if (p.x < 0 || p.y < 0 || p.x > doc.w || p.y > doc.h) return
      if (app.job) return
      const mode = modeFrom(p.e)
      pts.push({ x: p.x, y: p.y, pos: addPart && !p.e.altKey })
      ptsAhead = []
      app.emit('steps')
      app.view.draw()
      const ok = await app.run('Finding the object', async prog => {
        const src = rgbaOf(doc.comp, 1024)
        // The image may have changed since the last click: compare a fingerprint of what the AI sees.
        const key = doc.rid + ':' + fingerprint(src.data)
        const s = src.w / doc.w
        if (samCache.key !== key) { samCache.key = ''; await ai(app, 'samEmbed', src, prog); samCache.key = key }
        const args = { points: pts.map(q => [q.x * s, q.y * s]), labels: pts.map(q => (q.pos ? 1 : 0)) }
        const r = await ai(app, 'samMask', args, prog).catch(async e => {
          if (!/No image/.test(e.message)) throw e
          await ai(app, 'samEmbed', src, prog)
          return ai(app, 'samMask', args, prog)
        })
        const m = canvasFromAlpha(r.mask, r.w, r.h)
        const full = canvas(doc.w, doc.h); const fx = ctx2d(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(m, 0, 0, doc.w, doc.h)
        applySelection(app, full, pts.length > 1 && mode === 'new' ? 'new' : mode, 'Select object')
        return true
      })
      // A failed or cancelled lookup made no selection, so its point is not an undo step.
      if (ok !== true) { pts.pop(); app.emit('steps'); app.view.draw() }
    },
    overlay(x, v) {
      for (const q of pts) {
        const s = v.toScreen(q.x, q.y)
        x.beginPath(); x.arc(s.x, s.y, 5, 0, Math.PI * 2)
        x.fillStyle = q.pos ? '#8AA7D9' : '#ff8a73'; x.fill(); x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.stroke()
      }
    },
    activate() { objSteps.reset() },
    deactivate() { objSteps.reset() },
    panel: () => h('div', { class: 'ib' }, sec('Select object'),
      hint('Click an object to select it. Keep clicking to refine the selection.'),
      seg<'a' | 'r'>([['a', 'Include part'], ['r', 'Exclude part']], () => (addPart ? 'a' : 'r'), v => (addPart = v === 'a')),
      jobBox(app), btn('Start over', () => { objSteps.reset(); applySelection(app, null, 'new', 'Deselect') }, 'wide'), ...selectionOps(app))
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
    polyTool(app), selBrushTool(app), wand, obj, subject]
}

function polyTool(app: App): Tool {
  let pts: number[] = [], hover: { x: number; y: number } | null = null, mode: Mode = 'new'
  // Each placed corner is its own undo step; Ctrl+Z takes back the last one.
  const steps = toolSteps(app, () => ({ pts: pts.slice(), mode }), v => { pts = v.pts; mode = v.mode })
  const discard = () => { pts = []; steps.reset(); app.view.draw() }
  const close = () => {
    const doc = app.doc!
    if (pts.length >= 6) {
      const m = canvas(doc.w, doc.h), x = ctx2d(m)
      x.fillStyle = '#fff'; x.beginPath(); x.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1])
      x.closePath(); x.fill()
      applySelection(app, m, mode, 'Polygon select')
    }
    discard()
  }
  const snap = (p: Pt) => {
    if (!p.e.shiftKey || !pts.length) return { x: p.x, y: p.y }
    const lx = pts[pts.length - 2], ly = pts[pts.length - 1]
    const a = Math.round(Math.atan2(p.y - ly, p.x - lx) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(p.x - lx, p.y - ly)
    return { x: lx + Math.cos(a) * d, y: ly + Math.sin(a) * d }
  }
  return {
    id: 'poly', label: 'Polygon', icon: 'persp', steps,
    cursor: () => 'crosshair',
    down(p) {
      const q = snap(p)
      if (pts.length >= 6 && Math.hypot(q.x - pts[0], q.y - pts[1]) * app.view.zoom < 8) return close()
      steps.mark()
      if (!pts.length) mode = p.e.altKey ? 'sub' : sel.mode
      pts.push(q.x, q.y)
    },
    move(p) { hover = snap(p) },
    dbl: () => close(),
    key(e) {
      if (e.key === 'Enter') { close(); return true }
      if (e.key === 'Escape' && pts.length) { discard(); return true }
      if (e.key === 'Backspace' && pts.length) { steps.undo(); app.view.draw(); return true }
      return false
    },
    deactivate() { pts = []; steps.reset() },
    overlay(x, v) {
      if (!pts.length) return
      x.save(); x.translate(v.ox, v.oy); x.scale(v.zoom, v.zoom)
      x.beginPath(); x.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1])
      if (hover) x.lineTo(hover.x, hover.y)
      x.lineWidth = 1 / v.zoom; x.setLineDash([4 / v.zoom, 4 / v.zoom]); x.strokeStyle = '#fff'; x.stroke()
      x.strokeStyle = '#000'; x.lineDashOffset = 4 / v.zoom; x.stroke()
      x.restore()
    },
    panel: () => h('div', { class: 'ib' }, sec('Polygon'), hint('Click to place corners. Click the first corner or double-click to finish. Ctrl+Z or Backspace removes the last corner.'), modeSeg(),
      slider('Feather', () => sel.feather, v => (sel.feather = v), { min: 0, max: 100, unit: 'px', def: 0 }), ...selectionOps(app))
  }
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

/** Paints a selection with a brush: adds where you paint, or takes away with Subtract or Alt. */
function selBrushTool(app: App): Tool {
  const bo: BrushOpts = { size: 60, opacity: 1, hardness: 0.8, flow: 1, spacing: 0.12, color: '#fff', pressure: false, pencil: false, strength: 0.5 }
  let sub = false
  let st: Stroke | null = null
  let tint: HTMLCanvasElement | null = null
  return {
    id: 'sel-brush', label: 'Brush select', icon: 'brush',
    cursor: () => 'none',
    brush: () => ({ getSize: () => bo.size, setSize: v => { bo.size = v }, getOpacity: () => bo.opacity, setOpacity: v => { bo.opacity = v }, opts: bo }),
    down(p) {
      const doc = app.doc!
      const remove = sub !== p.e.altKey
      if (remove && !doc.selection) return
      st = new Stroke(doc, doc.active || doc.layers[0], remove ? 'sel-sub' : 'sel-add', bo, app.hist!, null, remove ? 'Brush select (subtract)' : 'Brush select')
      app.stroke = st
      st.begin(p.x, p.y, p.p)
    },
    move(p, pressed) { if (pressed && st) st.move(p.x, p.y, p.p) },
    up() { if (st) { st.end(); st = null; app.stroke = null } },
    key(e) {
      const k = keyOf(e)
      if (k === '[') { bo.size = Math.max(1, Math.round(bo.size / 1.2)); app.emit('panel'); app.view.draw(); return true }
      if (k === ']') { bo.size = Math.min(1000, Math.round(bo.size * 1.2 + 1)); app.emit('panel'); app.view.draw(); return true }
      return false
    },
    overlay(x, v) {
      // While painting, the selection shows as a tint (the marching ants follow when you let go).
      const s = app.doc?.selection
      if (st && s) {
        if (!tint || tint.width !== s.width || tint.height !== s.height) tint = canvas(s.width, s.height)
        const t = ctx2d(tint)
        t.globalCompositeOperation = 'copy'; t.drawImage(s, 0, 0)
        t.globalCompositeOperation = 'source-in'; t.fillStyle = 'rgba(138,167,217,.45)'; t.fillRect(0, 0, tint.width, tint.height)
        x.drawImage(tint, v.ox, v.oy, s.width * v.zoom, s.height * v.zoom)
      }
      drawBrushCursor(x, v, bo.size)
    },
    panel: () => h('div', { class: 'ib' }, sec('Brush select'),
      hint('Paint over what you want to select. Alt-paint takes away from the selection. [ and ] change the size.'),
      seg<'a' | 's'>([['a', 'Add'], ['s', 'Subtract']], () => (sub ? 's' : 'a'), v => (sub = v === 's')),
      slider('Size', () => bo.size, v => { bo.size = v; app.view.draw() }, { min: 1, max: 1000, unit: 'px' }),
      slider('Hardness', () => Math.round(bo.hardness * 100), v => (bo.hardness = v / 100), { min: 0, max: 100 }),
      slider('Strength', () => Math.round(bo.opacity * 100), v => (bo.opacity = v / 100), { min: 1, max: 100, unit: '%' }),
      ...selectionOps(app))
  }
}
