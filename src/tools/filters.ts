import type { App } from '../app'
import type { Tool } from './types'
import type { Layer } from '../core/doc'
import { touch } from '../core/compose'
import { canvas, copyCanvas, ctx2d, getData, putData } from '../core/util'
import { h, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider, toggle } from '../ui/controls'
import { tr } from '../i18n'
import { rng } from '../core/px'

interface Param { key: string; label: string; min: number; max: number; def: number; step?: number; unit?: string; bool?: boolean; choice?: string[] }
export interface FilterDef { id: string; label: string; cat: string; hint: string; params: Param[]; run: (src: HTMLCanvasElement, p: Record<string, number>) => HTMLCanvasElement }

// ---------- helpers ----------

/** src with its edge pixels repeated outward by pad, so blurs don't fade at the image border. */
function padded(src: HTMLCanvasElement, pad: number) {
  const w = src.width, hh = src.height
  const c = canvas(w + pad * 2, hh + pad * 2)
  const x = ctx2d(c)
  x.imageSmoothingEnabled = false
  x.drawImage(src, pad, pad)
  if (pad > 0) {
    x.drawImage(src, 0, 0, w, 1, pad, 0, w, pad)
    x.drawImage(src, 0, hh - 1, w, 1, pad, hh + pad, w, pad)
    x.drawImage(src, 0, 0, 1, hh, 0, pad, pad, hh)
    x.drawImage(src, w - 1, 0, 1, hh, w + pad, pad, pad, hh)
    x.drawImage(src, 0, 0, 1, 1, 0, 0, pad, pad)
    x.drawImage(src, w - 1, 0, 1, 1, w + pad, 0, pad, pad)
    x.drawImage(src, 0, hh - 1, 1, 1, 0, hh + pad, pad, pad)
    x.drawImage(src, w - 1, hh - 1, 1, 1, w + pad, hh + pad, pad, pad)
  }
  return c
}
function unpad(c: HTMLCanvasElement, pad: number, w: number, hh: number) {
  const o = canvas(w, hh)
  ctx2d(o).drawImage(c, -pad, -pad)
  return o
}

export function gaussianBlur(src: HTMLCanvasElement, r: number) {
  if (r <= 0) return copyCanvas(src)
  const pad = Math.ceil(r * 3)
  const p = padded(src, pad)
  const o = canvas(p.width, p.height)
  const x = ctx2d(o)
  x.filter = `blur(${r}px)`
  x.drawImage(p, 0, 0)
  return unpad(o, pad, src.width, src.height)
}

/**
 * Averages copies of the image along a path by repeated halving: each step averages the image with
 * a shifted copy of itself, so n steps give 2^n evenly spaced samples. Averaging premultiplied
 * pixels with 'lighter' at half strength keeps transparency correct and rounding small.
 */
function averageSteps(src: HTMLCanvasElement, pad: number, steps: ((x: CanvasRenderingContext2D, img: HTMLCanvasElement, j: number) => void)[]) {
  let cur = padded(src, pad)
  for (let j = 0; j < steps.length; j++) {
    const n = canvas(cur.width, cur.height)
    const x = ctx2d(n)
    x.imageSmoothingQuality = 'high'
    x.globalAlpha = 0.5
    x.drawImage(cur, 0, 0)
    x.globalCompositeOperation = 'lighter'
    steps[j](x, cur, j)
    cur = n
  }
  return unpad(cur, pad, src.width, src.height)
}

/** Two half-length passes: the samples fade toward the ends, which looks like real motion rather than hard-edged copies. */
function motionBlur(src: HTMLCanvasElement, angle: number, dist: number) {
  if (dist < 4) return motionBox(src, angle, dist)
  return motionBox(motionBox(src, angle, dist / 2), angle, dist / 2)
}

