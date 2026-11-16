import type { Effects } from './doc'
import { distanceTo } from './px'
import { alphaOf, bboxOfAlpha, canvas, ctx2d, hex2rgb, putData, Rect, rectClip, rectPad } from './util'

/** How far the effects can reach beyond the layer's pixels. */
export function fxReach(f: Effects) {
  let p = 0
  if (f.shadow.on) p = Math.max(p, f.shadow.distance + f.shadow.size * 1.5)
  if (f.glow.on) p = Math.max(p, f.glow.size)
  if (f.stroke.on) p = Math.max(p, f.stroke.size)
  return Math.ceil(p + 2)
}

const offsetOf = (angle: number, dist: number) => {
  const a = (angle * Math.PI) / 180
  return { dx: -Math.cos(a) * dist, dy: Math.sin(a) * dist }
}

let scratchA: HTMLCanvasElement | null = null
let scratchB: HTMLCanvasElement | null = null
function scratch(which: 'a' | 'b', w: number, h: number) {
  let c = which === 'a' ? scratchA : scratchB
  if (!c || c.width !== w || c.height !== h) { c = canvas(w, h); if (which === 'a') scratchA = c; else scratchB = c }
  const x = ctx2d(c)
  x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'
  x.clearRect(0, 0, w, h)
  return c
}

/** The layer's pixels tinted with one colour, keeping their transparency. */
function silhouette(src: HTMLCanvasElement, color: string) {
  const t = scratch('a', src.width, src.height)
  const x = ctx2d(t)
  x.drawImage(src, 0, 0)
  x.globalCompositeOperation = 'source-in'
  x.fillStyle = color
  x.fillRect(0, 0, t.width, t.height)
  return t
}

/** Draws a coverage map (0..1 per pixel of r) in one colour. */
function paintCoverage(x: CanvasRenderingContext2D, r: Rect, cov: Float32Array, color: string, opacity: number) {
  const [cr, cg, cb] = hex2rgb(color)
  const d = new ImageData(r.w, r.h)
  for (let i = 0; i < cov.length; i++) {
    const a = cov[i]
    if (a <= 0) continue
    const o = i * 4
    d.data[o] = cr; d.data[o + 1] = cg; d.data[o + 2] = cb; d.data[o + 3] = Math.min(255, a * 255 + 0.5)
  }
  const t = scratch('b', x.canvas.width, x.canvas.height)
  putData(t, d, r.x, r.y)
  x.save(); x.globalAlpha = opacity; x.drawImage(t, 0, 0); x.restore()
}

/**
 * Renders src with its effects into out (same size). Order, bottom to top: drop shadow, outer glow,
 * outside stroke, the layer (with colour overlay), inner shadow, inside or centre stroke.
 */
export function renderFx(src: HTMLCanvasElement, f: Effects, out: HTMLCanvasElement) {
  const W = src.width, H = src.height
  const o = ctx2d(out)
  o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1; o.globalCompositeOperation = 'source-over'; o.filter = 'none'
  o.clearRect(0, 0, W, H)

  const needDist = f.glow.on || f.stroke.on
  let region: Rect | null = null
  let alpha: Uint8Array | null = null
  let dOut: Float32Array | null = null, dIn: Float32Array | null = null
  if (needDist) {
    const full = alphaOf(src)
    const bb = bboxOfAlpha(full, W, H)
    if (bb) {
      region = rectClip(rectPad(bb, fxReach(f) + 2), W, H)
      if (region) {
        const r = region
        alpha = new Uint8Array(r.w * r.h)
        for (let y = 0; y < r.h; y++) alpha.set(full.subarray((y + r.y) * W + r.x, (y + r.y) * W + r.x + r.w), y * r.w)
        const a = alpha
        dOut = distanceTo(i => a[i] >= 128, r.w, r.h)
        if (f.stroke.on && f.stroke.position !== 'outside') dIn = distanceTo(i => a[i] < 128, r.w, r.h)
      }
    }
  }

  if (f.shadow.on) {
    const { dx, dy } = offsetOf(f.shadow.angle, f.shadow.distance)
    const t = silhouette(src, f.shadow.color)
    o.save()
    o.globalAlpha = f.shadow.opacity
    if (f.shadow.size > 0) o.filter = `blur(${f.shadow.size / 2}px)`
    o.drawImage(t, dx, dy)
    o.restore()
  }

  if (f.glow.on && region && dOut && alpha) {
    const s = Math.max(1, f.glow.size)
    const cov = new Float32Array(dOut.length)
    for (let i = 0; i < cov.length; i++) {
      if (alpha[i] >= 255) continue
      const k = Math.max(0, 1 - dOut[i] / s)
      cov[i] = k * k
    }
    paintCoverage(o, region, cov, f.glow.color, f.glow.opacity)
  }

  const strokeCov = () => {
    const s = f.stroke.size, pos = f.stroke.position
    const cov = new Float32Array(dOut!.length)
    const half = pos === 'center' ? s / 2 : s
    for (let i = 0; i < cov.length; i++) {
      const inside = alpha![i] >= 128
      let c = 0
      if (!inside && pos !== 'inside') c = Math.min(1, Math.max(0, half + 0.5 - dOut![i]))
      else if (inside && pos !== 'outside') c = Math.min(1, Math.max(0, half + 0.5 - dIn![i]))
      cov[i] = c
    }
    return cov
  }

  if (f.stroke.on && f.stroke.size > 0 && region && f.stroke.position === 'outside') paintCoverage(o, region, strokeCov(), f.stroke.color, f.stroke.opacity)

  if (f.overlay.on) {
    const t = scratch('a', W, H)
    const x = ctx2d(t)
    x.drawImage(src, 0, 0)
    x.globalCompositeOperation = 'source-atop'
    x.globalAlpha = f.overlay.opacity
    x.fillStyle = f.overlay.color
    x.fillRect(0, 0, W, H)
    o.drawImage(t, 0, 0)
  } else o.drawImage(src, 0, 0)

  if (f.inner.on) {
    const { dx, dy } = offsetOf(f.inner.angle, f.inner.distance)
    const inv = scratch('b', W, H)
    const ix = ctx2d(inv)
    ix.fillStyle = f.inner.color
    ix.fillRect(0, 0, W, H)
    ix.globalCompositeOperation = 'destination-out'
    ix.drawImage(src, 0, 0)
    const t = scratch('a', W, H)
    const x = ctx2d(t)
    if (f.inner.size > 0) x.filter = `blur(${f.inner.size / 2}px)`
    x.drawImage(inv, dx, dy)
    x.filter = 'none'
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(src, 0, 0)
    o.save(); o.globalAlpha = f.inner.opacity; o.globalCompositeOperation = 'source-atop'; o.drawImage(t, 0, 0); o.restore()
  }

  if (f.stroke.on && f.stroke.size > 0 && region && f.stroke.position !== 'outside') paintCoverage(o, region, strokeCov(), f.stroke.color, f.stroke.opacity)
  return out
}

/** Bakes effects into a copy of src, for export. */
export function withFx(src: HTMLCanvasElement, f: Effects) {
  const out = canvas(src.width, src.height)
  renderFx(src, f, out)
  return out
}

