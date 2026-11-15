import { Doc, Layer, snapshot } from './doc'
import { History } from './history'
import { touch } from './compose'
import { job } from './jobs'
import { canvas, ctx2d, getData, putData, mkID } from './util'

type Setup = (x: CanvasRenderingContext2D) => void
type PtFn = (x: number, y: number) => [number, number]

function canvasesOf(l: Layer) { return ['canvas', 'mask', 'maskAI'] as const }

export function transformDoc(doc: Doc, hist: History, label: string, w: number, h: number, setup: Setup, pt: PtFn, scale = 1) {
  const before = snapshot(doc)
  const tf = (src: HTMLCanvasElement | null, smooth = true) => {
    if (!src) return null
    const c = canvas(w, h), x = ctx2d(c)
    x.imageSmoothingEnabled = smooth
    x.imageSmoothingQuality = 'high'
    setup(x)
    x.drawImage(src, 0, 0)
    return c
  }
  for (const l of doc.layers) {
    for (const k of canvasesOf(l)) {
      if (!l[k]) continue
      if (k === 'canvas' && (l.kind === 'text' || l.kind === 'shape' || l.kind === 'outline' || l.kind === 'background')) l.canvas = canvas(w, h)
      else l[k] = tf(l[k])
    }
    if (l.shape) {
      const s = l.shape
      ;[s.x1, s.y1] = pt(s.x1, s.y1)
      ;[s.x2, s.y2] = pt(s.x2, s.y2)
      s.size *= scale; s.width *= scale; s.radius *= scale; s.outline *= scale
    }
    if (l.outline) { l.outline.width *= scale; l.outline.glow *= scale }
    l.cache = null; l.maskCache = null; touch(l); l.maskDirty = true
  }
  doc.selection = tf(doc.selection)
  doc.original = tf(doc.original)!
  doc.w = w; doc.h = h
  doc.comp = canvas(w, h)
  hist.structural(label, before)
  doc.structure()
  doc.emit('selection')
}

export function cropDoc(doc: Doc, hist: History, r: { x: number; y: number; w: number; h: number }, angle = 0, outW?: number, outH?: number) {
  const w = Math.max(1, Math.round(r.w)), hh = Math.max(1, Math.round(r.h))
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const a = (angle * Math.PI) / 180
  const sx = outW ? outW / w : 1, sy = outH ? outH / hh : 1
  const W = outW || w, H = outH || hh
  transformDoc(doc, hist, 'Crop', W, H, x => {
    x.scale(sx, sy)
    x.translate(-r.x, -r.y)
    x.translate(cx, cy); x.rotate(-a); x.translate(-cx, -cy)
  }, (px, py) => {
    const dx = px - cx, dy = py - cy
    const rx = dx * Math.cos(-a) - dy * Math.sin(-a) + cx, ry = dx * Math.sin(-a) + dy * Math.cos(-a) + cy
    return [(rx - r.x) * sx, (ry - r.y) * sy]
  }, Math.sqrt(sx * sy))
}

export function rotate90(doc: Doc, hist: History, dir: 1 | -1) {
  const W = doc.w, H = doc.h
  transformDoc(doc, hist, dir > 0 ? 'Rotate right' : 'Rotate left', H, W, x => {
    if (dir > 0) { x.translate(H, 0); x.rotate(Math.PI / 2) } else { x.translate(0, W); x.rotate(-Math.PI / 2) }
  }, (px, py) => (dir > 0 ? [H - py, px] : [py, W - px]))
}

export function flip(doc: Doc, hist: History, horiz: boolean) {
  const W = doc.w, H = doc.h
  transformDoc(doc, hist, horiz ? 'Flip horizontal' : 'Flip vertical', W, H, x => {
    if (horiz) { x.translate(W, 0); x.scale(-1, 1) } else { x.translate(0, H); x.scale(1, -1) }
  }, (px, py) => (horiz ? [W - px, py] : [px, H - py]))
}