function motionBox(src: HTMLCanvasElement, angle: number, dist: number) {
  if (dist < 1) return copyCanvas(src)
  const k = Math.max(1, Math.round(Math.log2(dist)))
  const a = (angle * Math.PI) / 180
  const dx = Math.cos(a), dy = -Math.sin(a)
  const unit = dist / 2 ** k
  const pad = Math.ceil(dist) + 2
  const steps = Array.from({ length: k }, (_, j) => (x: CanvasRenderingContext2D, img: HTMLCanvasElement) => {
    const s = unit * 2 ** j
    x.drawImage(img, dx * s, dy * s)
  })
  // The samples run from 0 to dist; shift back by half so the blur is centred.
  const out = averageSteps(src, pad, steps)
  const c = canvas(src.width, src.height)
  const x = ctx2d(c)
  x.drawImage(padded(out, pad), -pad - (dx * (dist - unit)) / 2, -pad - (dy * (dist - unit)) / 2)
  return c
}

function zoomBlur(src: HTMLCanvasElement, amount: number, cxp: number, cyp: number) {
  const half = (Math.sqrt(1 + amount / 100) - 1) * 100
  return zoomBox(zoomBox(src, half, cxp, cyp), half, cxp, cyp)
}

function zoomBox(src: HTMLCanvasElement, amount: number, cxp: number, cyp: number) {
  if (amount <= 0) return copyCanvas(src)
  const w = src.width, hh = src.height
  const cx = (w * cxp) / 100, cy = (hh * cyp) / 100
  const reach = Math.hypot(Math.max(cx, w - cx), Math.max(cy, hh - cy))
  const total = 1 + amount / 100
  const k = Math.max(1, Math.min(9, Math.round(Math.log2(reach * (total - 1)))))
  // Scaling up about the centre only samples inward, so a thin edge is enough.
  const pad = 2
  const steps = Array.from({ length: k }, (_, j) => (x: CanvasRenderingContext2D, img: HTMLCanvasElement) => {
    const g = total ** (2 ** j / 2 ** k)
    const pcx = cx + pad, pcy = cy + pad
    x.setTransform(g, 0, 0, g, pcx - pcx * g, pcy - pcy * g)
    x.drawImage(img, 0, 0)
    x.setTransform(1, 0, 0, 1, 0, 0)
  })
  return averageSteps(src, pad, steps)
}

/** Runs fn over every pixel's RGBA, keeping a copy of the source to read neighbours from. */
function perPixel(src: HTMLCanvasElement, fn: (s: Uint8ClampedArray, d: Uint8ClampedArray, w: number, h: number) => void) {
  const id = getData(src)
  const out = new ImageData(new Uint8ClampedArray(id.data), id.width, id.height)
  fn(id.data, out.data, id.width, id.height)
  const c = canvas(id.width, id.height)
  putData(c, out)
  return c
}

const lum = (d: Uint8ClampedArray, i: number) => d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114

function unsharp(src: HTMLCanvasElement, amount: number, radius: number, threshold: number) {
  const blur = getData(gaussianBlur(src, radius)).data
  const k = amount / 100
  return perPixel(src, (s, d) => {
    for (let i = 0; i < s.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const diff = s[i + c] - blur[i + c]
        if (Math.abs(diff) * 2 < threshold) continue
        d[i + c] = s[i + c] + diff * k
      }
    }
  })
}

/**
 * Film-like grain. Size above 1 px makes softer, larger grain (the noise is made smaller and scaled up);
 * Gaussian noise looks like film, Uniform is harsher. The same seed always gives the same grain, so the
 * preview does not flicker while a slider moves and the result matches it.
 */
