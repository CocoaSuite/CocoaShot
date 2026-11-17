import { normalizeTree, restore, snapshot, type Doc, type Layer, type Snap } from './doc'
import { getData, putData, type Rect } from './util'

interface Entry { label: string; undo: () => void; redo: () => void; size: number }

const LIMIT_BYTES = 1.2e9
const LIMIT_COUNT = 150

/** Bytes held only by one side of a structural step: canvases the step replaced or created. */
function snapBytes(a: Snap, b: Snap) {
  const set = (s: Snap) => {
    const out = new Set<HTMLCanvasElement>()
    for (const { p } of s.layers) for (const c of [p.canvas, p.mask, p.maskAI]) if (c) out.add(c)
    if (s.selection) out.add(s.selection)
    if (s.original) out.add(s.original)
    return out
  }
  const A = set(a), B = set(b)
  let n = 2048
  for (const c of A) if (!B.has(c)) n += c.width * c.height * 4
  for (const c of B) if (!A.has(c)) n += c.width * c.height * 4
  return n
}

/** Marks a history that has never been saved: no point in it matches the file on disk. */
const NEVER = { label: '', undo() {}, redo() {}, size: 0 }

export class History {
  past: Entry[] = []
  future: Entry[] = []
  pending: (() => void) | null = null
  /** The step the document was last saved at (null: before any step). */
  private clean: Entry | null
  doc: Doc
  constructor(doc: Doc) { this.doc = doc; this.clean = doc.modified ? NEVER : null }

  /** Remembers the current step as the saved state, so undoing back to it clears "Edited". */
  markClean() { this.clean = this.past[this.past.length - 1] || null }

  push(e: Entry) {
    this.past.push(e)
    this.future = []
    let total = this.past.reduce((s, x) => s + x.size, 0)
    while (this.past.length > 1 && (this.past.length > LIMIT_COUNT || total > LIMIT_BYTES)) {
      const gone = this.past.shift()!
      total -= gone.size
      // The saved state can no longer be reached by undoing.
      if (this.clean === null) this.clean = NEVER
    }
    this.doc.emit('history')
  }

  flush() { const f = this.pending; this.pending = null; f?.() }
  undo() { this.flush(); const e = this.past.pop(); if (!e) return; e.undo(); this.future.push(e); this.after() }
  redo() { this.flush(); const e = this.future.pop(); if (!e) return; e.redo(); this.past.push(e); this.after() }
  jump(i: number) {
    while (this.past.length > i + 1) this.undo()
    while (this.past.length < i + 1 && this.future.length) this.redo()
  }
  private after() {
    this.doc.structure()
    this.doc.modified = (this.past[this.past.length - 1] || null) !== this.clean
    this.doc.emit('history')
    this.doc.emit('selection')
  }

  structural(label: string, before: Snap) {
    normalizeTree(this.doc)
    const after = snapshot(this.doc)
    this.push({ label, undo: () => restore(this.doc, before), redo: () => restore(this.doc, after), size: snapBytes(before, after) })
  }

  async op(label: string, fn: () => void | Promise<void>) {
    this.flush()
    const before = snapshot(this.doc)
    await fn()
    this.structural(label, before)
    this.doc.structure()
  }

  raster(label: string, layer: Layer, which: 'canvas' | 'mask' | 'selection', rect: Rect, before: ImageData) {
    const doc = this.doc
    const target = () => (which === 'selection' ? doc.selection : layer[which]) as HTMLCanvasElement
    const t0 = target()
    if (!t0) return
    const after = getData(t0, rect)
    const apply = (d: ImageData) => {
      const t = target()
      if (!t) return
      putData(t, d, rect.x, rect.y)
      if (which === 'mask') layer.maskDirty = true
      layer.dirty = true
    }
    this.push({ label, undo: () => apply(before), redo: () => apply(after), size: rect.w * rect.h * 8 })
  }
}
