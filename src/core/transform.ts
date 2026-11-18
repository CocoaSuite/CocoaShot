import { Doc, Layer, snapshot } from './doc'
import { History } from './history'
import { touch } from './compose'
import { transformShape } from './shapes'
import { job } from './jobs'
import { homography } from './px'
import { canvas, ctx2d, getData, putData, mkID } from './util'
import { tr } from '../i18n'

type Setup = (x: CanvasRenderingContext2D) => void
type PtFn = (x: number, y: number) => [number, number]

function canvasesOf(l: Layer) { return ['canvas', 'mask', 'maskAI'] as const }

export function transformDoc(doc: Doc, hist: History, label: string, w: number, h: number, setup: Setup, pt: PtFn, scale = 1) {
  const before = snapshot(doc)
  // How the image turned and whether it was mirrored, read from where pt sends two directions.
  const [ox, oy] = pt(0, 0), [ax, ay] = pt(1, 0), [bx, by] = pt(0, 1)
  const turn = Math.atan2(ay - oy, ax - ox), mirror = (ax - ox) * (by - oy) - (ay - oy) * (bx - ox) < 0
  // A flip mirrors a shape's angle; its letters stay readable, so no extra turn is added.
  const fixTurn = mirror ? 0 : turn
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
    if (l.shape) transformShape(l.shape, pt, scale, fixTurn, mirror)
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
  // Whole pixels: a box between pixels would resample, and so soften, the whole image.
  const x0 = Math.round(r.x), y0 = Math.round(r.y)
  r = { x: x0, y: y0, w: Math.max(1, Math.round(r.x + r.w) - x0), h: Math.max(1, Math.round(r.y + r.h) - y0) }
  const w = Math.max(1, Math.round(r.w)), hh = Math.max(1, Math.round(r.h))
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  const a = (angle * Math.PI) / 180
  const sx = outW ? outW / w : 1, sy = outH ? outH / hh : 1
  const W = outW || w, H = outH || hh
  transformDoc(doc, hist, tr('Crop'), W, H, x => {
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
  transformDoc(doc, hist, dir > 0 ? tr('Rotate right') : tr('Rotate left'), H, W, x => {
    if (dir > 0) { x.translate(H, 0); x.rotate(Math.PI / 2) } else { x.translate(0, W); x.rotate(-Math.PI / 2) }
  }, (px, py) => (dir > 0 ? [H - py, px] : [py, W - px]))
}

export function flip(doc: Doc, hist: History, horiz: boolean) {
  const W = doc.w, H = doc.h
  transformDoc(doc, hist, horiz ? tr('Flip horizontal') : tr('Flip vertical'), W, H, x => {
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
    if (l.shape) transformShape(l.shape, (x, y) => [x * sx, y * sy], sc, 0, false)
    if (l.outline) { l.outline.width *= sc; l.outline.glow *= sc }
    l.cache = null; l.maskCache = null; touch(l); l.maskDirty = true
  }
  doc.w = w; doc.h = h
  doc.comp = canvas(w, h)
  hist.structural(tr('Resize'), before)
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
  // Text and shapes follow the correction: their points go where the warp sends them.
  const H = homography(quad, [0, 0, w, 0, w, h, 0, h])
  const map = (x: number, y: number): [number, number] => { const z = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z] }
  for (const l of doc.layers) if (l.shape) transformShape(l.shape, map, 1, 0, false)
  doc.original = await warp(doc.original)
  doc.selection = null
  doc.w = w; doc.h = h
  doc.comp = canvas(w, h)
  hist.structural(tr('Perspective'), before)
  doc.structure()
  doc.emit('selection')
}