function addNoise(src: HTMLCanvasElement, amount: number, mono: boolean, size = 1, uniform = false, seed = 1) {
  const a = amount * 2.55
  const w = src.width, hh = src.height
  const r = rng(seed)
  const g = uniform ? () => (r() - 0.5) * 2 * 1.2 : () => (r() + r() + r() - 1.5) * 1.15
  const k = Math.max(1, size)
  const nw = Math.max(1, Math.round(w / k)), nh = Math.max(1, Math.round(hh / k))
  // Noise around mid grey, one value per channel (or one for all three when monochrome).
  const nd = new ImageData(nw, nh)
  for (let i = 0; i < nw * nh; i++) {
    const o = i * 4
    if (mono) { const n = 128 + g() * 60; nd.data[o] = nd.data[o + 1] = nd.data[o + 2] = n }
    else { nd.data[o] = 128 + g() * 60; nd.data[o + 1] = 128 + g() * 60; nd.data[o + 2] = 128 + g() * 60 }
    nd.data[o + 3] = 255
  }
  let field = canvas(nw, nh)
  putData(field, nd)
  if (nw !== w || nh !== hh) {
    const up = canvas(w, hh), ux = ctx2d(up)
    ux.imageSmoothingEnabled = true; ux.imageSmoothingQuality = 'high'
    ux.drawImage(field, 0, 0, w, hh)
    field = up
  }
  const N = getData(field).data
  // Scaling up softens the grain; make up for it so Amount means the same at every size.
  const gain = (a / 60) * (k > 1 ? Math.min(2.2, 1 + (k - 1) * 0.35) : 1)
  return perPixel(src, (s, d) => {
    for (let i = 0; i < s.length; i += 4) {
      d[i] = s[i] + (N[i] - 128) * gain; d[i + 1] = s[i + 1] + (N[i + 1] - 128) * gain; d[i + 2] = s[i + 2] + (N[i + 2] - 128) * gain
    }
  })
}

/** Bilinear read of one channel at a fractional position, clamped to the edge. */
function sample(s: Uint8ClampedArray, w: number, hh: number, x: number, y: number, c: number) {
  x = Math.min(w - 1, Math.max(0, x)); y = Math.min(hh - 1, Math.max(0, y))
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(hh - 1, y0 + 1)
  const fx = x - x0, fy = y - y0
  const a = s[(y0 * w + x0) * 4 + c], b = s[(y0 * w + x1) * 4 + c], cc = s[(y1 * w + x0) * 4 + c], d = s[(y1 * w + x1) * 4 + c]
  return (a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy
}

/** Colour fringes like a cheap lens: red and blue pulled apart, outward from the centre or along one direction. */
function chromatic(src: HTMLCanvasElement, amount: number, linear: boolean, angle: number) {
  if (!amount) return copyCanvas(src)
  return perPixel(src, (s, d, w, hh) => {
    const cx = w / 2, cy = hh / 2, R = Math.hypot(cx, cy)
    const a = (angle * Math.PI) / 180, ux = Math.cos(a) * amount, uy = -Math.sin(a) * amount
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      let rx: number, ry: number, bx: number, by: number
      if (linear) { rx = x - ux; ry = y - uy; bx = x + ux; by = y + uy }
      else {
        // Grows toward the edges, as real lenses do.
        const k = amount / R
        rx = cx + (x - cx) * (1 - k); ry = cy + (y - cy) * (1 - k)
        bx = cx + (x - cx) * (1 + k); by = cy + (y - cy) * (1 + k)
      }
      d[i] = sample(s, w, hh, rx, ry, 0)
      d[i + 2] = sample(s, w, hh, bx, by, 2)
      d[i + 3] = Math.max(s[i + 3], sample(s, w, hh, rx, ry, 3), sample(s, w, hh, bx, by, 3))
    }
  })
}

/** Barrel (positive) or pincushion (negative) distortion. Zoom to fill scales up so no empty edges show. */
function lensDistort(src: HTMLCanvasElement, amount: number, fill: boolean) {
  if (!amount) return copyCanvas(src)
  const k = -amount / 100 * 0.5
  const map = (r: number) => r * (1 + k * r * r)
  // Find the zoom that keeps the edges covered: the widest of the corners and edge midpoints.
  let z = 1
  if (fill) { const m = Math.min(map(1) / 1, map(Math.SQRT2) / Math.SQRT2); z = m < 1 ? m : 1 }
  return perPixel(src, (s, d, w, hh) => {
    const cx = w / 2, cy = hh / 2, n = Math.min(cx, cy)
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const dx = (x + 0.5 - cx) / n, dy = (y + 0.5 - cy) / n
      const r = Math.hypot(dx, dy) * z
      const f = r ? map(r) / r * z : z
      const sx = cx + dx * f * n - 0.5, sy = cy + dy * f * n - 0.5
      if (sx < -0.5 || sy < -0.5 || sx > w - 0.5 || sy > hh - 0.5) { d[i + 3] = 0; continue }
      for (let c = 0; c < 4; c++) d[i + c] = sample(s, w, hh, sx, sy, c)
    }
  })
}

