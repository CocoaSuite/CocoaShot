import type { Doc, Layer } from '../core/doc'
import { shownLocked, subtree } from '../core/doc'
import { shapeBounds } from '../core/shapes'
import { alphaOf, bboxOfAlpha, type Rect } from '../core/util'

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
  return list.length === 1 ? list[0].name : `${list.length} layers`
}