async function resample(src: HTMLCanvasElement, w: number, h: number, method: string): Promise<HTMLCanvasElement> {
  const c = canvas(w, h)
  if (method === 'lanczos') {
    const d = getData(src)
    const out: Uint8ClampedArray = await job('lanczos', { data: d.data, w: src.width, h: src.height, dw: w, dh: h }, [d.data.buffer])
    putData(c, mkID(out, w, h))
  } else {
    const x = ctx2d(c)
    x.imageSmoothingEnabled = method !== 'nearest'
    x.imageSmoothingQuality = 'high'
    x.drawImage(src, 0, 0, w, h)
  }
  return c
}

export async function resizeDoc(doc: Doc, hist: History, w: number, h: number, method: string, progress?: (p: number) => void) {
  const before = snapshot(doc)
  const sx = w / doc.w, sy = h / doc.h
  const list: [Layer | null, 'canvas' | 'mask' | 'maskAI' | 'sel' | 'orig'][] = []
  for (const l of doc.layers) for (const k of canvasesOf(l)) if (l[k] && !(k === 'canvas' && (l.kind === 'text' || l.kind === 'shape' || l.kind === 'outline' || l.kind === 'background'))) list.push([l, k])
  if (doc.selection) list.push([null, 'sel'])
  list.push([null, 'orig'])
  const results: HTMLCanvasElement[] = []
  let i = 0
  for (const [l, k] of list) {
    const src = k === 'sel' ? doc.selection! : k === 'orig' ? doc.original : l![k as 'canvas']!
    results.push(await resample(src, w, h, k === 'sel' || k === 'mask' || k === 'maskAI' ? 'bilinear' : method))
    progress?.(++i / list.length)
  }
  list.forEach(([l, k], j) => {
    if (k === 'sel') doc.selection = results[j]
    else if (k === 'orig') doc.original = results[j]
    else (l as any)[k] = results[j]
  })
  const sc = Math.sqrt(sx * sy)
  for (const l of doc.layers) {
    if (l.kind === 'text' || l.kind === 'shape' || l.kind === 'outline' || l.kind === 'background') l.canvas = canvas(w, h)
    if (l.shape) { const s = l.shape; s.x1 *= sx; s.x2 *= sx; s.y1 *= sy; s.y2 *= sy; s.size *= sc; s.width *= sc; s.radius *= sc; s.outline *= sc }
    if (l.outline) { l.outline.width *= sc; l.outline.glow *= sc }
    l.cache = null; l.maskCache = null; touch(l); l.maskDirty = true
  }
  doc.w = w; doc.h = h
  doc.comp = canvas(w, h)
  hist.structural('Resize', before)
  doc.structure()
  doc.emit('selection')
}

export async function perspectiveDoc(doc: Doc, hist: History, quad: number[]) {
  const d = (i: number, j: number) => Math.hypot(quad[i * 2] - quad[j * 2], quad[i * 2 + 1] - quad[j * 2 + 1])
  const w = Math.round((d(0, 1) + d(3, 2)) / 2), h = Math.round((d(0, 3) + d(1, 2)) / 2)
  const before = snapshot(doc)
  const warp = async (src: HTMLCanvasElement) => {
    const id = getData(src)
    const out: Uint8ClampedArray = await job('warp', { data: id.data, w: src.width, h: src.height, quad, dw: w, dh: h }, [id.data.buffer])
    const c = canvas(w, h)
    putData(c, mkID(out, w, h))
    return c
  }
  for (const l of doc.layers) {
    if (l.canvas && !(l.kind === 'text' || l.kind === 'shape' || l.kind === 'outline' || l.kind === 'background')) l.canvas = await warp(l.canvas)
    else if (l.canvas) l.canvas = canvas(w, h)
    if (l.mask) l.mask = await warp(l.mask)
    if (l.maskAI) l.maskAI = await warp(l.maskAI)
    l.cache = null; l.maskCache = null; touch(l); l.maskDirty = true
  }
  doc.original = await warp(doc.original)
  doc.selection = null
  doc.w = w; doc.h = h
  doc.comp = canvas(w, h)
  hist.structural('Perspective', before)
  doc.structure()
  doc.emit('selection')
}
