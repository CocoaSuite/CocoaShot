import { Doc, Layer } from './doc'
import { adjustGL, isIdentity } from './gl'
import { contours, maskPipeline } from './px'
import { drawShape } from './shapes'
import { canvas, ctx2d, getData, putData, Rect, rectClip, rectPad, rectUnion, alphaOf } from './util'

export interface StrokePreview { layer: Layer; buf: HTMLCanvasElement; alpha: number; op: GlobalCompositeOperation; rect: Rect | null }

export function touch(l: Layer, r?: Rect | null) {
  if (!r) l.dirty = true
  else if (l.dirty !== true) l.dirty = rectUnion(l.dirty, r)
}
export function touchMask(l: Layer, r?: Rect | null) {
  if (!r) l.maskDirty = true
  else if (l.maskDirty !== true) l.maskDirty = rectUnion(l.maskDirty, r)
  touch(l, r ? rectPad(r, maskPad(l)) : null)
}
const maskPad = (l: Layer) => Math.ceil(l.maskOpts.feather * 3 + Math.abs(l.maskOpts.shift) + l.maskOpts.smooth + 2)
const plainMask = (l: Layer) => !l.maskOpts.feather && !l.maskOpts.shift && !l.maskOpts.smooth

export function effectiveMask(l: Layer): HTMLCanvasElement | null {
  if (!l.mask) { l.maskCache = null; return null }
  if (plainMask(l)) { l.maskCache = null; l.maskDirty = null; return l.mask }
  const W = l.mask.width, H = l.mask.height
  let r: Rect | null = l.maskDirty === true || !l.maskCache ? { x: 0, y: 0, w: W, h: H } : l.maskDirty
  if (!l.maskCache || l.maskCache.width !== W || l.maskCache.height !== H) { l.maskCache = canvas(W, H); r = { x: 0, y: 0, w: W, h: H } }
  if (r) {
    const p = maskPad(l)
    const pr = rectClip(rectPad(r, p), W, H)
    const cr = rectClip(r, W, H)
    if (pr && cr) {
      const d = getData(l.mask, pr).data
      const n = pr.w * pr.h
      const f = new Float32Array(n)
      for (let i = 0; i < n; i++) f[i] = d[i * 4 + 3] / 255
      const m = maskPipeline(f, pr.w, pr.h, l.maskOpts)
      const out = new ImageData(cr.w, cr.h)
      for (let y = 0; y < cr.h; y++) for (let x = 0; x < cr.w; x++) {
        const j = ((y + cr.y - pr.y) * pr.w + (x + cr.x - pr.x)), o = (y * cr.w + x) * 4
        out.data[o] = out.data[o + 1] = out.data[o + 2] = 255
        out.data[o + 3] = m[j] * 255
      }
      putData(l.maskCache, out, cr.x, cr.y)
    }
  }
  l.maskDirty = null
  return l.maskCache
}

