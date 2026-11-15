export type Rect = { x: number; y: number; w: number; h: number }

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext('2d', { willReadFrequently: false })!
}

export function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = canvas(src.width, src.height)
  ctx2d(c).drawImage(src, 0, 0)
  return c
}

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b
  if (!b) return a
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

export function rectClip(r: Rect, w: number, h: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y))
  const x2 = Math.min(w, Math.ceil(r.x + r.w)), y2 = Math.min(h, Math.ceil(r.y + r.h))
  if (x2 <= x || y2 <= y) return null
  return { x, y, w: x2 - x, h: y2 - y }
}

export function rectPad(r: Rect, p: number): Rect {
  return { x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 }
}

export function getData(c: HTMLCanvasElement, r?: Rect): ImageData {
  const x = r ? r.x : 0, y = r ? r.y : 0
  return c.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, r ? r.w : c.width, r ? r.h : c.height)
}

export function putData(c: HTMLCanvasElement, d: ImageData, x = 0, y = 0) {
  ctx2d(c).putImageData(d, x, y)
}

export function alphaOf(c: HTMLCanvasElement): Uint8Array {
  const d = getData(c).data
  const a = new Uint8Array(c.width * c.height)
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3]
  return a
}

export function canvasFromAlpha(a: Uint8Array | Uint8ClampedArray, w: number, h: number): HTMLCanvasElement {
  const c = canvas(w, h)
  const d = new ImageData(w, h)
  for (let i = 0; i < a.length; i++) {
    const j = i * 4
    d.data[j] = d.data[j + 1] = d.data[j + 2] = 255
    d.data[j + 3] = a[i]
  }
  putData(c, d)
  return c
}

export function bboxOfAlpha(a: Uint8Array, w: number, h: number): Rect | null {
  let x1 = w, y1 = h, x2 = -1, y2 = -1
  for (let y = 0; y < h; y++) {
    const o = y * w
    for (let x = 0; x < w; x++) if (a[o + x] > 8) {
      if (x < x1) x1 = x
      if (x > x2) x2 = x
      if (y < y1) y1 = y
      y2 = y
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 }
}

export function scaled(src: CanvasImageSource, sw: number, sh: number, w: number, h: number): HTMLCanvasElement {
  const c = canvas(w, h)
  const x = ctx2d(c)
  x.imageSmoothingQuality = 'high'
  let cur: CanvasImageSource = src, cw = sw, ch = sh
  while (cw / 2 > w && ch / 2 > h) {
    const t = canvas(Math.ceil(cw / 2), Math.ceil(ch / 2))
    const tx = ctx2d(t)
    tx.imageSmoothingQuality = 'high'
    tx.drawImage(cur, 0, 0, t.width, t.height)
    cur = t; cw = t.width; ch = t.height
  }
  x.drawImage(cur, 0, 0, w, h)
  return c
}

export function fitSize(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), s }
}

type Fn = (...a: any[]) => void
export class Emitter {
  private m = new Map<string, Set<Fn>>()
  on(e: string, f: Fn) { if (!this.m.has(e)) this.m.set(e, new Set()); this.m.get(e)!.add(f); return () => this.m.get(e)!.delete(f) }
  emit(e: string, ...a: any[]) { this.m.get(e)?.forEach(f => f(...a)) }
}

export const hex2rgb = (h: string) => {
  let s = h.replace('#', '')
  if (s.length === 3) s = s.split('').map(c => c + c).join('')
  const n = parseInt(s.slice(0, 6), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
export const rgb2hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')
export const rgba = (hex: string, a: number) => { const [r, g, b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})` }

export function mkID(a: any, w: number, h: number): ImageData {
  const u = a instanceof ArrayBuffer ? new Uint8ClampedArray(a, 0, w * h * 4) : new Uint8ClampedArray(a.buffer, a.byteOffset, w * h * 4)
  return new ImageData(u as any, w, h)
}
