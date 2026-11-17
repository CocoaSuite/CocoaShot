import { compose, effectiveMask, layerFull } from '../core/compose'
import { contours } from '../core/px'
import { alphaOf, bboxOfAlpha, canvas, ctx2d, Rect, rectUnion } from '../core/util'
import type { App } from '../app'

export interface Pt { x: number; y: number; p: number; sx: number; sy: number; rx: number; ry: number; e: PointerEvent }

export class Viewport {
  el: HTMLCanvasElement
  zoom = 1
  ox = 0
  oy = 0
  compare: 'off' | 'split' = 'off'
  split = 0.5
  showOriginal = false
  maskView: 'normal' | 'mask' | 'overlay' = 'normal'
  hover: { x: number; y: number } | null = null
  alphaView = false
  angle = 0
  flip = false
  showAnts = true
  private alphaTmp: HTMLCanvasElement | null = null
  private overTmp: HTMLCanvasElement | null = null
  private pending: Rect | null | true = null
  private raf = 0
  private ants: Path2D | null = null
  private antsOff = 0
  private antTimer = 0
  private pat: CanvasPattern | null = null
  private panning: { x: number; y: number; ox: number; oy: number } | null = null
  space = false
  private splitDrag = false
  gesture: { kind: 'size' | 'opacity'; sx: number; sy: number; v0: number; at: { x: number; y: number }; click: Pt | null; pick: boolean; moved: boolean } | null = null

  constructor(public app: App, public desk: HTMLElement) {
    this.el = document.createElement('canvas')
    this.el.className = 'view'
    desk.appendChild(this.el)
    new ResizeObserver(() => this.resize()).observe(desk)
    this.el.addEventListener('pointerdown', e => this.down(e))
    this.el.addEventListener('pointermove', e => this.move(e))
    this.el.addEventListener('pointerup', e => this.up(e))
    this.el.addEventListener('pointercancel', e => this.up(e))
    this.el.addEventListener('pointerleave', () => { this.hover = null; this.draw() })
    this.el.addEventListener('wheel', e => this.wheel(e), { passive: false })
    this.el.addEventListener('dblclick', e => app.tool?.dbl?.(this.pt(e as any)))
    this.el.addEventListener('contextmenu', e => e.preventDefault())
  }

  get doc() { return this.app.doc }

  resize() {
    const r = this.desk.getBoundingClientRect(), d = devicePixelRatio || 1
    this.el.width = Math.max(1, Math.round(r.width * d))
    this.el.height = Math.max(1, Math.round(r.height * d))
    this.pat = null
    this.draw()
  }

  size() { const r = this.desk.getBoundingClientRect(); return { w: r.width, h: r.height } }

  /** Fits the image in the window. grow: small images are enlarged too (Fit to screen); otherwise at most 100%. */
  fit(grow = false) {
    if (!this.doc) return
    const { w, h } = this.size()
    const z = Math.min((w - 60) / this.doc.w, (h - 60) / this.doc.h, grow ? 32 : 1)
    this.zoom = Math.max(0.01, z)
    this.ox = (w - this.doc.w * this.zoom) / 2
    this.oy = (h - this.doc.h * this.zoom) / 2
    this.app.emit('zoom')
    this.draw()
  }