export function renderOutline(doc: Doc, l: Layer) {
  const o = l.outline!
  const c = l.canvas!
  const x = ctx2d(c)
  x.clearRect(0, 0, c.width, c.height)
  let alpha: HTMLCanvasElement | null = null
  const path = new Path2D()
  if (o.source === 'canvas') {
    const inset = o.position === 'inside' ? o.width / 2 : o.position === 'outside' ? -o.width / 2 : 0
    path.rect(inset, inset, doc.w - inset * 2, doc.h - inset * 2)
  } else {
    const src = o.source === 'selection' ? l.maskAI : (() => { const s = doc.layer(o.source); return s ? layerFull(doc, s) : null })()
    if (!src) return
    alpha = src
    const W = src.width, H = src.height
    const scale = Math.min(1, 2400 / Math.max(W, H))
    let a: Uint8Array
    let sw = W, sh = H
    if (scale < 1) {
      sw = Math.round(W * scale); sh = Math.round(H * scale)
      const t = canvas(sw, sh)
      ctx2d(t).drawImage(src, 0, 0, sw, sh)
      a = alphaOf(t)
    } else a = alphaOf(src)
    for (const loop of contours(a, sw, sh, 128)) {
      path.moveTo(loop[0] / scale, loop[1] / scale)
      for (let i = 2; i < loop.length; i += 2) path.lineTo(loop[i] / scale, loop[i + 1] / scale)
      path.closePath()
    }
  }
  x.save()
  x.strokeStyle = o.color
  x.lineJoin = o.round ? 'round' : 'miter'
  x.lineCap = o.round ? 'round' : 'butt'
  x.miterLimit = 4
  x.lineWidth = o.position === 'center' || o.source === 'canvas' ? o.width : o.width * 2
  if (o.style === 'dashed') x.setLineDash([Math.max(4, o.width * 3), Math.max(3, o.width * 2)])
  if (o.glow > 0) { x.shadowColor = o.color; x.shadowBlur = o.glow }
  x.stroke(path)
  if (o.glow > 0) { x.shadowBlur = o.glow * 0.5; x.stroke(path) }
  x.restore()
  if (alpha && o.position !== 'center') {
    x.save()
    x.globalCompositeOperation = o.position === 'outside' ? 'destination-out' : 'destination-in'
    x.drawImage(alpha, 0, 0)
    x.restore()
  }
}

export function renderBg(doc: Doc, l: Layer) {
  const b = l.bg!
  const c = l.canvas!
  const x = ctx2d(c)
  x.clearRect(0, 0, c.width, c.height)
  if (b.mode === 'color') { x.fillStyle = b.color; x.fillRect(0, 0, c.width, c.height) }
  else if (b.mode === 'image' && b.image) {
    const s = Math.max(c.width / b.image.width, c.height / b.image.height)
    const w = b.image.width * s, h = b.image.height * s
    x.imageSmoothingQuality = 'high'
    x.drawImage(b.image, (c.width - w) / 2, (c.height - h) / 2, w, h)
  } else if (b.mode === 'blur') {
    const src = l.bgFor ? doc.layer(l.bgFor) : null
    const img = src?.canvas || doc.original
    x.filter = `blur(${b.blur}px)`
    const p = b.blur * 2
    x.drawImage(img, -p, -p, c.width + p * 2, c.height + p * 2)
    x.filter = 'none'
  }
}

export function layerFull(doc: Doc, l: Layer): HTMLCanvasElement | null {
  prepare(doc, l)
  return l.mask ? l.cache : l.canvas
}

function prepare(doc: Doc, l: Layer) {
  if (!l.canvas) return
  if (l.dirty === true) {
    if (l.kind === 'text' || l.kind === 'shape') { const x = ctx2d(l.canvas); x.clearRect(0, 0, l.canvas.width, l.canvas.height); if (l.shape) drawShape(x, l.shape) }
    else if (l.kind === 'outline' && l.outline) renderOutline(doc, l)
    else if (l.kind === 'background' && l.bg) renderBg(doc, l)
  }
  if (!l.mask) { l.cache = null; l.dirty = null; return }
  const m = effectiveMask(l)!
  let r: Rect | null = l.dirty === true || !l.cache ? { x: 0, y: 0, w: l.canvas.width, h: l.canvas.height } : l.dirty
  if (!l.cache || l.cache.width !== l.canvas.width || l.cache.height !== l.canvas.height) { l.cache = canvas(l.canvas.width, l.canvas.height); r = { x: 0, y: 0, w: l.canvas.width, h: l.canvas.height } }
  if (r) {
    const x = ctx2d(l.cache)
    x.save()
    x.beginPath(); x.rect(r.x, r.y, r.w, r.h); x.clip()
    x.globalCompositeOperation = 'copy'
    x.drawImage(l.canvas, 0, 0)
    x.globalCompositeOperation = 'destination-in'
    x.drawImage(m, 0, 0)
    x.restore()
  }
  l.dirty = null
}