/** Printed-dot look: dots on a turned grid, bigger where the image is darker. Colour uses cyan, magenta and yellow screens. */
function halftone(src: HTMLCanvasElement, cell: number, angle: number, color: boolean) {
  const w = src.width, hh = src.height
  cell = Math.max(3, cell)
  const soft = gaussianBlur(src, cell / 3)
  const sd = getData(soft).data
  const o = canvas(w, hh)
  const x = ctx2d(o)
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh)
  const screens: [number, string, (i: number) => number][] = color
    ? [[angle + 15, 'rgb(0,174,239)', i => 1 - sd[i] / 255], [angle + 75, 'rgb(236,0,140)', i => 1 - sd[i + 1] / 255], [angle, 'rgb(255,242,0)', i => 1 - sd[i + 2] / 255]]
    : [[angle + 45, '#000', i => 1 - (sd[i] * 0.299 + sd[i + 1] * 0.587 + sd[i + 2] * 0.114) / 255]]
  x.globalCompositeOperation = 'multiply'
  const diag = Math.hypot(w, hh)
  for (const [deg, col, dark] of screens) {
    const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a)
    x.fillStyle = col
    x.beginPath()
    for (let v = -diag / 2; v < diag / 2; v += cell) for (let u = -diag / 2; u < diag / 2; u += cell) {
      const px = w / 2 + u * ca - v * sa, py = hh / 2 + u * sa + v * ca
      if (px < -cell || py < -cell || px > w + cell || py > hh + cell) continue
      const i = (Math.min(hh - 1, Math.max(0, Math.round(py))) * w + Math.min(w - 1, Math.max(0, Math.round(px)))) * 4
      // Dot area follows darkness, so the radius follows its square root.
      const r = Math.sqrt(Math.max(0, dark(i))) * cell * 0.6
      if (r < 0.3) continue
      x.moveTo(px + r, py); x.arc(px, py, r, 0, Math.PI * 2)
    }
    x.fill()
  }
  x.globalCompositeOperation = 'destination-in'
  x.drawImage(src, 0, 0)
  return o
}

export function pixelate(src: HTMLCanvasElement, cell: number) {
  const w = src.width, hh = src.height
  if (cell < 2) return copyCanvas(src)
  const sw = Math.max(1, Math.round(w / cell)), sh = Math.max(1, Math.round(hh / cell))
  // Halve step by step so each block is the average of its pixels, not a sample of a few.
  let cur: HTMLCanvasElement = src
  while (cur.width / 2 >= sw && cur.height / 2 >= sh) {
    const n = canvas(Math.max(sw, Math.round(cur.width / 2)), Math.max(sh, Math.round(cur.height / 2)))
    const x = ctx2d(n); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, n.width, n.height); cur = n
  }
  const small = canvas(sw, sh)
  const sx = ctx2d(small); sx.imageSmoothingQuality = 'high'; sx.drawImage(cur, 0, 0, sw, sh)
  const o = canvas(w, hh)
  const x = ctx2d(o)
  x.imageSmoothingEnabled = false
  x.drawImage(small, 0, 0, sw * cell, sh * cell)
  if (sw * cell < w || sh * cell < hh) x.drawImage(small, 0, 0, sw, sh, 0, 0, w, hh)
  return o
}

function posterize(src: HTMLCanvasElement, levels: number) {
  const n = Math.max(2, Math.round(levels)) - 1
  const lut = new Uint8ClampedArray(256)
  for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.round((v / 255) * n) / n * 255)
  return perPixel(src, (s, d) => { for (let i = 0; i < s.length; i += 4) { d[i] = lut[s[i]]; d[i + 1] = lut[s[i + 1]]; d[i + 2] = lut[s[i + 2]] } })
}

function emboss(src: HTMLCanvasElement, angle: number, height: number, amount: number) {
  const a = (angle * Math.PI) / 180
  const ox = Math.round(Math.cos(a) * height), oy = Math.round(-Math.sin(a) * height)
  const k = amount / 100
  return perPixel(src, (s, d, w, hh) => {
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const x1 = Math.min(w - 1, Math.max(0, x + ox)), y1 = Math.min(hh - 1, Math.max(0, y + oy))
      const x0 = Math.min(w - 1, Math.max(0, x - ox)), y0 = Math.min(hh - 1, Math.max(0, y - oy))
      const v = 128 + (lum(s, (y1 * w + x1) * 4) - lum(s, (y0 * w + x0) * 4)) * k
      d[i] = d[i + 1] = d[i + 2] = v
    }
  })
}

