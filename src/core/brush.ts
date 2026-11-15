import { Doc, Layer } from './doc'
import { History } from './history'
import { StrokePreview, touch, touchMask } from './compose'
import { canvas, copyCanvas, ctx2d, getData, putData, Rect, rectClip, rectUnion } from './util'

export type BrushMode = 'paint' | 'erase' | 'clone' | 'blur' | 'sharpen' | 'smudge' | 'mask-keep' | 'mask-remove' | 'mask-restore' | 'sel-add' | 'sel-sub'

export interface BrushOpts {
  size: number; opacity: number; hardness: number; flow: number; spacing: number
  color: string; pressure: boolean; pencil: boolean; strength: number
  minSize?: number
  pressureOpacity?: boolean
}

export const pressSize = (o: BrushOpts, p: number) => (o.pressure ? Math.max(0.05, (o.minSize ?? 0) + (1 - (o.minSize ?? 0)) * p) : 1)
const pressAlpha = (o: BrushOpts, p: number) => ((o.pressureOpacity ?? o.pressure) ? Math.max(0.1, p) : 1)

const stamps = new Map<string, HTMLCanvasElement>()
function stamp(d: number, hard: number, pencil: boolean): HTMLCanvasElement {
  const k = d + ':' + hard.toFixed(2) + ':' + pencil
  let s = stamps.get(k)
  if (s) return s
  s = canvas(d, d)
  const x = ctx2d(s)
  const r = d / 2
  if (pencil) {
    const id = new ImageData(d, d)
    for (let yy = 0; yy < d; yy++) for (let xx = 0; xx < d; xx++) {
      const dx = xx + 0.5 - r, dy = yy + 0.5 - r
      if (dx * dx + dy * dy <= r * r || d <= 2) { const o = (yy * d + xx) * 4; id.data[o] = id.data[o + 1] = id.data[o + 2] = id.data[o + 3] = 255 }
    }
    x.putImageData(id, 0, 0)
  } else {
    const g = x.createRadialGradient(r, r, 0, r, r, r)
    const h = Math.min(0.99, hard)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(h, 'rgba(255,255,255,1)')
    g.addColorStop(Math.min(1, h + (1 - h) * 0.5), 'rgba(255,255,255,0.35)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.fillRect(0, 0, d, d)
  }
  if (stamps.size > 64) stamps.clear()
  stamps.set(k, s)
  return s
}

const T: HTMLCanvasElement[] = []
function dabTmp(i: number, d: number) {
  let c = T[i]
  if (!c || c.width < d) { c = canvas(d * 1.5 + 8, d * 1.5 + 8); T[i] = c }
  const x = ctx2d(c)
  x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'
  x.clearRect(0, 0, c.width, c.height)
  return c
}

let sharedBuf: HTMLCanvasElement | null = null

export class Stroke {
  rect: Rect | null = null
  last: { x: number; y: number; p: number } | null = null
  carry: HTMLCanvasElement | null = null
  before: HTMLCanvasElement
  buf: HTMLCanvasElement | null = null
  target: HTMLCanvasElement
  rem = 0
  cloneOff: { x: number; y: number } | null = null

  constructor(public doc: Doc, public layer: Layer, public mode: BrushMode, public o: BrushOpts, public hist: History, cloneSrc?: { x: number; y: number } | null, public label = 'Brush') {
    if (mode.startsWith('mask')) {
      if (!layer.mask) { layer.mask = canvas(doc.w, doc.h); const x = ctx2d(layer.mask); x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h) }
      this.target = layer.mask
    } else if (mode.startsWith('sel')) {
      if (!doc.selection) doc.selection = canvas(doc.w, doc.h)
      this.target = doc.selection
    } else this.target = layer.canvas!
    this.before = copyCanvas(this.target)
    if (mode === 'paint' || mode === 'erase') {
      if (!sharedBuf || sharedBuf.width !== doc.w || sharedBuf.height !== doc.h) sharedBuf = canvas(doc.w, doc.h)
      this.buf = sharedBuf
      ctx2d(this.buf).clearRect(0, 0, doc.w, doc.h)
    }
    if (cloneSrc) this.cloneOff = { x: cloneSrc.x, y: cloneSrc.y }
  }

  preview(): StrokePreview | null {
    if (!this.buf) return null
    return { layer: this.layer, buf: this.buf, alpha: this.o.opacity, op: this.mode === 'erase' ? 'destination-out' : this.layer.alphaLock ? 'source-atop' : 'source-over', rect: this.rect }
  }

  begin(x: number, y: number, p: number) {
    if (this.cloneOff) this.cloneOff = { x: this.cloneOff.x - x, y: this.cloneOff.y - y }
    if (this.mode === 'smudge') {
      const d = Math.max(2, Math.round(this.o.size))
      this.carry = canvas(d, d)
      ctx2d(this.carry).drawImage(this.target, x - d / 2, y - d / 2, d, d, 0, 0, d, d)
    }
    this.last = { x, y, p }
    this.dab(x, y, p)
  }

  move(x: number, y: number, p: number) {
    if (!this.last) return this.begin(x, y, p)
    const l = this.last
    const dist = Math.hypot(x - l.x, y - l.y)
    const step = Math.max(1, this.o.size * this.o.spacing * Math.max(0.2, pressSize(this.o, p)))
    let t = step - this.rem
    while (t <= dist) {
      const f = t / dist
      this.dab(l.x + (x - l.x) * f, l.y + (y - l.y) * f, l.p + (p - l.p) * f)
      t += step
    }
    this.rem = dist - (t - step)
    this.last = { x, y, p }
  }

  private dab(x: number, y: number, p: number) {
    const o = this.o, doc = this.doc
    const sz = Math.max(1, o.size * pressSize(o, p))
    const d = Math.max(1, Math.round(sz)), r = d / 2
    const left = Math.round(x - r), top = Math.round(y - r)
    const dr = rectClip({ x: left, y: top, w: d, h: d }, doc.w, doc.h)
    if (!dr) return
    const st = stamp(d, o.hardness, o.pencil)
    const m = dabTmp(0, d)
    const mx = ctx2d(m)
    mx.drawImage(st, 0, 0)
    if (doc.selection && !this.mode.startsWith('sel')) {
      mx.globalCompositeOperation = 'destination-in'
      mx.drawImage(doc.selection, left, top, d, d, 0, 0, d, d)
      mx.globalCompositeOperation = 'source-over'
    }
    const a = o.flow * pressAlpha(o, p)
    const tx = ctx2d(this.target)
    tx.save()
    switch (this.mode) {
      case 'paint':
      case 'erase': {
        const c = dabTmp(1, d), cx = ctx2d(c)
        cx.drawImage(m, 0, 0)
        cx.globalCompositeOperation = 'source-in'
        cx.fillStyle = this.mode === 'erase' ? '#000' : o.color
        cx.fillRect(0, 0, d, d)
        const bx = ctx2d(this.buf!)
        bx.globalAlpha = a
        bx.drawImage(c, 0, 0, d, d, left, top, d, d)
        bx.globalAlpha = 1
        break
      }
      case 'mask-keep': case 'sel-add':
        tx.globalAlpha = a * o.opacity
        tx.drawImage(m, 0, 0, d, d, left, top, d, d); break
      case 'mask-remove': case 'sel-sub':
        tx.globalAlpha = a * o.opacity
        tx.globalCompositeOperation = 'destination-out'
        tx.drawImage(m, 0, 0, d, d, left, top, d, d); break
      case 'mask-restore': {
        const src = this.layer.maskAI
        const c = dabTmp(1, d), cx = ctx2d(c)
        if (src) cx.drawImage(src, left, top, d, d, 0, 0, d, d)
        else { cx.fillStyle = '#fff'; cx.fillRect(0, 0, d, d) }
        cx.globalCompositeOperation = 'destination-in'
        cx.drawImage(m, 0, 0)
        tx.globalAlpha = a * o.opacity
        tx.globalCompositeOperation = 'destination-out'
        tx.drawImage(m, 0, 0, d, d, left, top, d, d)
        tx.globalCompositeOperation = 'lighter'
        tx.drawImage(c, 0, 0, d, d, left, top, d, d)
        break
      }
      case 'clone': {
        if (!this.cloneOff) break
        const c = dabTmp(1, d), cx = ctx2d(c)
        cx.drawImage(this.before, left + this.cloneOff.x, top + this.cloneOff.y, d, d, 0, 0, d, d)
        cx.globalCompositeOperation = 'destination-in'
        cx.drawImage(m, 0, 0)
        tx.globalAlpha = a * o.opacity
        if (this.layer.alphaLock) tx.globalCompositeOperation = 'source-atop'
        tx.drawImage(c, 0, 0, d, d, left, top, d, d)
        break
      }
      case 'blur': {
        const pad = Math.ceil(r)
        const c = dabTmp(1, d + pad * 2), cx = ctx2d(c)
        cx.filter = `blur(${Math.max(0.5, r * 0.15 * (0.3 + o.strength))}px)`
        cx.drawImage(this.target, left - pad, top - pad, d + pad * 2, d + pad * 2, 0, 0, d + pad * 2, d + pad * 2)
        cx.filter = 'none'
        const c2 = dabTmp(2, d), c2x = ctx2d(c2)
        c2x.drawImage(c, pad, pad, d, d, 0, 0, d, d)
        c2x.globalCompositeOperation = 'destination-in'
        c2x.drawImage(m, 0, 0)
        tx.globalAlpha = a * o.opacity
        tx.globalCompositeOperation = 'source-atop'
        tx.drawImage(c2, 0, 0, d, d, left, top, d, d)
        break
      }
      case 'sharpen': {
        const pad = 3
        const R = rectClip({ x: left - pad, y: top - pad, w: d + pad * 2, h: d + pad * 2 }, doc.w, doc.h)
        if (!R) break
        const orig = getData(this.target, R)
        const c = dabTmp(1, Math.max(R.w, R.h)), cx = ctx2d(c)
        cx.filter = 'blur(1.2px)'
        cx.drawImage(this.target, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h)
        cx.filter = 'none'
        const bl = cx.getImageData(0, 0, R.w, R.h)
        const md = mx.getImageData(0, 0, d, d).data
        const amt = 0.35 * o.strength * a * o.opacity
        for (let yy = 0; yy < R.h; yy++) for (let xx = 0; xx < R.w; xx++) {
          const sx = xx + R.x - left, sy = yy + R.y - top
          if (sx < 0 || sy < 0 || sx >= d || sy >= d) continue
          const k = md[(sy * d + sx) * 4 + 3] / 255 * amt
          if (!k) continue
          const j = (yy * R.w + xx) * 4
          for (let ch = 0; ch < 3; ch++) orig.data[j + ch] = orig.data[j + ch] + (orig.data[j + ch] - bl.data[j + ch]) * k * 3
        }
        putData(this.target, orig, R.x, R.y)
        break
      }
      case 'smudge': {
        if (!this.carry || this.carry.width !== d) { this.carry = canvas(d, d); ctx2d(this.carry).drawImage(this.target, left, top, d, d, 0, 0, d, d) }
        const c = dabTmp(1, d), cx = ctx2d(c)
        cx.drawImage(this.carry, 0, 0)
        cx.globalCompositeOperation = 'destination-in'
        cx.drawImage(m, 0, 0)
        tx.globalAlpha = Math.min(1, o.strength * a)
        if (this.layer.alphaLock) tx.globalCompositeOperation = 'source-atop'
        tx.drawImage(c, 0, 0, d, d, left, top, d, d)
        tx.globalAlpha = 1
        tx.globalCompositeOperation = 'source-over'
        const kx = ctx2d(this.carry)
        kx.globalAlpha = 1 - o.strength * 0.9
        kx.drawImage(this.target, left, top, d, d, 0, 0, d, d)
        kx.globalAlpha = 1
        break
      }
    }
    tx.restore()
    this.rect = rectUnion(this.rect, dr)
    if (this.mode.startsWith('mask')) touchMask(this.layer, dr)
    else if (!this.mode.startsWith('sel')) touch(this.layer, dr)
    doc.emit(this.mode.startsWith('sel') ? 'selection-live' : 'change', dr)
  }

  end() {
    const r = this.rect
    if (!r) return
    if (this.buf) {
      const x = ctx2d(this.target)
      x.save()
      x.globalAlpha = this.o.opacity
      x.globalCompositeOperation = this.mode === 'erase' ? 'destination-out' : this.layer.alphaLock ? 'source-atop' : 'source-over'
      x.drawImage(this.buf, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
      x.restore()
      ctx2d(this.buf).clearRect(r.x, r.y, r.w, r.h)
      touch(this.layer, r)
    }
    const which = this.mode.startsWith('mask') ? 'mask' : this.mode.startsWith('sel') ? 'selection' : 'canvas'
    this.hist.raster(this.label, this.layer, which, r, getData(this.before, r))
    this.doc.modified = true
    if (which === 'selection') this.doc.emit('selection')
    this.doc.emit('change', r)
  }
}
