import type { App } from '../app'
import type { Tool } from './types'
import { Doc, Layer, Shape, shownLocked, snapshot, subtree } from '../core/doc'
import { transformShape } from '../core/shapes'
import { boundsOf, chosenKey, chosenName, isMulti, transformable } from './multi'
import { holdFx, touch } from '../core/compose'
import type { History } from '../core/history'
import { alphaOf, bboxOfAlpha, canvas, copyCanvas, ctx2d, getData, putData } from '../core/util'
import { h, toast } from '../ui/dom'
import { btn, hint, sec, seg, select, toggle } from '../ui/controls'
import type { Pt, Viewport } from '../view/viewport'
import { Box, buildMesh, drawMesh, gridOver, locate, Mesh, quadMapper, rasterMesh, warpAt, warpInfluence } from '../core/warp'
import { toolSteps } from '../core/steps'

/**
 * How the layer is reshaped. Box scales, rotates and moves it; Distort moves each corner freely;
 * Warp bends it with a grid of points.
 */
type Mode = 'box' | 'distort' | 'warp'

/** The parts of a transform that undo steps through while it is still being edited. */
interface Pose { mode: Mode; cx: number; cy: number; sx: number; sy: number; a: number; quad: number[]; grid: number[]; cols: number; rows: number }

/** Box being transformed: its untransformed size (bw, bh) and centre (bx, by), and where it is now. */
interface State extends Pose {
  doc: Doc; hist: History; l: Layer
  /** Transforming a folder or several layers: their name and which layers they were, the other pixel layers, and the text and shapes. */
  group: { name: string; key: string } | null
  extras: { l: Layer; orig: HTMLCanvasElement; origMask: HTMLCanvasElement | null }[]
  shapes: { l: Layer; shape: Shape }[]
  orig: HTMLCanvasElement; origMask: HTMLCanvasElement | null; origSel: HTMLCanvasElement | null
  float: HTMLCanvasElement; base: HTMLCanvasElement | null
  bx: number; by: number; bw: number; bh: number
  /** The box Distort and Warp reshape: the layer's box with a pixel of room on each side, so edges stay smooth. */
  mb: Box
}

const GRIDS: [string, string][] = [['2', '2 × 2'], ['3', '3 × 3'], ['4', '4 × 4'], ['5', '5 × 5'], ['6', '6 × 6']]

const HANDLES: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]

