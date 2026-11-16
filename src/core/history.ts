import { Doc, Layer, normalizeTree, restore, snapshot, Snap } from './doc'
import { getData, putData, Rect } from './util'

interface Entry { label: string; undo: () => void; redo: () => void; size: number }

const LIMIT_BYTES = 1.2e9
const LIMIT_COUNT = 150

export class History {
  past: Entry[] = []
  future: Entry[] = []
  pending: (() => void) | null = null
  constructor(public doc: Doc) {}

  push(e: Entry) {
    this.past.push(e)
    this.future = []
    let total = this.past.reduce((s, x) => s + x.size, 0)
    while (this.past.length > 1 && (this.past.length > LIMIT_COUNT || total > LIMIT_BYTES)) total -= this.past.shift()!.size
    this.doc.emit('history')
  }

  flush() { const f = this.pending; this.pending = null; f?.() }
  undo() { this.flush(); const e = this.past.pop(); if (!e) return; e.undo(); this.future.push(e); this.after() }
  redo() { this.flush(); const e = this.future.pop(); if (!e) return; e.redo(); this.past.push(e); this.after() }
  jump(i: number) {
    while (this.past.length > i + 1) this.undo()
    while (this.past.length < i + 1 && this.future.length) this.redo()
  }
  private after() { this.doc.emit('history'); this.doc.structure(); this.doc.emit('selection') }

  structural(label: string, before: Snap) {
    normalizeTree(this.doc)
    const after = snapshot(this.doc)
    this.push({ label, undo: () => restore(this.doc, before), redo: () => restore(this.doc, after), size: 2048 })
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