function findEdges(src: HTMLCanvasElement, strength: number) {
  const k = strength / 100
  return perPixel(src, (s, d, w, hh) => {
    const L = new Float32Array(w * hh)
    for (let i = 0; i < w * hh; i++) L[i] = lum(s, i * 4)
    const at = (x: number, y: number) => L[Math.min(hh - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))]
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1)
      const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1)
      const i = (y * w + x) * 4
      d[i] = d[i + 1] = d[i + 2] = 255 - Math.hypot(gx, gy) * k
    }
  })
}

function vignette(src: HTMLCanvasElement, amount: number, size: number, soft: number) {
  const w = src.width, hh = src.height
  const o = copyCanvas(src)
  const x = ctx2d(o)
  const r = Math.hypot(w, hh) / 2
  const inner = r * (size / 100) * (1 - soft / 100 * 0.9)
  const outer = Math.max(inner + 1, r * (0.35 + size / 100 * 0.75))
  const g = x.createRadialGradient(w / 2, hh / 2, inner, w / 2, hh / 2, outer)
  const c = amount >= 0 ? '0,0,0' : '255,255,255'
  g.addColorStop(0, `rgba(${c},0)`)
  g.addColorStop(1, `rgba(${c},${Math.abs(amount) / 100})`)
  x.globalCompositeOperation = 'source-atop'
  x.fillStyle = g
  x.fillRect(0, 0, w, hh)
  return o
}

