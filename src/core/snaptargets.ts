import type { Doc, Layer } from './doc'
import { shownVisible } from './doc'
import { layerFull } from './compose'
import { flatBounds } from './shapes'
import { canvas, ctx2d, getData, type Rect } from './util'
import type { Guides, SnapTargets } from './snap'

const cache = new WeakMap<HTMLCanvasElement, { key: string; box: Rect | null }>()

/**
 * The box around a canvas's visible pixels. Found on a small copy first, then each edge is settled at
 * full resolution in a narrow strip, so it is exact without reading the whole image.
 */
export function alphaBox(c: HTMLCanvasElement, key = ''): Rect | null {
  const hit = cache.get(c)
  if (hit && key && hit.key === key) return hit.box
  const W = c.width, H = c.height
  const s = Math.min(1, 512 / Math.max(W, H))
  const w = Math.max(1, Math.ceil(W * s)), hh = Math.max(1, Math.ceil(H * s))
  const t = canvas(w, hh), tx = ctx2d(t)
  tx.drawImage(c, 0, 0, w, hh)
  const d = getData(t).data
  let x0 = w, y0 = hh, x1 = -1, y1 = -1
  for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y }
  let box: Rect | null = null
  if (x1 >= 0) {
    const k = 1 / s, m = Math.ceil(k) + 1
    let L = Math.max(0, Math.floor(x0 * k) - m), R = Math.min(W - 1, Math.ceil((x1 + 1) * k) + m)
    let T = Math.max(0, Math.floor(y0 * k) - m), B = Math.min(H - 1, Math.ceil((y1 + 1) * k) + m)
    if (s < 1) {
      const col = (x0: number, x1: number, dir: 1 | -1) => {
        const a = Math.max(0, Math.min(x0, x1)), b = Math.min(W - 1, Math.max(x0, x1))
        const dd = getData(c, { x: a, y: T, w: b - a + 1, h: B - T + 1 }).data, ww = b - a + 1
        for (let i = 0; i < ww; i++) { const x = dir > 0 ? i : ww - 1 - i; for (let y = 0; y <= B - T; y++) if (dd[(y * ww + x) * 4 + 3] > 8) return a + x }
        return dir > 0 ? b : a
      }
      const row = (y0: number, y1: number, dir: 1 | -1) => {
        const a = Math.max(0, Math.min(y0, y1)), b = Math.min(H - 1, Math.max(y0, y1))
        const dd = getData(c, { x: L, y: a, w: R - L + 1, h: b - a + 1 }).data, ww = R - L + 1
        for (let i = 0; i <= b - a; i++) { const y = dir > 0 ? i : b - a - i; for (let x = 0; x < ww; x++) if (dd[(y * ww + x) * 4 + 3] > 8) return a + y }
        return dir > 0 ? b : a
      }
      const nl = col(L, L + 2 * m, 1), nr = col(R - 2 * m, R, -1)
      L = nl; R = nr
      const nt = row(T, T + 2 * m, 1), nb = row(B - 2 * m, B, -1)
      T = nt; B = nb
    }
    if (R >= L && B >= T) box = { x: L, y: T, w: R - L + 1, h: B - T + 1 }
  }
  if (key) cache.set(c, { key, box })
  return box
}

/** The box a layer covers in the image (shapes by their outline, pixels by what is visible). */
export function layerBox(doc: Doc, l: Layer): Rect | null {
  if (l.shape) return flatBounds(l.shape)
  if (l.kind === 'group' || l.kind === 'adjust' || l.kind === 'background') return null
  const img = layerFull(doc, l)
  return img ? alphaBox(img, doc.rev + ':' + l.id) : null
}

/** Where moving things may snap: the image edges and centre, guides, and the edges and centres of other visible layers. */
export function snapTargets(doc: Doc, guides: Guides | null, skip: Set<Layer>): SnapTargets {
  const x = [0, doc.w / 2, doc.w], y = [0, doc.h / 2, doc.h]
  if (guides) { x.push(...guides.x); y.push(...guides.y) }
  let n = 0
  for (const l of [...doc.layers].reverse()) {
    if (skip.has(l) || !shownVisible(doc, l) || l.kind === 'group' || l.kind === 'adjust' || l.kind === 'background') continue
    // Enough for everyday layouts without slowing the start of a drag on big documents.
    if (++n > 24) break
    const b = layerBox(doc, l)
    if (!b || (b.x <= 0 && b.y <= 0 && b.w >= doc.w && b.h >= doc.h)) continue
    x.push(b.x, b.x + b.w / 2, b.x + b.w)
    y.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  return { x, y }
}

