import type { App } from '../app'
import type { Tool } from './types'
import { cloneAdjust, cloneFx, Layer, shownLocked, shownVisible, snapshot, subtree } from '../core/doc'
import { effectiveMask, holdFx, layerFull, touch } from '../core/compose'
import { flood, morph, gauss } from '../core/px'
import { canRotate, flatBounds, hitShape, shapeCenter, transformShape, turn } from '../core/shapes'
import { boundsOf, chosenKey, chosenLayers, chosenName, isMulti, transformable } from './multi'
import { alphaOf, bboxOfAlpha, canvas, canvasFromAlpha, copyCanvas, ctx2d, fingerprint, getData, uid, type Rect } from '../core/util'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider, toggle } from '../ui/controls'
import { ai, drawBrushCursor, jobBox, rgbaOf, samCache } from './common'
import { Stroke, type BrushOpts } from '../core/brush'
import { keyOf } from '../ui/keys'
import type { Viewport, Pt } from '../view/viewport'
import { toolSteps } from '../core/steps'
import { tr, tx } from '../i18n'
import { snapBox, type SnapTargets } from '../core/snap'
import { alphaBox, snapTargets } from '../core/snaptargets'

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
    sec(tr('Selection')),
    h('div', { class: 'g2' },
      btn(tr('Select all'), () => selectAll(app)), btn(tr('Deselect'), () => applySelection(app, null, 'new', tr('Deselect'))),
      btn(tr('Invert'), () => invert(app)), btn(tr('Copy to layer'), () => toLayer(app))),
  ]
  if (has) {
    out.push(
      slider(tr('Grow'), () => sel.grow, v => (sel.grow = v), { min: -100, max: 100, unit: 'px' }),
      h('div', { class: 'g2' }, btn(tr('Grow or shrink'), () => growSel(app, sel.grow)), btn(tr('Smooth edges'), () => featherSel(app, 3))),
      h('div', { class: 'g2' }, btn(tr('Delete pixels'), () => deletePixels(app)), btn(tr('Crop to selection'), () => app.emit('crop-to-selection'))))
  }
  return out
}

export function selectAll(app: App) {
  const doc = app.doc!
  const m = canvas(doc.w, doc.h), x = ctx2d(m)
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h)
  applySelection(app, m, 'new', tr('Select all'))
}

export function invert(app: App) {
  const doc = app.doc!
  const m = canvas(doc.w, doc.h), x = ctx2d(m)
  x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h)
  if (doc.selection) { x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.selection, 0, 0) }
  applySelection(app, m, 'new', tr('Invert selection'))
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
export const growSel = (app: App, px: number) => maskOp(app, px >= 0 ? tr('Grow selection') : tr('Shrink selection'), (f, w, h) => morph(f, w, h, px))
export const featherSel = (app: App, px: number) => maskOp(app, tr('Feather selection'), (f, w, h) => gauss(f, w, h, px))