const scratch: HTMLCanvasElement[] = []
function tmp(i: number, w: number, h: number) {
  let c = scratch[i]
  if (!c || c.width < w || c.height < h) { c = canvas(Math.max(w, c?.width || 0), Math.max(h, c?.height || 0)); scratch[i] = c }
  const x = ctx2d(c)
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalAlpha = 1
  x.globalCompositeOperation = 'source-over'
  x.clearRect(0, 0, w, h)
  return c
}

export interface ComposeOpts { stroke?: StrokePreview | null; hide?: string | null; upTo?: string | null }

export function compose(doc: Doc, out: HTMLCanvasElement, rect: Rect | null, o: ComposeOpts = {}) {
  const r = rectClip(rect || { x: 0, y: 0, w: doc.w, h: doc.h }, doc.w, doc.h)
  if (!r) return
  const X = ctx2d(out)
  X.save()
  X.beginPath(); X.rect(r.x, r.y, r.w, r.h); X.clip()
  X.clearRect(r.x, r.y, r.w, r.h)
  for (const l of doc.layers) if (l.kind === 'outline' && l.outline && l.outline.source !== 'canvas') {
    const s = l.outline.source === 'selection' ? null : doc.layer(l.outline.source)
    if (s && s.dirty && s !== o.stroke?.layer) l.dirty = true
  }
  let group: { base: Layer; img: CanvasImageSource; clips: { l: Layer; img: CanvasImageSource }[] } | null = null
  const draw = (target: CanvasRenderingContext2D, img: CanvasImageSource, alpha: number, op: GlobalCompositeOperation) => {
    target.globalAlpha = alpha
    target.globalCompositeOperation = op
    target.drawImage(img, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
  }
  const flush = () => {
    if (!group) return
    if (!group.clips.length) draw(X, group.img, group.base.opacity, group.base.blend)
    else {
      const t = tmp(1, doc.w, doc.h)
      const tx = ctx2d(t)
      draw(tx, group.img, 1, 'source-over')
      for (const c of group.clips) draw(tx, c.img, c.l.opacity, 'source-atop')
      draw(X, t, group.base.opacity, group.base.blend)
    }
    group = null
  }
  for (const l of doc.layers) {
    if (o.upTo && l.id === o.upTo) break
    if (!l.visible || l.id === o.hide) continue
    if (l.kind === 'adjust') {
      flush()
      X.globalAlpha = 1; X.globalCompositeOperation = 'source-over'
      if (l.adjust && !isIdentity(l.adjust)) {
        if (l.opacity >= 0.999) adjustGL().apply(out, r, l.adjust)
        else {
          const t = tmp(2, doc.w, doc.h)
          const tx = ctx2d(t)
          tx.drawImage(out, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
          adjustGL().apply(t, r, l.adjust)
          draw(X, t, l.opacity, 'source-over')
        }
      }
      continue
    }
    const img = imageFor(doc, l, r, o.stroke)
    if (!img) continue
    if (l.clip && group) group.clips.push({ l, img })
    else { flush(); group = { base: l, img, clips: [] } }
  }
  flush()
  X.restore()
}

function imageFor(doc: Doc, l: Layer, r: Rect, st?: StrokePreview | null): CanvasImageSource | null {
  if (!l.canvas) return null
  if (st && st.layer === l) {
    prepare(doc, l)
    const t = tmp(0, doc.w, doc.h)
    const x = ctx2d(t)
    x.drawImage(l.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    x.globalAlpha = st.alpha
    x.globalCompositeOperation = st.op
    x.drawImage(st.buf, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    x.globalAlpha = 1
    if (l.mask) {
      x.globalCompositeOperation = 'destination-in'
      x.drawImage(effectiveMask(l)!, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h)
    }
    x.globalCompositeOperation = 'source-over'
    return t
  }
  return layerFull(doc, l)
}

export function flatten(doc: Doc): HTMLCanvasElement {
  const c = canvas(doc.w, doc.h)
  compose(doc, c, null)
  return c
}