  setZoom(z: number, cx?: number, cy?: number) {
    const { w, h } = this.size()
    cx ??= w / 2; cy ??= h / 2
    z = Math.max(0.02, Math.min(32, z))
    const dx = (cx - this.ox) / this.zoom, dy = (cy - this.oy) / this.zoom
    this.zoom = z
    this.ox = cx - dx * z
    this.oy = cy - dy * z
    this.app.emit('zoom')
    this.draw()
  }
  zoomStep(dir: number) {
    const steps = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32]
    const z = this.zoom
    const n = dir > 0 ? steps.find(s => s > z * 1.01) : [...steps].reverse().find(s => s < z * 0.99)
    this.setZoom(n || z)
  }

  get rotated() { return !!(this.angle % 360) || this.flip }
  /** Maps unrotated screen space to what is drawn: rotation and flip about the middle of the view. */
  rot(): DOMMatrix {
    const { w, h } = this.size()
    const m = new DOMMatrix().translate(w / 2, h / 2).rotate(this.angle)
    if (this.flip) m.scaleSelf(-1, 1)
    return m.translate(-w / 2, -h / 2)
  }
  unrotate(x: number, y: number) { if (!this.rotated) return { x, y }; const q = this.rot().inverse().transformPoint({ x, y }); return { x: q.x, y: q.y } }
  /** Real on-screen position of a document point, rotation included. */
  screenOf(x: number, y: number) { const s = this.toScreen(x, y); if (!this.rotated) return s; const q = this.rot().transformPoint(s); return { x: q.x, y: q.y } }
  unrotateVec(dx: number, dy: number) { if (!this.rotated) return { x: dx, y: dy }; const m = this.rot().inverse(); return { x: m.a * dx + m.c * dy, y: m.b * dx + m.d * dy } }

  pt(e: PointerEvent): Pt {
    const r = this.el.getBoundingClientRect()
    const rx = e.clientX - r.left, ry = e.clientY - r.top
    const u = this.unrotate(rx, ry)
    return { x: (u.x - this.ox) / this.zoom, y: (u.y - this.oy) / this.zoom, p: e.pointerType === 'pen' ? e.pressure || 0.5 : 1, sx: u.x, sy: u.y, rx, ry, e }
  }
  toScreen(x: number, y: number) { return { x: x * this.zoom + this.ox, y: y * this.zoom + this.oy } }

  setAngle(a: number) {
    a = ((Math.round(a) % 360) + 540) % 360 - 180
    this.angle = a
    this.app.emit('view')
    this.draw()
  }
  setFlip(v: boolean) { this.flip = v; this.app.emit('view'); this.draw() }
  /** Zooms keeping the given screen point (real, rotated) still. */
  zoomAt(z: number, rx: number, ry: number) { const u = this.unrotate(rx, ry); this.setZoom(z, u.x, u.y) }

  private down(e: PointerEvent) {
    this.el.focus()
    if (!this.doc) return
    this.el.setPointerCapture(e.pointerId)
    if (e.button === 1 || this.space || (e.button === 0 && this.app.toolId === 'hand')) {
      this.panning = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy }
      this.el.style.cursor = 'grabbing'
      return
    }
    if (this.compare === 'split') {
      const p = this.pt(e)
      const sx = this.ox + this.doc.w * this.zoom * this.split
      if (Math.abs(p.sx - sx) < 10) { this.splitDrag = true; return }
    }
    if (e.button === 2) return
    const b = this.app.tool?.brush?.()
    // Alt+click picks a colour with the painting tools; brushes still Alt+drag for opacity.
    if (e.button === 0 && e.altKey && this.app.tool?.altPick && !b) { const p = this.pt(e); this.pickAt(p.x, p.y); return }
    if (b && e.button === 0) {
      const kind = e.ctrlKey || e.metaKey ? 'size' : e.altKey && b.setOpacity && b.getOpacity ? 'opacity' : null
      if (kind) {
        const p = this.pt(e)
        this.gesture = { kind, sx: p.rx, sy: p.ry, v0: kind === 'size' ? b.getSize() : b.getOpacity!(), at: { x: p.x, y: p.y }, click: kind === 'opacity' && b.altClick ? p : null, pick: kind === 'opacity' && !!this.app.tool?.altPick, moved: false }
        this.hover = this.gesture.at
        this.draw()
        return
      }
    }
    this.app.tool?.down?.(this.pt(e))
  }
  private move(e: PointerEvent) {
    if (this.panning) {
      const d = this.unrotateVec(e.clientX - this.panning.x, e.clientY - this.panning.y)
      this.ox = this.panning.ox + d.x
      this.oy = this.panning.oy + d.y
      this.draw()
      return
    }
    const p = this.pt(e)
    const g = this.gesture
    if (g) {
      const b = this.app.tool?.brush?.()
      const dx = p.rx - g.sx
      if (b && (g.moved || Math.abs(dx) > 3 || Math.abs(p.ry - g.sy) > 3)) {
        g.moved = true
        if (g.kind === 'size') b.setSize(Math.round(Math.min(b.maxSize ?? 1000, Math.max(b.minSize ?? 1, g.v0 * Math.pow(2, dx / 120)))))
        else b.setOpacity!(Math.round(Math.min(1, Math.max(b.minOpacity ?? 0.01, g.v0 + dx / 250)) * 100) / 100)
      }
      this.hover = g.at
      this.draw()
      return
    }
    if (this.splitDrag && this.doc) { this.split = Math.max(0, Math.min(1, p.x / this.doc.w)); this.draw(); return }
    this.hover = { x: p.x, y: p.y }
    if (this.el.hasPointerCapture(e.pointerId)) {
      const evs = (e as any).getCoalescedEvents?.() as PointerEvent[] | undefined
      if (evs && evs.length > 1 && this.app.tool?.move) for (const ce of evs) this.app.tool.move(this.pt(ce), true)
      else this.app.tool?.move?.(p, true)
    } else this.app.tool?.move?.(p, false)
    this.updateCursor(p)
    this.draw()
  }
  private up(e: PointerEvent) {
    if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId)
    if (this.panning) { this.panning = null; this.updateCursor(); return }
    if (this.splitDrag) { this.splitDrag = false; return }
    const g = this.gesture
    if (g) {
      this.gesture = null
      if (g.moved) this.app.emit('panel')
      else if (g.pick) this.pickAt(g.at.x, g.at.y)
      else if (g.click) { this.app.tool?.down?.(g.click); this.app.tool?.up?.(g.click) }
      this.draw()
      return
    }
    this.app.tool?.up?.(this.pt(e))
    this.draw()
  }
  private pickAt(x: number, y: number) {
    const c = this.app.sampleColor(x, y)
    if (c) this.app.setColors(c)
  }
  private wheel(e: WheelEvent) {
    e.preventDefault()
    const r = this.el.getBoundingClientRect()
    if (e.ctrlKey || e.metaKey) this.zoomAt(this.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top)
    else {
      const k = e.deltaMode ? 30 : 1
      const d = this.unrotateVec((e.shiftKey ? e.deltaY : e.deltaX) * k, (e.shiftKey ? 0 : e.deltaY) * k)
      this.ox -= d.x
      this.oy -= d.y
      this.draw()
    }
  }

  updateCursor(p?: Pt) {
    if (this.space || this.app.toolId === 'hand') { this.el.style.cursor = 'grab'; return }
    this.el.style.cursor = this.app.tool?.cursor?.(p) || 'default'
  }

  dirty(r: Rect | null) {
    if (r === null) this.pending = true
    else if (this.pending !== true) this.pending = rectUnion(this.pending, r)
    this.schedule()
  }
  schedule() { if (!this.raf) this.raf = requestAnimationFrame(() => this.frame()) }

  private frame() {
    this.raf = 0
    const doc = this.doc
    if (doc && this.pending) {
      const r = this.pending === true ? null : this.pending
      this.pending = null
      compose(doc, doc.comp, r, { stroke: this.app.stroke?.preview?.() || null })
    }
    this.paint()
  }

  draw() { this.schedule() }
  setShowAnts(v: boolean) { this.showAnts = v; this.draw() }

  selectionChanged() {
    const s = this.doc?.selection
    this.ants = null
    if (!s) { this.stopAnts(); this.draw(); return }
    const W = s.width, H = s.height
    const sc = Math.min(1, 1600 / Math.max(W, H))
    let a: Uint8Array, w = W, hh = H
    if (sc < 1) {
      w = Math.round(W * sc); hh = Math.round(H * sc)
      const t = canvas(w, hh); ctx2d(t).drawImage(s, 0, 0, w, hh); a = alphaOf(t)
    } else a = alphaOf(s)
    // A soft selection that never reaches 50% still counts: trace it at half its strongest value.
    let max = 0
    for (let i = 0; i < a.length; i++) if (a[i] > max) { max = a[i]; if (max >= 128) break }
    if (!max && sc < 1) { const f = alphaOf(s); for (let i = 0; i < f.length; i++) if (f[i]) { max = 1; break } }
    const thr = max >= 128 ? 128 : Math.max(1, max / 2)
    const p = new Path2D()
    let any = false
    for (const l of contours(a, w, hh, thr)) {
      any = true
      p.moveTo(l[0] / sc, l[1] / sc)
      for (let i = 2; i < l.length; i += 2) p.lineTo(l[i] / sc, l[i + 1] / sc)
      p.closePath()
    }
    if (!any && max && sc < 1) {
      // Too small to show at the reduced size: mark its box instead of dropping it.
      const bb = bboxOfAlpha(alphaOf(s), W, H)
      if (bb) { p.rect(bb.x, bb.y, Math.max(1, bb.w), Math.max(1, bb.h)); any = true }
    }
    if (!any) { this.doc!.selection = null; this.stopAnts(); this.app.emit('selection-empty'); this.draw(); return }
    this.ants = p
    if (!this.antTimer) this.antTimer = window.setInterval(() => { this.antsOff = (this.antsOff + 1) % 16; this.draw() }, 90)
    this.draw()
  }
  private stopAnts() { clearInterval(this.antTimer); this.antTimer = 0 }

  private checker(x: CanvasRenderingContext2D) {
    if (this.pat) return this.pat
    const cs = getComputedStyle(document.documentElement)
    const c = canvas(16, 16), cx = ctx2d(c)
    cx.fillStyle = cs.getPropertyValue('--chk1').trim() || '#2b2b2b'; cx.fillRect(0, 0, 16, 16)
    cx.fillStyle = cs.getPropertyValue('--chk2').trim() || '#363636'; cx.fillRect(0, 0, 8, 8); cx.fillRect(8, 8, 8, 8)
    this.pat = x.createPattern(c, 'repeat')
    return this.pat
  }

  private paint() {
    const x = this.el.getContext('2d')!
    const d = devicePixelRatio || 1
    x.setTransform(1, 0, 0, 1, 0, 0)
    x.clearRect(0, 0, this.el.width, this.el.height)
    const doc = this.doc
    if (!doc) return
    x.setTransform(d, 0, 0, d, 0, 0)
    if (this.rotated) { const m = this.rot(); x.transform(m.a, m.b, m.c, m.d, m.e, m.f) }
    const z = this.zoom, W = doc.w * z, H = doc.h * z
    x.save()
    x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = 24; x.shadowOffsetY = 6
    x.fillStyle = this.checker(x)!
    x.translate(this.ox, this.oy)
    x.fillRect(0, 0, W, H)
    x.restore()
    x.save()
    x.translate(this.ox, this.oy)
    x.imageSmoothingEnabled = z < 2
    x.imageSmoothingQuality = 'high'
    const active = this.app.doc?.active
    if (this.maskView === 'mask' && active?.mask) {
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H)
      x.drawImage(effectiveMask(active)!, 0, 0, W, H)
    } else if (this.alphaView && active?.canvas && !this.showOriginal) {
      const src = layerFull(doc, active)!
      if (!this.alphaTmp || this.alphaTmp.width !== doc.w || this.alphaTmp.height !== doc.h) this.alphaTmp = canvas(doc.w, doc.h)
      const tx = ctx2d(this.alphaTmp)
      tx.globalCompositeOperation = 'copy'; tx.drawImage(src, 0, 0)
      tx.globalCompositeOperation = 'source-in'; tx.fillStyle = '#fff'; tx.fillRect(0, 0, doc.w, doc.h)
      tx.globalCompositeOperation = 'source-over'
      x.fillStyle = '#000'; x.fillRect(0, 0, W, H)
      x.drawImage(this.alphaTmp, 0, 0, W, H)
    } else {
      if (this.showOriginal) x.drawImage(doc.original, 0, 0, W, H)
      else x.drawImage(doc.comp, 0, 0, W, H)
      if (this.maskView === 'overlay' && active?.mask && active.canvas) {
        const tw = Math.min(doc.w, 2400), th = Math.min(doc.h, Math.round(2400 * doc.h / doc.w))
        if (!this.overTmp || this.overTmp.width !== tw || this.overTmp.height !== th) this.overTmp = canvas(tw, th)
        const t = this.overTmp
        const tx = ctx2d(t)
        tx.globalCompositeOperation = 'source-over'; tx.clearRect(0, 0, tw, th)
        tx.fillStyle = 'rgba(255,60,60,.5)'; tx.fillRect(0, 0, t.width, t.height)
        tx.globalCompositeOperation = 'destination-out'
        tx.drawImage(effectiveMask(active)!, 0, 0, t.width, t.height)
        x.globalAlpha = 0.5
        x.drawImage(active.canvas, 0, 0, W, H)
        x.globalAlpha = 1
        x.drawImage(t, 0, 0, W, H)
      }
      if (this.compare === 'split' && !this.showOriginal) {
        const sx = W * this.split
        x.save()
        x.beginPath(); x.rect(0, 0, sx, H); x.clip()
        x.fillStyle = this.checker(x)!; x.fillRect(0, 0, sx, H)
        x.drawImage(doc.original, 0, 0, doc.original.width, doc.original.height, 0, 0, W, H)
        x.restore()
        x.fillStyle = '#fff'; x.fillRect(sx - 1, 0, 2, H)
        x.beginPath(); x.arc(sx, H / 2, 13, 0, Math.PI * 2); x.fill()
        x.strokeStyle = '#111'; x.lineWidth = 2
        x.beginPath(); x.moveTo(sx - 4, H / 2 - 5); x.lineTo(sx - 8, H / 2); x.lineTo(sx - 4, H / 2 + 5); x.moveTo(sx + 4, H / 2 - 5); x.lineTo(sx + 8, H / 2); x.lineTo(sx + 4, H / 2 + 5); x.stroke()
        x.font = '500 11px Inter, sans-serif'
        const tag = (t: string, tx: number) => { const w = x.measureText(t).width + 14; x.fillStyle = 'rgba(18,18,18,.75)'; x.beginPath(); x.roundRect(tx, 10, w, 20, 4); x.fill(); x.fillStyle = '#fff'; x.fillText(t, tx + 7, 24) }
        if (sx > 80) tag('Before', 10)
        if (W - sx > 70) tag('After', W - x.measureText('After').width - 24)
      }
    }
    x.restore()
    if (this.ants && this.showAnts) {
      x.save()
      x.translate(this.ox, this.oy); x.scale(z, z)
      x.lineWidth = 1 / z
      x.setLineDash([4 / z, 4 / z])
      x.strokeStyle = '#000'; x.lineDashOffset = -this.antsOff / z; x.stroke(this.ants)
      x.strokeStyle = '#fff'; x.lineDashOffset = (-this.antsOff + 4) / z; x.stroke(this.ants)
      x.restore()
    }
    this.app.tool?.overlay?.(x, this)
    if (this.gesture) this.gestureOverlay(x)
    this.app.emit('view')
  }

  private gestureOverlay(x: CanvasRenderingContext2D) {
    const g = this.gesture!, b = this.app.tool?.brush?.()
    if (!b) return
    const p = this.toScreen(g.at.x, g.at.y)
    const r = Math.max(1.5, (b.getSize() * this.zoom) / 2)
    x.save()
    if (g.kind === 'opacity') {
      x.globalAlpha = b.getOpacity!()
      x.fillStyle = b.color?.() || '#888'
      x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill()
      x.globalAlpha = 1
    }
    const t = g.kind === 'size' ? `Size ${b.getSize()} px` : `Opacity ${Math.round(b.getOpacity!() * 100)}%`
    x.font = '500 11px Inter, sans-serif'
    const w = x.measureText(t).width + 14, ty = Math.max(4, p.y - r - 30)
    x.fillStyle = 'rgba(18,18,18,.8)'; x.beginPath(); x.roundRect(p.x - w / 2, ty, w, 20, 4); x.fill()
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.fillText(t, p.x, ty + 14)
    x.restore()
  }
}