export const FILTERS: FilterDef[] = [
  { id: 'gaussian', label: tr('Gaussian blur'), cat: 'blur', hint: tr('Softens the whole layer evenly.'), params: [{ key: 'r', label: tr('Radius'), min: 0.5, max: 250, def: 4, step: 0.5, unit: 'px' }], run: (s, p) => gaussianBlur(s, p.r) },
  { id: 'motion', label: tr('Motion blur'), cat: 'blur', hint: tr('Blurs in one direction, like a moving camera.'), params: [{ key: 'a', label: tr('Angle'), min: -180, max: 180, def: 0, unit: '°' }, { key: 'd', label: tr('Distance'), min: 1, max: 500, def: 20, unit: 'px' }], run: (s, p) => motionBlur(s, p.a, p.d) },
  { id: 'zoom', label: tr('Zoom blur'), cat: 'blur', hint: tr('Streaks outward from a centre point, like zooming during the exposure.'), params: [{ key: 'a', label: tr('Amount'), min: 1, max: 100, def: 15, unit: '%' }, { key: 'x', label: tr('Centre across'), min: 0, max: 100, def: 50, unit: '%' }, { key: 'y', label: tr('Centre down'), min: 0, max: 100, def: 50, unit: '%' }], run: (s, p) => zoomBlur(s, p.a, p.x, p.y) },
  { id: 'unsharp', label: tr('Unsharp mask'), cat: 'sharpen', hint: tr('Sharpens by boosting contrast along edges. Threshold leaves smooth areas alone.'), params: [{ key: 'a', label: tr('Amount'), min: 1, max: 500, def: 80, unit: '%' }, { key: 'r', label: tr('Radius'), min: 0.5, max: 50, def: 2, step: 0.5, unit: 'px' }, { key: 't', label: tr('Threshold'), min: 0, max: 255, def: 0 }], run: (s, p) => unsharp(s, p.a, p.r, p.t) },
  { id: 'noise', label: tr('Add noise'), cat: 'noise', hint: tr('Adds film-like grain. Larger grain looks softer, like fast film.'), params: [{ key: 'a', label: tr('Amount'), min: 1, max: 100, def: 10, unit: '%' }, { key: 'z', label: tr('Grain size'), min: 1, max: 10, def: 1, step: 0.5, unit: 'px' }, { key: 'u', label: tr('Distribution'), min: 0, max: 1, def: 0, choice: [tr('Gaussian'), tr('Uniform')] }, { key: 'm', label: tr('Monochrome'), min: 0, max: 1, def: 1, bool: true }], run: (s, p) => addNoise(s, p.a, !!p.m, p.z ?? 1, !!p.u, p.seed ?? 1) },
  { id: 'chroma', label: tr('Chromatic aberration'), cat: 'lens', hint: tr('Splits red and blue apart at the edges, like a simple lens.'), params: [{ key: 'a', label: tr('Amount'), min: -40, max: 40, def: 6, step: 0.5, unit: 'px' }, { key: 'l', label: tr('Direction'), min: 0, max: 1, def: 0, choice: [tr('Radial'), tr('Linear')] }, { key: 'g', label: tr('Angle'), min: -180, max: 180, def: 0, unit: '°' }], run: (s, p) => chromatic(s, p.a, !!p.l, p.g) },
  { id: 'lens', label: tr('Lens distortion'), cat: 'lens', hint: tr('Bulges the image outward (barrel) or pinches it inward (pincushion). Also corrects those from a wide lens.'), params: [{ key: 'a', label: tr('Amount'), min: -100, max: 100, def: 25 }, { key: 'f', label: tr('Zoom to fill'), min: 0, max: 1, def: 1, bool: true }], run: (s, p) => lensDistort(s, p.a, !!p.f) },
  { id: 'pixelate', label: tr('Pixelate'), cat: 'stylize', hint: tr('Turns the layer into large square blocks. Good for hiding faces or details.'), params: [{ key: 'c', label: tr('Block size'), min: 2, max: 200, def: 16, unit: 'px' }], run: (s, p) => pixelate(s, p.c) },
  { id: 'posterize', label: tr('Posterize'), cat: 'stylize', hint: tr('Reduces each colour channel to a few levels, for a flat poster look.'), params: [{ key: 'l', label: tr('Levels'), min: 2, max: 32, def: 5 }], run: (s, p) => posterize(s, p.l) },
  { id: 'emboss', label: tr('Emboss'), cat: 'stylize', hint: tr('Makes the layer look raised or stamped into grey metal.'), params: [{ key: 'a', label: tr('Angle'), min: -180, max: 180, def: 135, unit: '°' }, { key: 'h', label: tr('Height'), min: 1, max: 10, def: 2, unit: 'px' }, { key: 'k', label: tr('Amount'), min: 10, max: 500, def: 100, unit: '%' }], run: (s, p) => emboss(s, p.a, p.h, p.k) },
  { id: 'edges', label: tr('Find edges'), cat: 'stylize', hint: tr('Draws the outlines of shapes as dark lines on white.'), params: [{ key: 's', label: tr('Strength'), min: 10, max: 300, def: 100, unit: '%' }], run: (s, p) => findEdges(s, p.s) },
  { id: 'halftone', label: tr('Halftone'), cat: 'stylize', hint: tr('Turns the layer into printed dots, like a newspaper or comic.'), params: [{ key: 'c', label: tr('Dot size'), min: 3, max: 80, def: 10, unit: 'px' }, { key: 'g', label: tr('Angle'), min: 0, max: 90, def: 0, unit: '°' }, { key: 'k', label: tr('Colour'), min: 0, max: 1, def: 0, bool: true }], run: (s, p) => halftone(s, p.c, p.g, !!p.k) },
  { id: 'vignette', label: tr('Vignette'), cat: 'stylize', hint: tr('Darkens the corners to draw the eye to the centre. Negative amounts lighten them.'), params: [{ key: 'a', label: tr('Amount'), min: -100, max: 100, def: 50 }, { key: 's', label: tr('Size'), min: 0, max: 100, def: 50 }, { key: 'f', label: tr('Softness'), min: 0, max: 100, def: 60 }], run: (s, p) => vignette(s, p.a, p.s, p.f) }
]

const defaults = (f: FilterDef): Record<string, number> => ({ ...Object.fromEntries(f.params.map(p => [p.key, p.def])), fade: 100 })
const newSeed = () => (Math.random() * 2 ** 31) >>> 0
const remembered = new Map<string, Record<string, number>>()
let current = FILTERS[0].id
let last: string | null = null