export async function toLayer(app: App) {
  const doc = app.doc!
  const a = doc.active
  if (!a?.canvas) { toast(tr('Select a layer with pixels first')); return }
  await app.hist!.op(tr('Copy to layer'), () => {
    const nl = makeCopy(doc, a)
    // Text, shapes, outlines and backgrounds are redrawn from their settings; the copy keeps their pixels instead.
    if (nl.kind !== 'paint' && nl.kind !== 'highlight') {
      const img = layerFull(doc, a)
      if (img) { const x = ctx2d(nl.canvas!); x.clearRect(0, 0, doc.w, doc.h); x.drawImage(img, 0, 0) }
      nl.kind = 'paint'; nl.shape = null; nl.outline = null; nl.bg = null; nl.bgFor = null
    }
    if (doc.selection) { const x = ctx2d(nl.canvas!); x.globalCompositeOperation = 'destination-in'; x.drawImage(doc.selection, 0, 0) }
    nl.name = tr('{0} copy', a.name)
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

export function deletePixels(app: App, label = tr('Delete pixels')) {
  const doc = app.doc!
  const l = app.activeRaster()
  if (!l) return
  if (!doc.selection) { toast(tr('Make a selection first')); return }
  const r = { x: 0, y: 0, w: doc.w, h: doc.h }
  const before = getData(l.canvas!)
  const x = ctx2d(l.canvas!)
  x.save(); x.globalCompositeOperation = 'destination-out'; x.drawImage(doc.selection, 0, 0); x.restore()
  touch(l)
  app.hist!.raster(label, l, 'canvas', r, before)
  doc.changed()
}

const modeSeg = () => seg<Mode>([['new', tr('New')], ['add', tr('Add')], ['sub', tr('Subtract')], ['int', tr('Intersect')]], () => sel.mode, v => (sel.mode = v))

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
      if (kind === 'lasso' ? pts.length < 6 : w < 2 || hh < 2) { a = b = null; if (mode === 'new' && doc.selection) applySelection(app, null, 'new', tr('Deselect')); return }
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
      slider(tr('Feather'), () => sel.feather, v => (sel.feather = v), { min: 0, max: 100, unit: 'px', def: 0 }),
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
  /** What a move may snap to, worked out once when the drag starts. */
  let snapCtx: { box: Rect; t: SnapTargets } | null = null
  const startSnap = (list: Drag[]) => {
    snapCtx = null
    const doc = app.doc!
    if (!app.settings.snap || !list.length || list[0].handle >= 0) return
    let box: Rect | null = null
    const add = (b: Rect | null) => { if (!b) return; if (!box) { box = { ...b }; return } const x = Math.min(box.x, b.x), y = Math.min(box.y, b.y); box = { x, y, w: Math.max(box.x + box.w, b.x + b.w) - x, h: Math.max(box.y + box.h, b.y + b.h) - y } }
    for (const d of list) add(d.shape ? flatBounds(d.shape) : d.float ? alphaBox(d.float) : d.orig ? alphaBox(d.orig) : null)
    if (!box) return
    snapCtx = { box, t: snapTargets(doc, app.settings.showGuides ? doc.guides : null, new Set(list.map(d => d.l))) }
  }
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
    app.hist!.structural(label || (d0.handle === 2 ? tr('Rotate {0}', d0.l.name) : d0.float ? tr('Move selection') : tr('Move {0}', d0.l.name)), before)
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
  /** Starts moving everything chosen: one layer (or folder) as before, or every picked layer together. */
  const beginChosen = (x: number, y: number): Drag[] => {
    const doc = app.doc!
    if (!doc.picked.size) return doc.active ? beginAll(doc.active, x, y) : []
    const t = transformable(doc)
    return [...t.pixels, ...t.shapes].map(k => begin(k, x, y, -1, true)).filter(Boolean) as Drag[]
  }

  // The box around several picked layers or a folder, with a handle above it to turn them all.
  let boxCache: { key: string; box: Rect | null } = { key: '', box: null }
  const multiBox = (): Rect | null => {
    const doc = app.doc!
    const key = doc.rid + ':' + doc.rev + ':' + chosenKey(doc)
    if (boxCache.key !== key) boxCache = { key, box: boundsOf(doc, transformable(doc)) }
    return boxCache.box
  }
  const spinHandle = (b: Rect) => ({ x: b.x + b.w / 2, y: b.y - 24 / app.view.zoom })
  type Spin = {
    c: { x: number; y: number }; box: Rect; a0: number; a: number
    pix: { l: Layer; orig: HTMLCanvasElement; mask: HTMLCanvasElement | null }[]
    shp: { l: Layer; shape: any }[]
  }
  let spin: Spin | null = null
  /** Removed from the picked layers when Shift-clicked without dragging. */
  let unpick: Layer | null = null

  const startSpin = (b: Rect, p: Pt) => {
    const doc = app.doc!
    const t = transformable(doc)
    const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
    spin = {
      c, box: b, a0: Math.atan2(p.y - c.y, p.x - c.x), a: 0,
      pix: t.pixels.map(l => ({ l, orig: copyCanvas(l.canvas!), mask: l.mask ? copyCanvas(l.mask) : null })),
      shp: t.shapes.map(l => ({ l, shape: { ...l.shape! } }))
    }
  }
  const spinTo = (sp: Spin, a: number) => {
    const doc = app.doc!
    sp.a = a
    const m = new DOMMatrix().translate(sp.c.x, sp.c.y).rotate((a * 180) / Math.PI).translate(-sp.c.x, -sp.c.y)
    for (const it of sp.pix) {
      const x = ctx2d(it.l.canvas!)
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, doc.w, doc.h)
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'
      x.setTransform(m); x.drawImage(it.orig, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0)
      if (it.mask && it.l.mask) {
        // Outside the turned image the mask is unknown, so it stays white (shows everything), like a fresh mask.
        const mx = ctx2d(it.l.mask)
        mx.setTransform(1, 0, 0, 1, 0, 0); mx.globalCompositeOperation = 'source-over'
        mx.fillStyle = '#fff'; mx.fillRect(0, 0, doc.w, doc.h)
        mx.globalCompositeOperation = 'destination-out'; mx.setTransform(m); mx.fillStyle = '#000'; mx.fillRect(0, 0, doc.w, doc.h)
        mx.globalCompositeOperation = 'source-over'; mx.drawImage(it.mask, 0, 0); mx.setTransform(1, 0, 0, 1, 0, 0)
        it.l.maskDirty = true
      }
      touch(it.l)
    }
    for (const it of sp.shp) {
      const c = { ...it.shape }
      transformShape(c, (px, py) => { const q = new DOMPoint(px, py).matrixTransform(m); return [q.x, q.y] }, 1, a, false)
      it.l.shape = c
      touch(it.l)
    }
    doc.changed()
  }
  const endSpin = (sp: Spin) => {
    const doc = app.doc!
    if (Math.abs(sp.a) < 1e-4) { spinTo(sp, 0); return }
    const before = snapshot(doc)
    for (const it of sp.pix) { const bl = before.layers.find(x => x.ref === it.l)!.p; bl.canvas = it.orig; if (it.mask) bl.mask = it.mask }
    for (const it of sp.shp) before.layers.find(x => x.ref === it.l)!.p.shape = it.shape
    app.hist!.structural(tr('Turn {0}', chosenName(doc)), before)
    doc.structure()
  }

  const move: Tool = {
    id: 'move', label: tr('Move'), icon: 'move',
    cursor: () => 'move',
    down(p) {
      const doc = app.doc!
      unpick = null
      // Several layers or a folder: the handle above their box turns them all.
      if (isMulti(doc)) {
        const b = multiBox()
        if (b) { const hp = spinHandle(b); if (Math.hypot(hp.x - p.x, hp.y - p.y) < 9 / app.view.zoom) { startSpin(b, p); return } }
      }
      let l = doc.active
      if (!isMulti(doc) && l?.shape && !shownLocked(doc, l)) {
        const hit = handles(l).find(([hx, hy]) => Math.hypot(hx - p.x, hy - p.y) < 8 / app.view.zoom)
        if (hit) { const d = begin(l, p.x, p.y, hit[2]); drag = d ? [d] : null; dragName = ''; return }
      }
      const tol = 6 / app.view.zoom
      const shapeHit = [...doc.layers].reverse().find(x => shownVisible(doc, x) && !shownLocked(doc, x) && x.shape && hitShape(x.shape, p.x, p.y, tol))
      if (p.e.shiftKey) {
        // Shift-click adds the layer under the cursor to the picked layers, or takes it out again.
        const hit = shapeHit || layerAt(p.x, p.y)
        if (hit) {
          const set = chosenLayers(doc)
          if (set.includes(hit)) { if (set.length > 1) unpick = hit }
          else { doc.picked.add(doc.activeId); doc.picked.delete(hit.id); doc.activeId = hit.id; app.emit('layers') }
          l = hit
        }
      } else {
        // Text and shapes are picked by clicking them; any layer with Ctrl-click or Pick layer.
        const pickAny = moveOpts.autoPick || p.e.ctrlKey || p.e.metaKey
        const hit = pickAny ? layerAt(p.x, p.y) : shapeHit
        // Clicking something already picked moves the whole set; anything else becomes the only pick.
        if (hit && !chosenLayers(doc).includes(hit)) { doc.picked.clear(); doc.activeId = hit.id; l = hit; app.emit('layers') }
      }
      if (!l) return
      if (!doc.picked.size && shownLocked(doc, l)) { toast(tr('{0} is locked', l.name)); return }
      if (!doc.picked.size && !shownVisible(doc, l)) toast(tr('{0} is hidden', l.name))
      drag = beginChosen(p.x, p.y)
      dragName = doc.picked.size || l.kind === 'group' ? tr('Move {0}', chosenName(doc)) : ''
      if (!drag.length) drag = null
      else startSnap(drag)
    },
    move(p, pressed) {
      if (!pressed) return
      if (spin) {
        let a = Math.atan2(p.y - spin.c.y, p.x - spin.c.x) - spin.a0
        if (p.e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
        spinTo(spin, a)
        return
      }
      if (!drag) return
      const d0 = drag[0]
      let dx = p.x - d0.x, dy = p.y - d0.y
      if (Math.hypot(dx, dy) > 2 / app.view.zoom) unpick = null
      if (p.e.shiftKey && d0.handle < 0 && !unpick) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      rotSnap = p.e.shiftKey
      // Edges and centres line up with guides, the image and other layers; Alt moves freely.
      app.view.snapLines = []
      if (snapCtx && d0.handle < 0 && !p.e.altKey) {
        const sn = snapBox(snapCtx.box, dx, dy, snapCtx.t, 7 / app.view.zoom)
        if (p.e.shiftKey) { if (dx !== 0) dx = sn.dx; if (dy !== 0) dy = sn.dy; app.view.snapLines = sn.lines.filter(l => (l.x !== undefined && dx !== 0) || (l.y !== undefined && dy !== 0)) }
        else { dx = sn.dx; dy = sn.dy; app.view.snapLines = sn.lines }
      }
      for (const d of drag) apply(d, dx, dy)
    },
    up() {
      if (spin) { const sp = spin; spin = null; endSpin(sp); return }
      snapCtx = null
      if (app.view.snapLines.length) { app.view.snapLines = []; app.view.draw() }
      const doc = app.doc!
      if (drag) { const d = drag; drag = null; finish(d, dragName || undefined) }
      if (unpick) {
        const u = unpick
        unpick = null
        if (u.id === doc.activeId) { const next = [...doc.picked].pop(); if (next) { doc.picked.delete(next); doc.activeId = next } }
        else doc.picked.delete(u.id)
        app.emit('layers'); app.view.draw()
      }
    },
    key(e) {
      const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      if (e.key === 'Escape' && app.doc?.picked.size && !drag && !spin) { app.doc.picked.clear(); app.emit('layers'); app.view.draw(); return true }
      const v = dir[e.key]
      if (!v || drag || spin || e.ctrlKey || e.metaKey || e.altKey) return false
      const doc = app.doc
      const l = doc?.active
      if (!doc || !l) return true
      if (!doc.picked.size && shownLocked(doc, l)) { toast(tr('{0} is locked', l.name)); return true }
      const k = e.shiftKey ? 10 : 1
      const list = beginChosen(0, 0)
      for (const d of list) apply(d, v[0] * k, v[1] * k)
      finish(list, doc.selection && !isMulti(doc) ? tr('Nudge selection') : tr('Nudge {0}', chosenName(doc)))
      return true
    },
    overlay(x, v) {
      const doc = app.doc
      if (!doc) return
      if (isMulti(doc)) {
        // Box around everything picked (turning with it while the handle is dragged), and the turn handle.
        const b = spin ? spin.box : multiBox()
        if (!b) return
        const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }, a = spin ? spin.a : 0
        const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([px, py]) => { const q = turn(px, py, c, a); return v.toScreen(q.x, q.y) })
        const hp = spinHandle(b), hq = turn(hp.x, hp.y, c, a), h0 = turn(c.x, b.y, c, a)
        const H = v.toScreen(hq.x, hq.y), T = v.toScreen(h0.x, h0.y)
        x.save()
        x.strokeStyle = '#8AA7D9'; x.lineWidth = 1; x.setLineDash([4, 3])
        x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); x.closePath(); x.stroke()
        x.setLineDash([])
        x.beginPath(); x.moveTo(T.x, T.y); x.lineTo(H.x, H.y); x.stroke()
        x.fillStyle = '#8AA7D9'; x.strokeStyle = '#fff'; x.lineWidth = 1.5
        x.beginPath(); x.arc(H.x, H.y, 5, 0, Math.PI * 2); x.fill(); x.stroke()
        if (spin) {
          const deg = Math.round((spin.a * 180) / Math.PI)
          const t = deg + '°'
          x.font = '500 11px Inter, sans-serif'
          const w = x.measureText(t).width + 12
          x.fillStyle = 'rgba(18,18,18,.8)'; x.beginPath(); x.roundRect(H.x - w / 2, H.y - 30, w, 20, 4); x.fill()
          x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(t, H.x, H.y - 16)
        }
        x.restore()
        return
      }
      const l = doc.active
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
    panel: () => h('div', { class: 'ib' }, sec(tr('Move')),
      hint(tr('Drag to move the selected layer, or only the selected pixels when there is a selection. Arrow keys nudge by 1 px, Shift+arrow by 10 px, and Shift-drag keeps the move straight. Ctrl-click picks the layer under the cursor. Shift-click things in the image to pick several, and Shift-click again to take one out. Drag the filled handle above text, shapes, a folder or several picked layers to turn them (Shift snaps to 15°); Ctrl+T also scales them.')),
      toggle(tr('Pick layer by clicking'), () => moveOpts.autoPick, v => (moveOpts.autoPick = v)),
      ...selectionOps(app))
  }

  const wand: Tool = {
    id: 'wand', label: tr('Magic wand'), icon: 'wand',
    cursor: () => 'crosshair',
    down(p) {
      const doc = app.doc!
      const x = Math.floor(p.x), y = Math.floor(p.y)
      if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return
      const src = sel.sample ? doc.comp : doc.active?.canvas || doc.comp
      const d = getData(src).data
      const m = flood(d, doc.w, doc.h, x, y, sel.tol, sel.contiguous)
      applySelection(app, canvasFromAlpha(m, doc.w, doc.h), modeFrom(p.e), tr('Magic wand'))
    },
    panel: () => h('div', { class: 'ib' }, sec(tr('Magic wand')), hint(tr('Click an area to select similar colours.')), modeSeg(),
      slider(tr('Tolerance'), () => sel.tol, v => (sel.tol = v), { min: 0, max: 255, def: 32 }),
      slider(tr('Feather'), () => sel.feather, v => (sel.feather = v), { min: 0, max: 100, def: 0 }),
      toggle(tr('Connected areas only'), () => sel.contiguous, v => (sel.contiguous = v)),
      toggle(tr('Sample all layers'), () => sel.sample, v => (sel.sample = v)),
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
    id: 'obj-sel', label: tr('Object'), icon: 'sparkle', steps: objSteps,
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
      const ok = await app.run(tr('Finding the object'), async prog => {
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
        applySelection(app, full, pts.length > 1 && mode === 'new' ? 'new' : mode, tr('Select object'))
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
    panel: () => h('div', { class: 'ib' }, sec(tr('Select object')),
      hint(tr('Click an object to select it. Keep clicking to refine the selection.')),
      seg<'a' | 'r'>([['a', tr('Include part')], ['r', tr('Exclude part')]], () => (addPart ? 'a' : 'r'), v => (addPart = v === 'a')),
      jobBox(app), btn(tr('Start over'), () => { objSteps.reset(); applySelection(app, null, 'new', tr('Deselect')) }, 'wide'), ...selectionOps(app))
  }

  const subject: Tool = {
    id: 'subject', label: tx('tool', 'Subject'), icon: 'person',
    panel: () => h('div', { class: 'ib' }, sec(tr('Select subject')),
      hint(tr('Finds the main subject of the photo and selects it.')),
      h('button', { class: 'pri big wide', onclick: () => selectSubject(app) }, icon('sparkle'), tr('Select subject')), jobBox(app), ...selectionOps(app))
  }

  return [move,
    shapeSelTool(app, 'marquee', tr('Rectangle'), 'rect', 'rect'),
    shapeSelTool(app, 'ellipse-sel', tr('Ellipse'), 'ellipse', 'ellipse'),
    shapeSelTool(app, 'lasso', tr('Lasso'), 'lasso', 'lasso'),
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
      applySelection(app, m, mode, tr('Polygon select'))
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
    id: 'poly', label: tr('Polygon'), icon: 'persp', steps,
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
    panel: () => h('div', { class: 'ib' }, sec(tr('Polygon')), hint(tr('Click to place corners. Click the first corner or double-click to finish. Ctrl+Z or Backspace removes the last corner.')), modeSeg(),
      slider(tr('Feather'), () => sel.feather, v => (sel.feather = v), { min: 0, max: 100, unit: 'px', def: 0 }), ...selectionOps(app))
  }
}

export async function selectSubject(app: App) {
  const doc = app.doc
  if (!doc) return
  await app.run(tr('Finding the subject'), async prog => {
    const src = rgbaOf(doc.comp, 1024)
    const r = await ai(app, 'removeBg', { ...src, model: app.settings.bgModel }, prog)
    const m = canvasFromAlpha(r.mask, r.w, r.h)
    const full = canvas(doc.w, doc.h); const fx = ctx2d(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(m, 0, 0, doc.w, doc.h)
    applySelection(app, full, 'new', tr('Select subject'))
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
    id: 'sel-brush', label: tr('Brush select'), icon: 'brush',
    cursor: () => 'none',
    brush: () => ({ getSize: () => bo.size, setSize: v => { bo.size = v }, getOpacity: () => bo.opacity, setOpacity: v => { bo.opacity = v }, opts: bo }),
    down(p) {
      const doc = app.doc!
      const remove = sub !== p.e.altKey
      if (remove && !doc.selection) return
      st = new Stroke(doc, doc.active || doc.layers[0], remove ? 'sel-sub' : 'sel-add', bo, app.hist!, null, remove ? tr('Brush select (subtract)') : tr('Brush select'))
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
    panel: () => h('div', { class: 'ib' }, sec(tr('Brush select')),
      hint(tr('Paint over what you want to select. Alt-paint takes away from the selection. [ and ] change the size.')),
      seg<'a' | 's'>([['a', tr('Add')], ['s', tr('Subtract')]], () => (sub ? 's' : 'a'), v => (sub = v === 's')),
      slider(tr('Size'), () => bo.size, v => { bo.size = v; app.view.draw() }, { min: 1, max: 1000, unit: 'px' }),
      slider(tr('Hardness'), () => Math.round(bo.hardness * 100), v => (bo.hardness = v / 100), { min: 0, max: 100 }),
      slider(tr('Strength'), () => Math.round(bo.opacity * 100), v => (bo.opacity = v / 100), { min: 1, max: 100, unit: '%' }),
      ...selectionOps(app))
  }
}
