import type { App } from '../app'
import type { Tool } from './types'
import { Doc, Layer, snapshot } from '../core/doc'
import { holdFx, touch } from '../core/compose'
import type { History } from '../core/history'
import { alphaOf, bboxOfAlpha, canvas, copyCanvas, ctx2d } from '../core/util'
import { h, toast } from '../ui/dom'
import { btn, hint, sec, toggle } from '../ui/controls'
import type { Pt, Viewport } from '../view/viewport'

/** Box being transformed: its untransformed size (bw, bh) and centre (bx, by), and where it is now. */
interface State {
  doc: Doc; hist: History; l: Layer
  orig: HTMLCanvasElement; origMask: HTMLCanvasElement | null; origSel: HTMLCanvasElement | null
  float: HTMLCanvasElement; base: HTMLCanvasElement | null
  bx: number; by: number; bw: number; bh: number
  cx: number; cy: number; sx: number; sy: number; a: number
}

const HANDLES: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]]

/** Scale, rotate and move a pixel layer, or just the selected part of it. */
export function transformTool(app: App): Tool {
  let st: State | null = null
  let drag: { kind: 'move' | 'rot' | 'scale'; h: number; p0: Pt; s0: Pick<State, 'cx' | 'cy' | 'sx' | 'sy' | 'a'> } | null = null
  let keepRatio = true
  let hold: ReturnType<typeof holdFx> = null
  let holdFrom = new DOMMatrix()
  let quality = true

  const matrix = (s: State) => new DOMMatrix().translate(s.cx, s.cy).rotate((s.a * 180) / Math.PI).scale(s.sx, s.sy).translate(-s.bx, -s.by)
  const corner = (s: State, hx: number, hy: number) => {
    const p = new DOMPoint(s.bx + (hx * s.bw) / 2, s.by + (hy * s.bh) / 2).matrixTransform(matrix(s))
    return { x: p.x, y: p.y }
  }
  const changed = (s: State) => s.cx !== s.bx || s.cy !== s.by || s.sx !== 1 || s.sy !== 1 || s.a !== 0

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
    if (drag && !st.base && !hold) { hold = holdFx(st.doc, st.l); holdFrom = matrix({ ...st, ...drag.s0 }) }
    paint(st.l.canvas!, st.base, st.float, matrix(st))
    hold?.draw(matrix(st).multiply(holdFrom.inverse()))
    touch(st.l)
    st.doc.changed()
    app.view.draw()
  }

  const begin = (): boolean => {
    if (st) return true
    const doc = app.doc
    if (!doc) return false
    const a = doc.active
    if (a && (a.shape || a.kind === 'text')) { toast('Use Move to resize text and shapes: drag their round handles'); return false }
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
    st = {
      doc, hist: app.hist!, l, orig, origMask: l.mask && !doc.selection ? copyCanvas(l.mask) : null, origSel: doc.selection,
      float, base, bx: bb.x + bb.w / 2, by: bb.y + bb.h / 2, bw: bb.w, bh: bb.h, cx: bb.x + bb.w / 2, cy: bb.y + bb.h / 2, sx: 1, sy: 1, a: 0
    }
    app.hist!.pending = commit
    app.emit('panel')
    return true
  }

  const clear = () => { if (st && st.hist.pending === commit) st.hist.pending = null; hold?.end(); hold = null; st = null; drag = null }
  function commit() {
    const s = st
    if (!s) return
    clear()
    if (!changed(s)) { paint(s.l.canvas!, null, s.orig, new DOMMatrix()); touch(s.l); s.doc.changed(); app.emit('panel'); return }
    const m = matrix(s)
    const before = snapshot(s.doc)
    const bl = before.layers.find(x => x.ref === s.l)!.p
    bl.canvas = s.orig
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
    s.doc.changed()
    app.emit('panel')
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

  const numIn = (label: string, get: () => number, set: (v: number) => void, unit: string) => {
    const i = h('input', { type: 'number', value: Math.round(get() * 10) / 10, step: 1 }) as HTMLInputElement
    i.addEventListener('change', () => { if (!begin()) return; set(+i.value || 0); render(); app.emit('panel') })
    i.addEventListener('keydown', e => e.stopPropagation())
    return h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--mute)' } }, label + (unit ? ` (${unit})` : ''), i)
  }

  return {
    id: 'transform', label: 'Free transform', icon: 'transform',
    cursor(p) {
      if (!st || !p) return 'default'
      const k = hit(p)
      if (!k) return 'default'
      if (k.kind === 'move') return 'move'
      if (k.kind === 'rot') return 'alias'
      const [hx, hy] = HANDLES[k.h]
      const ang = (Math.atan2(hy * st.sy, hx * st.sx) + st.a) * 180 / Math.PI
      const n = ((Math.round(ang / 45) % 4) + 4) % 4
      return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][n]
    },
    activate() { begin() },
    deactivate() { commit() },
    down(p) {
      if (!begin() || !st) return
      if (app.doc !== st.doc || app.doc.active !== st.l) { commit(); if (!begin() || !st) return }
      const k = hit(p)!
      drag = { kind: k.kind, h: k.h, p0: p, s0: { cx: st.cx, cy: st.cy, sx: st.sx, sy: st.sy, a: st.a } }
    },
    move(p, pressed) {
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
    up() { if (drag) { drag = null; if (hold) { hold.end(); hold = null; render() } app.emit('panel') } },
    dbl() { commit() },
    key(e) {
      if (!st) return false
      if (e.key === 'Enter') { commit(); return true }
      if (e.key === 'Escape') { cancel(); return true }
      const step = e.shiftKey ? 10 : 1
      const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
      if (mv[e.key]) { st.cx += mv[e.key][0]; st.cy += mv[e.key][1]; render(); return true }
      return false
    },
    overlay(x: CanvasRenderingContext2D, v: Viewport) {
      if (!st) return
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
      if (!st && !(l && l.canvas && ['image', 'paint', 'highlight'].includes(l.kind))) {
        return h('div', { class: 'ib' }, sec('Free transform'), hint('Select an image or paint layer to scale, rotate or move it. For text and shapes, use Move and drag their handles.'))
      }
      const s = st
      const deg = s ? ((s.a * 180) / Math.PI) : 0
      return h('div', { class: 'ib' },
        sec('Free transform' + (s ? ': ' + s.l.name : '')),
        hint((app.doc?.selection ? 'Transforms the selected part of the layer. ' : '') + 'Drag inside to move, a handle to resize, or just outside a corner to rotate. Hold Shift to ' + (keepRatio ? 'resize freely' : 'keep the proportions') + ' or snap rotation, Alt to resize from the centre. Enter applies, Esc cancels.'),
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
          btn('Flip across', () => { if (begin() && st) { st.sx = -st.sx; render(); app.emit('panel') } }),
          btn('Flip up', () => { if (begin() && st) { st.sy = -st.sy; render(); app.emit('panel') } }),
          btn('Turn 90°', () => { if (begin() && st) { st.a += Math.PI / 2; render(); app.emit('panel') } })),
        btn('Fit to image', () => {
          if (!begin() || !st) return
          const d = st.doc
          const k = Math.min(d.w / st.bw, d.h / st.bh)
          st.sx = Math.sign(st.sx) * k; st.sy = Math.sign(st.sy) * k; st.a = 0; st.cx = d.w / 2; st.cy = d.h / 2
          render(); app.emit('panel')
        }, 'wide'),
        h('div', { class: 'g2' },
          h('button', { disabled: !s, onclick: () => cancel() }, 'Cancel'),
          h('button', { class: 'pri', disabled: !s, onclick: () => commit() }, 'Apply')))
    }
  }
}