/**
 * Shows a filter in the side panel with a live preview. With no id, applies the last filter again
 * with the same settings straight away.
 */
export function openFilter(app: App, id?: string) {
  if (!id) {
    if (!last) { toast(tr('No filter used yet. Pick one from the Filter menu.')); return }
    applyNow(app, last)
    return
  }
  current = id
  if (app.toolId === 'filter') app.emit('filter-change')
  else app.setTool('filter')
}

/** Filters the layer, mixing by the selection and keeping its transparency if that is locked. */
function result(app: App, l: Layer, base: HTMLCanvasElement, f: FilterDef, p: Record<string, number>) {
  const doc = app.doc!
  let out = f.run(base, p)
  const fade = p.fade ?? 100
  if (fade < 100) {
    // Fade: every pixel part way from the original to the filtered one.
    const k = Math.max(0, fade) / 100
    const a = getData(base).data, d = getData(out)
    for (let i = 0; i < a.length; i++) d.data[i] = a[i] + (d.data[i] - a[i]) * k
    out = canvas(base.width, base.height)
    putData(out, d)
  }
  if (l.alphaLock) {
    const a = getData(base).data, d = getData(out)
    for (let i = 3; i < a.length; i += 4) d.data[i] = a[i]
    putData(out, d)
  }
  if (doc.selection) {
    const mixed = canvas(base.width, base.height)
    const x = ctx2d(mixed)
    x.drawImage(base, 0, 0)
    x.globalCompositeOperation = 'destination-out'
    x.drawImage(doc.selection, 0, 0)
    const t = copyCanvas(out)
    const tx = ctx2d(t)
    tx.globalCompositeOperation = 'destination-in'
    tx.drawImage(doc.selection, 0, 0)
    x.globalCompositeOperation = 'lighter'
    x.drawImage(t, 0, 0)
    out = mixed
  }
  return out
}

function applyNow(app: App, id: string) {
  const f = FILTERS.find(x => x.id === id)!
  runFilter(app, id, { ...(remembered.get(id) || defaults(f)), seed: newSeed() })
}

/** Applies a filter to the selected layer straight away, as one undo step (Repeat last filter, and actions). */
export function runFilter(app: App, id: string, p: Record<string, number>) {
  const f = FILTERS.find(x => x.id === id)
  if (!f) return
  const l = app.activeRaster()
  if (!l || !l.canvas) return
  const before = getData(l.canvas)
  const q = { ...defaults(f), ...p }
  if (q.seed === undefined) q.seed = newSeed()
  app.record({ kind: 'filter', id, p: { ...q, seed: undefined as any } })
  const out = result(app, l, copyCanvas(l.canvas), f, q)
  const x = ctx2d(l.canvas)
  x.clearRect(0, 0, l.canvas.width, l.canvas.height)
  x.drawImage(out, 0, 0)
  touch(l)
  app.hist!.raster(f.label, l, 'canvas', { x: 0, y: 0, w: before.width, h: before.height }, before)
  app.doc!.changed()
}

