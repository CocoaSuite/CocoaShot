import type { App } from '../app'
import type { Doc, Layer } from '../core/doc'
import { shownLocked, snapshot, subtree } from '../core/doc'
import { touch } from '../core/compose'
import { shapeBounds, transformShape } from '../core/shapes'
import { alphaOf, bboxOfAlpha, canvas, copyCanvas, ctx2d, type Rect } from '../core/util'
import { toast } from '../ui/dom'
import { tr, tn } from '../i18n'

/** The layers picked in the Layers panel or the image (Ctrl- or Shift-click), plus the active one. Bottom to top. */
export function chosenLayers(doc: Doc): Layer[] {
  const ids = new Set([...doc.picked, doc.activeId])
  return doc.layers.filter(l => ids.has(l.id))
}

/** Several things are being worked on together: more than one layer is picked, or a folder is. */
export const isMulti = (doc: Doc) => doc.picked.size > 0 || doc.active?.kind === 'group'

/** Identifies the current set of picked layers, to tell when it changes. */
export const chosenKey = (doc: Doc) => chosenLayers(doc).map(l => l.id).join(',')

/** What a move, turn or transform of the chosen layers acts on: pixel layers and text or shapes, folders opened up, locked ones left out. */
export function transformable(doc: Doc, list = chosenLayers(doc)) {
  const seen = new Set<Layer>()
  for (const l of list) for (const k of subtree(doc, l)) if (k.kind !== 'group' && !shownLocked(doc, k)) seen.add(k)
  const all = doc.layers.filter(l => seen.has(l))
  return {
    pixels: all.filter(k => k.canvas && !k.shape && (k.kind === 'image' || k.kind === 'paint' || k.kind === 'highlight')),
    shapes: all.filter(k => k.shape)
  }
}

/** The box around everything in a set of layers (pixels and shapes), or null when it is empty. */
export function boundsOf(doc: Doc, t: { pixels: Layer[]; shapes: Layer[] }): Rect | null {
  let bb: Rect | null = null
  const add = (r: Rect | null) => {
    if (!r) return
    if (!bb) { bb = { ...r }; return }
    const x = Math.min(bb.x, r.x), y = Math.min(bb.y, r.y)
    bb = { x, y, w: Math.max(bb.x + bb.w, r.x + r.w) - x, h: Math.max(bb.y + bb.h, r.y + r.h) - y }
  }
  for (const k of t.pixels) add(bboxOfAlpha(alphaOf(k.canvas!), doc.w, doc.h))
  for (const k of t.shapes) add(shapeBounds(k.shape!))
  return bb
}

/** A label for the chosen layers: the folder's or layer's name, or how many layers. */
export function chosenName(doc: Doc) {
  const list = chosenLayers(doc)
  return list.length === 1 ? list[0].name : tn(list.length, '{0} layer', '{0} layers')
}

/**
 * Mirrors what is chosen about the middle of its own box: the picked layers, a folder, or the active
 * layer. With a selection on a single pixel layer, only the selected pixels flip (and the selection with them).
 * Text stays readable: it moves to its mirrored place and its angle mirrors.
 */
export function flipChosen(app: App, horiz: boolean) {
  const doc = app.doc
  const hist = app.hist
  if (!doc || !hist) return
  hist.flush()
  const name = chosenName(doc)
  const a = doc.active
  const single = !isMulti(doc)
  if (single && a && shownLocked(doc, a)) { toast(tr('{0} is locked', a.name)); return }
  const t = transformable(doc)
  const selPart = single && !!doc.selection && t.pixels.length === 1 && t.pixels[0] === a
  const box = selPart ? bboxOfAlpha(alphaOf(doc.selection!), doc.w, doc.h) : boundsOf(doc, t)
  if (!box || (!t.pixels.length && !t.shapes.length)) { toast(tr('{0} has nothing to flip', name)); return }
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2
  const m = new DOMMatrix().translate(cx, cy).scale(horiz ? -1 : 1, horiz ? 1 : -1).translate(-cx, -cy)
  const mirrored = (src: HTMLCanvasElement) => {
    const c = canvas(src.width, src.height), x = ctx2d(c)
    x.setTransform(m); x.drawImage(src, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0)
    return c
  }
  const before = snapshot(doc)
  if (selPart) {
    // Only the selected pixels: the rest of the layer stays where it is.
    const l = a!, sel = doc.selection!
    const part = copyCanvas(l.canvas!)
    const px = ctx2d(part); px.globalCompositeOperation = 'destination-in'; px.drawImage(sel, 0, 0)
    const out = copyCanvas(l.canvas!)
    const ox = ctx2d(out); ox.globalCompositeOperation = 'destination-out'; ox.drawImage(sel, 0, 0)
    ox.globalCompositeOperation = 'source-over'; ox.drawImage(mirrored(part), 0, 0)
    l.canvas = out
    doc.selection = mirrored(sel)
    touch(l)
  } else {
    for (const l of t.pixels) {
      l.canvas = mirrored(l.canvas!)
      if (l.mask) {
        // The box maps onto itself; anything the flip brings in from outside it shows (white).
        const nm = canvas(doc.w, doc.h), x = ctx2d(nm)
        x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h)
        x.drawImage(mirrored(l.mask), 0, 0)
        l.mask = nm
        l.maskDirty = true
      }
      touch(l)
    }
    for (const l of t.shapes) {
      const s = { ...l.shape! }
      transformShape(s, (x, y) => { const q = new DOMPoint(x, y).matrixTransform(m); return [q.x, q.y] }, 1, 0, true)
      l.shape = s
      touch(l)
    }
  }
  hist.structural(tr(horiz ? 'Flip horizontally: {0}' : 'Flip vertically: {0}', selPart ? tr('selection') : name), before)
  doc.structure()
  if (selPart) doc.emit('selection')
}
