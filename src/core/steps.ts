/**
 * Undo steps that live inside a tool before anything reaches the document history:
 * polygon corners, crop box edits, free transform handle drags and so on.
 * Ctrl+Z walks back through these first, one action at a time, and only then
 * moves on to the document history, so undo behaves the same way in every tool.
 */
/** What undo and redo need from a tool's in-progress steps. */
export interface StepLike { readonly canUndo: boolean; readonly canRedo: boolean; undo(): boolean; redo(): boolean }

export class Steps<T> implements StepLike {
  private past: T[] = []
  private future: T[] = []
  private get: () => T
  private set: (v: T) => void
  private changed: () => void
  constructor(get: () => T, set: (v: T) => void, changed: () => void = () => {}) { this.get = get; this.set = set; this.changed = changed }

  /** Call right before a change, so undo can return to the state as it is now. */
  mark() { this.past.push(this.get()); this.future = []; if (this.past.length > 500) this.past.shift(); this.changed() }
  /** Drop the last mark when the change it guarded turned out to do nothing. */
  unmark() { this.past.pop(); this.changed() }
  undo(): boolean {
    const v = this.past.pop()
    if (v === undefined) return false
    this.future.push(this.get()); this.set(v); this.changed()
    return true
  }
  redo(): boolean {
    const v = this.future.pop()
    if (v === undefined) return false
    this.past.push(this.get()); this.set(v); this.changed()
    return true
  }
  reset() { if (!this.past.length && !this.future.length) return; this.past = []; this.future = []; this.changed() }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
}

/** Steps for a tool, refreshing the undo and redo buttons whenever they change. */
export const toolSteps = <T>(app: { emit(ev: string): void }, get: () => T, set: (v: T) => void) => new Steps<T>(get, set, () => app.emit('steps'))