export function filterTool(app: App): Tool {
  let target: Layer | null = null
  let base: HTMLCanvasElement | null = null
  let raf = 0
  let preview = true
  // One seed per filter session: the preview keeps the same grain while sliders move, and Apply keeps it too.
  let seed = newSeed()
  const params = () => { const f = FILTERS.find(x => x.id === current)!; if (!remembered.has(f.id)) remembered.set(f.id, defaults(f)); const p = remembered.get(f.id)!; p.fade ??= 100; return { ...p, seed } }
  const store = () => { const f = FILTERS.find(x => x.id === current)!; if (!remembered.has(f.id)) remembered.set(f.id, defaults(f)); return remembered.get(f.id)! }
  const put = (src: HTMLCanvasElement) => {
    if (!target) return
    const x = ctx2d(target.canvas!)
    x.clearRect(0, 0, src.width, src.height)
    x.drawImage(src, 0, 0)
    touch(target)
    app.doc?.changed()
  }
  const render = () => {
    raf = 0
    if (!target || !base) return
    const f = FILTERS.find(x => x.id === current)!
    put(preview ? result(app, target, base, f, params()) : base)
  }
  const clear = () => { clearTimeout(pause); target = null; base = null; if (app.hist?.pending === commit) app.hist.pending = null }
  function commit() {
    if (!target || !base || !app.hist) return clear()
    // Apply what the sliders say now, even if the preview hasn't caught up yet.
    if (raf || pause) { cancelAnimationFrame(raf); clearTimeout(pause); pause = 0; raf = 0; if (preview) render() }
    if (!preview) { preview = true; render() }
    const l = target, b = getData(base)
    const f = FILTERS.find(x => x.id === current)!
    const used = params()
    clear()
    last = f.id
    seed = newSeed()
    app.record({ kind: 'filter', id: f.id, p: { ...used, seed: undefined as any } })
    app.hist.raster(f.label, l, 'canvas', { x: 0, y: 0, w: b.width, h: b.height }, b)
    app.doc?.changed()
  }
  const cancel = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (target && base) put(base)
    clear()
  }
  const start = () => {
    const l = app.doc?.active
    if (target && target !== l) commit()
    if (target) return true
    const r = app.activeRaster()
    if (!r || !r.canvas) return false
    target = r
    base = copyCanvas(r.canvas)
    app.hist!.pending = commit
    return true
  }
  // Big images: wait for a short pause in slider movement before redrawing the preview, so dragging stays smooth.
  let pause = 0
  const changed = () => {
    if (!start()) return
    const big = (app.doc?.w || 0) * (app.doc?.h || 0) > 6e6
    if (big) { clearTimeout(pause); pause = window.setTimeout(() => { pause = 0; if (!raf) raf = requestAnimationFrame(render) }, 140) }
    else if (!raf) raf = requestAnimationFrame(render)
  }
  app.on('filter-change', () => { if (target && base) { put(base) } changed(); app.emit('panel') })
  return {
    id: 'filter', label: tr('Filter'), icon: 'filter',
    activate() { preview = true; changed() },
    deactivate() { commit() },
    panel() {
      const f = FILTERS.find(x => x.id === current)!
      const l = app.doc?.active
      const ok = !!l && !!l.canvas && ['image', 'paint', 'highlight'].includes(l.kind)
      if (!ok) return h('div', { class: 'ib' }, sec(f.label), hint(tr('Select an image or paint layer to use a filter on it.')))
      if (target && l !== target) { commit(); changed() }
      const p = store()
      return h('div', { class: 'ib' },
        sec(f.label + ': ' + l!.name),
        hint(f.hint + (app.doc!.selection ? tr(' Only the selected area changes.') : '')),
        h('div', { class: 'fr' }, h('label', tr('Filter')), h('div', { class: 'grow' }, h('select', { onchange: (e: Event) => openFilter(app, (e.target as HTMLSelectElement).value) },
          FILTERS.map(x => h('option', { value: x.id, selected: x.id === f.id }, x.label))))),
        ...f.params.map(q => q.bool
          ? toggle(q.label, () => !!p[q.key], v => { p[q.key] = v ? 1 : 0; changed() })
          : q.choice
            ? seg(q.choice.map((c, i) => [String(i), c] as [string, string]), () => String(p[q.key] ?? q.def), v => { p[q.key] = +v; changed() }, q.label)
            : slider(q.label, () => p[q.key], v => { p[q.key] = v; changed() }, { min: q.min, max: q.max, step: q.step, unit: q.unit, def: q.def })),
        slider(tr('Fade'), () => p.fade ?? 100, v => { p.fade = v; changed() }, { min: 0, max: 100, def: 100, unit: '%' }),
        toggle(tr('Preview'), () => preview, v => { preview = v; changed() }),
        h('div', { class: 'g2' },
          btn(tr('Reset'), () => { remembered.set(f.id, defaults(f)); changed(); app.emit('panel') }),
          f.id === 'noise' ? btn(tr('New grain'), () => { seed = newSeed(); changed() }) : h('span')),
        h('div', { class: 'g2' },
          h('button', { onclick: () => { cancel(); app.setTool('move') } }, tr('Cancel')),
          h('button', { class: 'pri', onclick: () => { commit(); app.setTool('move'); toast(tr('{0} applied', f.label)) } }, tr('Apply'))))
    }
  }
}