/** Scale, rotate and move a pixel layer, or just the selected part of it. */
export function transformTool(app: App): Tool {
  let st: State | null = null
  let drag: { kind: 'move' | 'rot' | 'scale'; h: number; p0: Pt; s0: Pick<State, 'cx' | 'cy' | 'sx' | 'sy' | 'a'> } | null = null
  let keepRatio = true
  let hold: ReturnType<typeof holdFx> = null
  let holdFrom = new DOMMatrix()
  let quality = true
  let mode: Mode = 'box'
  let warpCells = 3
  /** Distort and Warp points picked with Shift-click; they move together and with the arrow keys. */
  let picked = new Set<number>()
  let mdrag: { kind: 'pts' | 'edge' | 'surface' | 'all' | 'spin'; ids: number[]; p0: Pt; quad: number[]; grid: number[]; w?: Float64Array; ss?: number; c?: { x: number; y: number }; moved: boolean } | null = null

  const pose = (s: State): Pose => ({ mode: s.mode, cx: s.cx, cy: s.cy, sx: s.sx, sy: s.sy, a: s.a, quad: s.quad.slice(), grid: s.grid.slice(), cols: s.cols, rows: s.rows })
  const inner = toolSteps<Pose | null>(app, () => (st ? pose(st) : null), v => {
    if (!st || !v) return
    Object.assign(st, v); mode = v.mode; picked.clear(); render()
  })
  /** Undo inside the transform: each handle drag, typed value and button is one step. */
  const steps = {
    get canUndo() { return !!st && inner.canUndo },
    get canRedo() { return !!st && inner.canRedo },
    undo: () => (drag || mdrag ? true : !!st && inner.undo()),
    redo: () => (drag || mdrag ? true : !!st && inner.redo())
  }

  /** The fine mesh for the current Distort or Warp shape. */
  const meshOf = (s: State, fine = 1): Mesh => {
    if (s.mode === 'distort') return buildMesh(s.mb, 16 * fine, 16 * fine, quadMapper(s.quad))
    const n = Math.min(48, Math.max(16, Math.max(s.cols, s.rows) * 10)) * fine
    return buildMesh(s.mb, n, n, (u, v) => warpAt(s.grid, s.cols, s.rows, u, v))
  }
  const boxPoints = (s: State) => { const m = matrix(s); return (pts: number[]) => { const o: number[] = []; for (let i = 0; i < pts.length; i += 2) { const q = new DOMPoint(pts[i], pts[i + 1]).matrixTransform(m); o.push(q.x, q.y) } return o } }
  const quadOfBox = (s: State) => boxPoints(s)([s.mb.x, s.mb.y, s.mb.x + s.mb.w, s.mb.y, s.mb.x + s.mb.w, s.mb.y + s.mb.h, s.mb.x, s.mb.y + s.mb.h])
  const gridOfQuad = (q: number[], cols: number, rows: number) => {
    const f = quadMapper(q), out: number[] = []
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) out.push(...f(i / cols, j / rows))
    return out
  }
  const restGrid = (s: State) => gridOver(s.mb, s.cols, s.rows)
  const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6)

  const matrix = (s: State) => new DOMMatrix().translate(s.cx, s.cy).rotate((s.a * 180) / Math.PI).scale(s.sx, s.sy).translate(-s.bx, -s.by)
  const corner = (s: State, hx: number, hy: number) => {
    const p = new DOMPoint(s.bx + (hx * s.bw) / 2, s.by + (hy * s.bh) / 2).matrixTransform(matrix(s))
    return { x: p.x, y: p.y }
  }
  const changed = (s: State) => {
    if (s.mode === 'distort') return !same(s.quad, restQuad(s))
    if (s.mode === 'warp') return !same(s.grid, restGrid(s))
    return s.cx !== s.bx || s.cy !== s.by || s.sx !== 1 || s.sy !== 1 || s.a !== 0
  }
  /** The untouched Distort corners, going round: top left, top right, bottom right, bottom left. */
  const restQuad = (s: State) => { const b = s.mb; return [b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x, b.y + b.h] }

  const paintMesh = (target: HTMLCanvasElement, base: HTMLCanvasElement | null, src: HTMLCanvasElement, m: Mesh) => {
    const x = ctx2d(target)
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, target.width, target.height)
    if (base) x.drawImage(base, 0, 0)
    x.imageSmoothingEnabled = true
    x.imageSmoothingQuality = quality ? 'high' : 'low'
    drawMesh(x, src, m)
    x.setTransform(1, 0, 0, 1, 0, 0)
  }
  /** Rasterises src through the mesh exactly, over a starting image (transparent, or white for masks). */
  const meshInto = (src: HTMLCanvasElement, m: Mesh, start: 'clear' | 'white' | HTMLCanvasElement | null, edge: 'clear' | 'clamp') => {
    const w = src.width, hh = src.height
    const out = canvas(w, hh)
    const d = new ImageData(w, hh)
    if (start === 'white') d.data.fill(255)
    rasterMesh(getData(src).data, w, hh, d.data, w, hh, m, edge)
    if (start instanceof HTMLCanvasElement) {
      const t = canvas(w, hh); putData(t, d)
      const x = ctx2d(out); x.drawImage(start, 0, 0); x.drawImage(t, 0, 0)
    } else putData(out, d)
    return out
  }

  const paint = (target: HTMLCanvasElement, base: HTMLCanvasElement | null, src: HTMLCanvasElement, m: DOMMatrix) => {
    const x = ctx2d(target)
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, target.width, target.height)
    if (base) x.drawImage(base, 0, 0)
    x.imageSmoothingEnabled = true
    x.imageSmoothingQuality = quality ? 'high' : 'low'
    x.setTransform(m)
    x.drawImage(src, 0, 0)
    x.setTransform(1, 0, 0, 1, 0, 0)
  }
  const render = () => {
    if (!st) return
    // While dragging, move the layer's effects image along instead of re-rendering it each frame.
    // It is taken before repainting, so it matches the pose the drag started from.
    if (st.mode !== 'box') paintMesh(st.l.canvas!, st.base, st.float, meshOf(st))
    else {
      if (drag && !st.base && !hold && !st.group) { hold = holdFx(st.doc, st.l); holdFrom = matrix({ ...st, ...drag.s0 }) }
      paint(st.l.canvas!, st.base, st.float, matrix(st))
      hold?.draw(matrix(st).multiply(holdFrom.inverse()))
      const m = matrix(st)
      for (const e of st.extras) { paint(e.l.canvas!, null, e.orig, m); touch(e.l) }
      for (const e of st.shapes) { e.l.shape = shapeThrough(e.shape, m, st); touch(e.l) }
    }
    touch(st.l)
    st.doc.changed()
    app.view.draw()
  }

  const begin = (): boolean => {
    if (st) return true
    const doc = app.doc
    if (!doc) return false
    const a = doc.active
    if (isMulti(doc)) return beginGroup(doc)
    if (a && (a.shape || a.kind === 'text')) { app.setTool('move'); toast('Text and shapes: drag their round handles to resize, and the filled handle above them to turn them'); return false }
    const l = app.activeRaster()
    if (!l || !l.canvas) return false
    const orig = copyCanvas(l.canvas)
    let float = orig, base: HTMLCanvasElement | null = null
    let bb = bboxOfAlpha(alphaOf(orig), doc.w, doc.h)
    if (doc.selection) {
      const sb = bboxOfAlpha(alphaOf(doc.selection), doc.w, doc.h)
      if (!sb) { toast('The selection is empty'); return false }
      float = copyCanvas(orig)
      const fx = ctx2d(float); fx.globalCompositeOperation = 'destination-in'; fx.drawImage(doc.selection, 0, 0)
      base = copyCanvas(orig)
      const bx = ctx2d(base); bx.globalCompositeOperation = 'destination-out'; bx.drawImage(doc.selection, 0, 0)
      bb = bboxOfAlpha(alphaOf(float), doc.w, doc.h) || sb
    }
    if (!bb) { toast(`${l.name} is empty`); return false }
    const mb = { x: bb.x - 1, y: bb.y - 1, w: bb.w + 2, h: bb.h + 2 }
    st = {
      doc, hist: app.hist!, l, group: null, extras: [], shapes: [], orig, origMask: l.mask && !doc.selection ? copyCanvas(l.mask) : null, origSel: doc.selection,
      float, base, bx: bb.x + bb.w / 2, by: bb.y + bb.h / 2, bw: bb.w, bh: bb.h, cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2, sx: 1, sy: 1, a: 0,
      mb, mode, cols: warpCells, rows: warpCells, quad: [], grid: []
    }
    st.quad = restQuad(st); st.grid = restGrid(st)
    picked.clear()
    inner.reset()
    if (mode !== 'box') render()
    app.hist!.pending = commit
    app.emit('panel')
    return true
  }

  /** A transformed copy of a shape: its points through m, its size by m's scale, and its angle by m's turn. */
  const shapeThrough = (sh: Shape, m: DOMMatrix, s: State): Shape => {
    const c = { ...sh }
    transformShape(c, (x, y) => { const q = new DOMPoint(x, y).matrixTransform(m); return [q.x, q.y] }, Math.sqrt(Math.abs(s.sx * s.sy)), s.a, s.sx * s.sy < 0)
    return c
  }

  /**
   * A folder, or several picked layers, transform as one: every pixel layer, text and shape in them.
   * Box mode only.
   */
  const beginGroup = (doc: Doc): boolean => {
    const name = chosenName(doc)
    const a = doc.active
    if (a && doc.picked.size === 0 && shownLocked(doc, a)) { toast(`${a.name} is locked`); return false }
    if (mode !== 'box') { mode = 'box'; toast('Several layers or a folder can be scaled, turned and moved. Distort and Warp work on one layer at a time.') }
    const { pixels: ras, shapes: shp } = transformable(doc)
    if (!ras.length && !shp.length) { toast(`${name} has nothing to transform`); return false }
    const b = boundsOf(doc, { pixels: ras, shapes: shp })
    if (!b) { toast(`${name} is empty`); return false }
    // The first pixel layer leads (an empty stand-in when the folder holds only text and shapes).
    const lead = ras[0] || null
    const leadL: Layer = lead || { ...shp[0], canvas: canvas(doc.w, doc.h), mask: null, shape: null, kind: 'paint' } as Layer
    const orig = copyCanvas(leadL.canvas!)
    st = {
      doc, hist: app.hist!, l: leadL, group: { name, key: chosenKey(doc) },
      extras: ras.slice(1).map(k => ({ l: k, orig: copyCanvas(k.canvas!), origMask: k.mask ? copyCanvas(k.mask) : null })),
      shapes: shp.map(k => ({ l: k, shape: { ...k.shape! } })),
      orig, origMask: lead?.mask ? copyCanvas(lead.mask) : null, origSel: null, float: orig, base: null,
      bx: b.x + b.w / 2, by: b.y + b.h / 2, bw: b.w, bh: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, sx: 1, sy: 1, a: 0,
      mb: { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, mode: 'box', cols: warpCells, rows: warpCells, quad: [], grid: []
    }
    st.quad = restQuad(st); st.grid = restGrid(st)
    if (!lead) st.l = leadL
    picked.clear()
    inner.reset()
    app.hist!.pending = commit
    app.emit('panel')
    return true
  }
  /** Is l the lead layer of a folder transform made from text and shapes only (not in the document)? */
  const stand = (s: State) => !s.doc.layers.includes(s.l)
  /** Puts a folder's other layers and shapes back as they were. */
  const restoreGroup = (s: State) => {
    for (const e of s.extras) { paint(e.l.canvas!, null, e.orig, new DOMMatrix()); touch(e.l) }
    for (const e of s.shapes) { e.l.shape = { ...e.shape }; touch(e.l) }
  }

  const clear = () => { if (st && st.hist.pending === commit) st.hist.pending = null; hold?.end(); hold = null; st = null; drag = null; mdrag = null; picked.clear(); inner.reset() }
  function commit() {
    const s = st
    if (!s) return
    clear()
    if (!changed(s)) { paint(s.l.canvas!, null, s.orig, new DOMMatrix()); touch(s.l); restoreGroup(s); s.doc.changed(); app.emit('panel'); return }
    const before = snapshot(s.doc)
    if (s.group) {
      // A folder: every layer inside gets its transformed pixels (and mask), text and shapes their new place.
      const m = matrix(s)
      const all = [...(stand(s) ? [] : [{ l: s.l, orig: s.orig, origMask: s.origMask }]), ...s.extras]
      for (const e of all) {
        const bl = before.layers.find(x => x.ref === e.l)!.p
        bl.canvas = e.orig
        const after = canvas(s.doc.w, s.doc.h)
        paint(after, null, e.orig, m)
        e.l.canvas = after
        if (e.origMask && e.l.mask) {
          bl.mask = e.origMask
          const nm = canvas(s.doc.w, s.doc.h), x = ctx2d(nm)
          x.fillStyle = '#fff'; x.fillRect(0, 0, nm.width, nm.height)
          x.globalCompositeOperation = 'destination-out'
          x.setTransform(m); x.fillStyle = '#000'; x.fillRect(0, 0, s.doc.w, s.doc.h); x.setTransform(1, 0, 0, 1, 0, 0)
          x.globalCompositeOperation = 'source-over'
          paint(nm, null, e.origMask, m)
          e.l.mask = nm; e.l.maskDirty = true
        }
        touch(e.l)
      }
      for (const e of s.shapes) {
        before.layers.find(x => x.ref === e.l)!.p.shape = { ...e.shape }
        e.l.shape = shapeThrough(e.shape, m, s)
        touch(e.l)
      }
      s.hist.structural('Transform ' + s.group.name, before)
      s.doc.structure()
      app.emit('panel')
      return
    }
    const bl = before.layers.find(x => x.ref === s.l)!.p
    bl.canvas = s.orig
    if (s.mode !== 'box') {
      const mesh = meshOf(s, 2)
      s.l.canvas = meshInto(s.float, mesh, s.base, 'clear')
      if (s.origMask && s.l.mask) {
        bl.mask = s.origMask
        // Outside the reshaped box the mask is unknown; keep it opaque (white) like a fresh mask.
        s.l.mask = meshInto(s.origMask, mesh, 'white', 'clamp')
        s.l.maskDirty = true
      }
      if (s.origSel) s.doc.selection = meshInto(s.origSel, mesh, 'clear', 'clear')
      touch(s.l)
      s.hist.structural(s.mode === 'warp' ? 'Warp' : 'Distort', before)
      s.doc.structure()
      s.doc.emit('selection')
      app.emit('panel')
      return
    }
    const m = matrix(s)
    const after = canvas(s.doc.w, s.doc.h)
    paint(after, s.base, s.float, m)
    s.l.canvas = after
    if (s.origMask && s.l.mask) {
      bl.mask = s.origMask
      // Outside the old mask's box the mask is unknown; keep it opaque (white) like a fresh mask.
      const nm = canvas(s.doc.w, s.doc.h)
      const x = ctx2d(nm)
      x.fillStyle = '#fff'; x.fillRect(0, 0, nm.width, nm.height)
      x.globalCompositeOperation = 'destination-out'
      x.setTransform(m); x.fillStyle = '#000'; x.fillRect(0, 0, s.doc.w, s.doc.h); x.setTransform(1, 0, 0, 1, 0, 0)
      x.globalCompositeOperation = 'source-over'
      paint(nm, null, s.origMask, m)
      s.l.mask = nm
      s.l.maskDirty = true
    }
    if (s.origSel) {
      const ns = canvas(s.doc.w, s.doc.h)
      paint(ns, null, s.origSel, m)
      s.doc.selection = ns
    }
    touch(s.l)
    s.hist.structural('Free transform', before)
    s.doc.structure()
    s.doc.emit('selection')
    app.emit('panel')
  }
  const cancel = () => {
    const s = st
    if (!s) return
    clear()
    paint(s.l.canvas!, null, s.orig, new DOMMatrix())
    touch(s.l)
    restoreGroup(s)
    s.doc.changed()
    app.emit('panel')
  }

  /**
   * Switches between Box, Distort and Warp. Going towards more freedom carries the current shape over;
   * going back applies the current shape first, as Box can't hold a bent layer.
   */
  const setMode = (m: Mode) => {
    if (m === mode && (!st || st.mode === m)) return
    if (m !== 'box' && (st?.group || (app.doc && isMulti(app.doc)))) { toast('Distort and Warp work on one layer at a time. Pick a single layer.'); app.emit('panel'); return }
    const s = st
    const order: Mode[] = ['box', 'distort', 'warp']
    if (s && order.indexOf(m) < order.indexOf(s.mode) && changed(s)) {
      commit(); mode = m
      begin(); app.emit('panel'); app.view.draw(); return
    }
    mode = m
    if (!s) { begin(); app.emit('panel'); app.view.draw(); return }
    inner.mark()
    if (m === 'distort') s.quad = s.mode === 'box' ? quadOfBox(s) : s.quad
    if (m === 'warp') {
      s.cols = s.rows = warpCells
      s.grid = s.mode === 'box' ? boxPoints(s)(restGrid(s)) : s.mode === 'distort' ? gridOfQuad(s.quad, s.cols, s.rows) : s.grid
    }
    if (m === 'box' && s.mode !== 'box') { s.cx = s.bx; s.cy = s.by; s.sx = s.sy = 1; s.a = 0 }
    s.mode = m
    picked.clear()
    render(); app.emit('panel')
  }
  /** A new Warp grid size: the current bend is kept, sampled onto the new grid. */
  const setCells = (n: number) => {
    warpCells = n
    const s = st
    if (!s || s.mode !== 'warp' || (s.cols === n && s.rows === n)) { app.emit('panel'); return }
    inner.mark()
    const g: number[] = []
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) g.push(...warpAt(s.grid, s.cols, s.rows, i / n, j / n))
    s.grid = g; s.cols = s.rows = n
    picked.clear()
    render(); app.emit('panel')
  }
  const resetShape = () => {
    const s = st
    if (!s) return
    inner.mark()
    if (s.mode === 'distort') s.quad = restQuad(s)
    else if (s.mode === 'warp') s.grid = restGrid(s)
    else { s.cx = s.bx; s.cy = s.by; s.sx = s.sy = 1; s.a = 0 }
    picked.clear(); render(); app.emit('panel')
  }

  /** The draggable points of Distort (4 corners, then 4 edge middles) or Warp (every grid point), in image pixels. */
  const points = (s: State): number[] => {
    if (s.mode === 'warp') return s.grid
    const q = s.quad, mid: number[] = []
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; mid.push((q[i * 2] + q[j * 2]) / 2, (q[i * 2 + 1] + q[j * 2 + 1]) / 2) }
    return [...q, ...mid]
  }
  const hitMesh = (p: Pt) => {
    if (!st) return null
    const tol = 9 / app.view.zoom, pts = points(st)
    let best = -1, bd = tol
    for (let i = 0; i < pts.length / 2; i++) { const d = Math.hypot(pts[i * 2] - p.x, pts[i * 2 + 1] - p.y); if (d < bd) { bd = d; best = i } }
    if (best >= 0) return st.mode === 'distort' && best >= 4 ? { kind: 'edge' as const, i: best - 4 } : { kind: 'pt' as const, i: best }
    const uv = locate(meshOf(st), p.x, p.y)
    if (uv) return { kind: 'in' as const, i: -1, uv }
    return { kind: 'out' as const, i: -1 }
  }
  const centroid = (pts: number[]) => { let x = 0, y = 0; for (let i = 0; i < pts.length; i += 2) { x += pts[i]; y += pts[i + 1] } return { x: (x * 2) / pts.length, y: (y * 2) / pts.length } }
  /** Moves every point of the current shape (or just those in ids) by f. */
  const movePts = (s: State, from: { quad: number[]; grid: number[] }, f: (x: number, y: number, i: number) => [number, number], ids?: number[]) => {
    const src = s.mode === 'warp' ? from.grid : from.quad
    const out = src.slice()
    const list = ids ?? [...Array(src.length / 2).keys()]
    for (const i of list) { const [x, y] = f(src[i * 2], src[i * 2 + 1], i); out[i * 2] = x; out[i * 2 + 1] = y }
    if (s.mode === 'warp') s.grid = out; else s.quad = out
  }

  const hit = (p: Pt) => {
    if (!st) return null
    const tol = 9 / app.view.zoom
    for (let i = 0; i < HANDLES.length; i++) { const q = corner(st, ...HANDLES[i]); if (Math.hypot(q.x - p.x, q.y - p.y) < tol) return { kind: 'scale' as const, h: i } }
    const inv = matrix(st).inverse()
    const lp = new DOMPoint(p.x, p.y).matrixTransform(inv)
    const inside = Math.abs(lp.x - st.bx) <= st.bw / 2 && Math.abs(lp.y - st.by) <= st.bh / 2
    if (inside) return { kind: 'move' as const, h: -1 }
    for (let i = 0; i < 4; i++) { const q = corner(st, ...HANDLES[i]); if (Math.hypot(q.x - p.x, q.y - p.y) < tol * 3.2) return { kind: 'rot' as const, h: i } }
    return { kind: 'rot' as const, h: -1 }
  }

  const meshOverlay = (x: CanvasRenderingContext2D, v: Viewport, s: State) => {
    const line = (pts: { x: number; y: number }[], close = false) => {
      x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); if (close) x.closePath()
      x.lineWidth = 2.5; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke()
      x.lineWidth = 1; x.strokeStyle = '#8AA7D9'; x.stroke()
    }
    const toS = (p: [number, number]) => v.toScreen(p[0], p[1])
    x.save()
    if (s.mode === 'distort') {
      const f = quadMapper(s.quad), N = 24
      const edge = (u0: number, v0: number, u1: number, v1: number) => Array.from({ length: N + 1 }, (_, k) => toS(f(u0 + ((u1 - u0) * k) / N, v0 + ((v1 - v0) * k) / N)))
      x.globalAlpha = 0.5
      for (const t of [1 / 3, 2 / 3]) { line(edge(t, 0, t, 1)); line(edge(0, t, 1, t)) }
      x.globalAlpha = 1
      line([0, 1, 2, 3].map(i => v.toScreen(s.quad[i * 2], s.quad[i * 2 + 1])), true)
    } else {
      const f = (u: number, w: number) => warpAt(s.grid, s.cols, s.rows, u, w), N = Math.max(s.cols, s.rows) * 8
      for (let j = 0; j <= s.rows; j++) line(Array.from({ length: N + 1 }, (_, k) => toS(f(k / N, j / s.rows))))
      for (let i = 0; i <= s.cols; i++) line(Array.from({ length: N + 1 }, (_, k) => toS(f(i / s.cols, k / N))))
    }
    const pts = points(s)
    for (let i = 0; i < pts.length / 2; i++) {
      const q = v.toScreen(pts[i * 2], pts[i * 2 + 1])
      const on = picked.has(i)
      x.fillStyle = on ? '#4a6fae' : '#fff'; x.strokeStyle = on ? '#fff' : '#4a6fae'; x.lineWidth = 1.5
      if (s.mode === 'distort') {
        const r = i < 4 ? 4.5 : 3.5
        x.fillRect(q.x - r, q.y - r, r * 2, r * 2); x.strokeRect(q.x - r, q.y - r, r * 2, r * 2)
      } else { x.beginPath(); x.arc(q.x, q.y, 4.5, 0, Math.PI * 2); x.fill(); x.stroke() }
    }
    x.restore()
  }

  app.on('transform-mode', (m: Mode) => { if (app.toolId === 'transform') setMode(m) })

  const numIn = (label: string, get: () => number, set: (v: number) => void, unit: string) => {
    const i = h('input', { type: 'number', value: Math.round(get() * 10) / 10, step: 1 }) as HTMLInputElement
    i.addEventListener('change', () => { if (!begin()) return; inner.mark(); set(+i.value || 0); render(); app.emit('panel') })
    i.addEventListener('keydown', e => e.stopPropagation())
    return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--mute)' } }, label + (unit ? ` (${unit})` : ''), i)
  }

  return {
    id: 'transform', label: 'Free transform', icon: 'transform', steps,
    cursor(p) {
      if (!st || !p) return 'default'
      if (st.mode !== 'box') {
        const k = hitMesh(p)
        return !k ? 'default' : k.kind === 'pt' || k.kind === 'edge' ? 'crosshair' : k.kind === 'in' ? 'move' : 'alias'
      }
      const k = hit(p)
      if (!k) return 'default'
      if (k.kind === 'move') return 'move'
      if (k.kind === 'rot') return 'alias'
      const [hx, hy] = HANDLES[k.h]
      const ang = (Math.atan2(hy * st.sy, hx * st.sx) + st.a) * 180 / Math.PI
      const n = ((Math.round(ang / 45) % 4) + 4) % 4
      return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][n]
    },
    activate() { mode = 'box'; begin() },
    deactivate() { commit() },
    down(p) {
      if (!begin() || !st) return
      if (app.doc !== st.doc || (st.group ? chosenKey(app.doc) !== st.group.key : app.doc.active !== st.l || isMulti(app.doc))) { commit(); if (!begin() || !st) return }
      if (st.mode === 'box') {
        const k = hit(p)!
        // Ctrl-drag a corner to move it on its own, as in Distort.
        if (k.kind === 'scale' && k.h < 4 && (p.e.ctrlKey || p.e.metaKey)) setMode('distort')
        else {
          inner.mark()
          drag = { kind: k.kind, h: k.h, p0: p, s0: { cx: st.cx, cy: st.cy, sx: st.sx, sy: st.sy, a: st.a } }
          return
        }
      }
      const s = st
      const k = hitMesh(p)!
      const from = { quad: s.quad.slice(), grid: s.grid.slice() }
      inner.mark()
      if (k.kind === 'pt') {
        if (p.e.shiftKey) { if (picked.has(k.i)) picked.delete(k.i); else picked.add(k.i) }
        else if (!picked.has(k.i)) { picked.clear(); picked.add(k.i) }
        mdrag = { kind: 'pts', ids: picked.has(k.i) ? [...picked] : [k.i], p0: p, ...from, moved: false }
      } else if (k.kind === 'edge') {
        mdrag = { kind: 'edge', ids: [k.i, (k.i + 1) % 4], p0: p, ...from, moved: false }
      } else if (k.kind === 'in') {
        if (!p.e.shiftKey) picked.clear()
        if (s.mode === 'warp' && !p.e.altKey) {
          const w = warpInfluence(s.cols, s.rows, k.uv![0], k.uv![1])
          let ss = 0; for (const v of w) ss += v * v
          mdrag = { kind: 'surface', ids: [], p0: p, ...from, w, ss, moved: false }
        } else mdrag = { kind: 'all', ids: [], p0: p, ...from, moved: false }
      } else mdrag = { kind: 'spin', ids: [], p0: p, ...from, c: centroid(s.mode === 'warp' ? s.grid : s.quad), moved: false }
      app.view.draw()
    },
    move(p, pressed) {
      if (pressed && mdrag && st) {
        const s = st, g = mdrag
        let dx = p.x - g.p0.x, dy = p.y - g.p0.y
        if (p.e.shiftKey && g.kind !== 'spin' && g.kind !== 'pts') { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        g.moved = g.moved || Math.hypot(dx, dy) > 0
        if (g.kind === 'pts' || g.kind === 'edge') movePts(s, g, (x, y) => [x + dx, y + dy], g.ids)
        else if (g.kind === 'all') movePts(s, g, (x, y) => [x + dx, y + dy])
        else if (g.kind === 'surface') movePts(s, g, (x, y, i) => { const k = g.w![i] / g.ss!; return [x + dx * k, y + dy * k] })
        else {
          const c = g.c!
          let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(g.p0.y - c.y, g.p0.x - c.x)
          if (p.e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
          const cs = Math.cos(a), sn = Math.sin(a)
          movePts(s, g, (x, y) => [c.x + (x - c.x) * cs - (y - c.y) * sn, c.y + (x - c.x) * sn + (y - c.y) * cs])
        }
        render()
        return
      }
      if (!pressed || !drag || !st) return
      const s = st, o = drag.s0
      if (drag.kind === 'move') {
        let dx = p.x - drag.p0.x, dy = p.y - drag.p0.y
        if (p.e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
        s.cx = o.cx + dx; s.cy = o.cy + dy
      } else if (drag.kind === 'rot') {
        const a0 = Math.atan2(drag.p0.y - o.cy, drag.p0.x - o.cx), a1 = Math.atan2(p.y - o.cy, p.x - o.cx)
        let a = o.a + a1 - a0
        if (p.e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12)
        s.a = a
      } else {
        const [hx, hy] = HANDLES[drag.h]
        const cos = Math.cos(o.a), sin = Math.sin(o.a)
        const rot = (lx: number, ly: number) => ({ x: cos * lx - sin * ly, y: sin * lx + cos * ly })
        // Work in the box's own (rotated) axes. The anchor stays put: the opposite handle, or the centre with Alt.
        const fromCentre = p.e.altKey
        const span = fromCentre ? 0.5 : 1
        const ar = rot((-hx * s.bw * o.sx) / 2, (-hy * s.bh * o.sy) / 2)
        const A = fromCentre ? { x: o.cx, y: o.cy } : { x: o.cx + ar.x, y: o.cy + ar.y }
        const vx = p.x - A.x, vy = p.y - A.y
        const ux = cos * vx + sin * vy, uy = -sin * vx + cos * vy
        let sx = hx ? ux / (hx * s.bw * span) : o.sx
        let sy = hy ? uy / (hy * s.bh * span) : o.sy
        if (hx && hy && keepRatio !== p.e.shiftKey) {
          const wx = hx * s.bw * o.sx * span, wy = hy * s.bh * o.sy * span
          const k = (ux * wx + uy * wy) / (wx * wx + wy * wy)
          sx = o.sx * k; sy = o.sy * k
        }
        const min = 1 / Math.max(s.bw, s.bh)
        if (Math.abs(sx) < min) sx = (sx < 0 ? -1 : 1) * min
        if (Math.abs(sy) < min) sy = (sy < 0 ? -1 : 1) * min
        s.sx = sx; s.sy = sy
        if (fromCentre) { s.cx = o.cx; s.cy = o.cy }
        else { const c = rot((hx * s.bw * sx) / 2, (hy * s.bh * sy) / 2); s.cx = A.x + c.x; s.cy = A.y + c.y }
      }
      render()
    },
    up(p) {
      if (mdrag) { const g = mdrag; mdrag = null; if (!g.moved) inner.unmark(); app.emit('panel'); app.view.draw(); return }
      if (drag) {
        const o = drag.s0, s = st
        drag = null
        if (s && o.cx === s.cx && o.cy === s.cy && o.sx === s.sx && o.sy === s.sy && o.a === s.a) inner.unmark()
        if (hold) { hold.end(); hold = null; render() }
        app.emit('panel')
      }
    },
    dbl() { commit() },
    key(e) {
      if (!st) return false
      if (e.key === 'Enter') { commit(); return true }
      if (e.key === 'Escape') { cancel(); return true }
      const step = e.shiftKey ? 10 : 1
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (mv[e.key] && !(e.ctrlKey || e.metaKey || e.altKey)) {
        const [dx, dy] = mv[e.key]
        inner.mark()
        if (st.mode === 'box') { st.cx += dx; st.cy += dy }
        else {
          // Arrows nudge the picked points, or the whole shape when none are picked.
          const ids = picked.size ? [...picked].filter(i => st!.mode === 'warp' || i < 4) : undefined
          movePts(st, { quad: st.quad, grid: st.grid }, (x, y) => [x + dx, y + dy], ids && ids.length ? ids : undefined)
        }
        render(); return true
      }
      return false
    },
    overlay(x: CanvasRenderingContext2D, v: Viewport) {
      if (!st) return
      if (st.mode !== 'box') return meshOverlay(x, v, st)
      const pts = [0, 1, 2, 3].map(i => { const c = corner(st!, ...HANDLES[i]); return v.toScreen(c.x, c.y) })
      x.save()
      x.beginPath(); pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y))); x.closePath()
      x.lineWidth = 2.5; x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke()
      x.lineWidth = 1; x.strokeStyle = '#8AA7D9'; x.stroke()
      for (const [hx, hy] of HANDLES) {
        const c = corner(st, hx, hy), q = v.toScreen(c.x, c.y)
        x.fillStyle = '#fff'; x.strokeStyle = '#4a6fae'; x.lineWidth = 1.5
        x.fillRect(q.x - 4.5, q.y - 4.5, 9, 9); x.strokeRect(q.x - 4.5, q.y - 4.5, 9, 9)
      }
      const c = v.toScreen(st.cx, st.cy)
      x.strokeStyle = '#fff'; x.lineWidth = 1
      x.beginPath(); x.moveTo(c.x - 5, c.y); x.lineTo(c.x + 5, c.y); x.moveTo(c.x, c.y - 5); x.lineTo(c.x, c.y + 5); x.stroke()
      x.restore()
    },
    panel() {
      const l = app.doc?.active
      if (!st && !(l && ((l.canvas && ['image', 'paint', 'highlight'].includes(l.kind)) || isMulti(app.doc!)))) {
        return h('div', { class: 'ib' }, sec('Free transform'), hint('Select an image or paint layer, or a folder, to scale, rotate, distort or warp it. For text and shapes, use Move: drag their handles, and the filled handle above them to turn them.'))
      }
      const s = st
      const deg = s ? ((s.a * 180) / Math.PI) : 0
      const m = s ? s.mode : mode
      const modes = seg<Mode>([['box', 'Scale'], ['distort', 'Distort'], ['warp', 'Warp']], () => m, v => setMode(v), 'Transform mode')
      const sel = app.doc?.selection ? 'Reshapes the selected part of the layer. ' : ''
      const finish = h('div', { class: 'g2' },
        h('button', { disabled: !s, onclick: () => cancel() }, 'Cancel'),
        h('button', { class: 'pri', disabled: !s, onclick: () => commit() }, 'Apply'))
      if (m === 'distort') {
        return h('div', { class: 'ib' },
          sec('Distort' + (s ? ': ' + (s.group || s.l).name : '')), modes,
          hint(sel + 'Drag a corner to move it on its own, or an edge to slide it. Drag inside to move, outside to rotate. Shift-click corners to move several, and use the arrow keys to nudge. Enter applies, Esc cancels, Ctrl+Z steps back.'),
          toggle('High-quality preview', () => quality, v => { quality = v; render() }),
          btn('Reset corners', resetShape, 'wide'),
          finish)
      }
      if (m === 'warp') {
        return h('div', { class: 'ib' },
          sec('Warp' + (s ? ': ' + (s.group || s.l).name : '')), modes,
          hint(sel + 'Drag a grid point to bend the layer, or drag anywhere inside to pull the surface. Alt-drag inside moves it, drag outside rotates. Shift-click points to move several together. Enter applies, Esc cancels, Ctrl+Z steps back.'),
          select('Grid', GRIDS, () => String(s ? s.cols : warpCells), v => setCells(+v)),
          toggle('High-quality preview', () => quality, v => { quality = v; render() }),
          btn('Reset grid', resetShape, 'wide'),
          finish)
      }
      const edit = (fn: () => void) => () => { if (begin() && st) { inner.mark(); fn(); render(); app.emit('panel') } }
      return h('div', { class: 'ib' },
        sec('Free transform' + (s ? ': ' + (s.group || s.l).name : '')), modes,
        hint(sel + 'Drag inside to move, a handle to resize, or just outside a corner to rotate. Hold Shift to ' + (keepRatio ? 'resize freely' : 'keep the proportions') + ' or snap rotation, Alt to resize from the centre, Ctrl to drag a corner on its own. Enter applies, Esc cancels.'),
        toggle('Keep proportions at the corners', () => keepRatio, v => { keepRatio = v; app.emit('panel') }),
        toggle('High-quality resampling', () => quality, v => { quality = v; render() }),
        s && h('div', { class: 'g3' },
          numIn('Width', () => Math.abs(s.sx) * 100, v => (s.sx = Math.sign(s.sx) * Math.max(0.1, v) / 100), '%'),
          numIn('Height', () => Math.abs(s.sy) * 100, v => (s.sy = Math.sign(s.sy) * Math.max(0.1, v) / 100), '%'),
          numIn('Angle', () => deg, v => (s.a = (v * Math.PI) / 180), '°')),
        s && h('div', { class: 'g2' },
          numIn('Move across', () => s.cx - s.bx, v => (s.cx = s.bx + v), 'px'),
          numIn('Move down', () => s.cy - s.by, v => (s.cy = s.by + v), 'px')),
        h('div', { class: 'g3' },
          btn('Flip across', edit(() => { st!.sx = -st!.sx })),
          btn('Flip up', edit(() => { st!.sy = -st!.sy })),
          btn('Turn 90°', edit(() => { st!.a += Math.PI / 2 }))),
        btn('Fit to image', edit(() => {
          const t = st!, d = t.doc
          const k = Math.min(d.w / t.bw, d.h / t.bh)
          t.sx = Math.sign(t.sx) * k; t.sy = Math.sign(t.sy) * k; t.a = 0; t.cx = d.w / 2; t.cy = d.h / 2
        }), 'wide'),
        finish)
    }
  }
}
