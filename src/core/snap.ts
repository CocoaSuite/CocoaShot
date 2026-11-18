/** Snapping arithmetic: no canvases here, so it can be tested on its own. */
import type { Rect } from './util'

/** Guides: vertical lines at x positions and horizontal lines at y positions, in image pixels. */
export interface Guides { x: number[]; y: number[] }

export interface SnapTargets { x: number[]; y: number[] }

export interface SnapLine { x?: number; y?: number }

/**
 * Moves a box by (dx, dy), then nudges it so its nearest edge or centre lines up with a target within
 * tol pixels. Returns the adjusted move and the lines it snapped to.
 */
export function snapBox(box: Rect, dx: number, dy: number, t: SnapTargets, tol: number) {
  const lines: SnapLine[] = []
  const best = (edges: number[], targets: number[], d: number) => {
    let bd = tol + 1e-9, out: number | null = null, at = 0
    for (const e of edges) for (const g of targets) { const diff = g - (e + d); if (Math.abs(diff) < bd) { bd = Math.abs(diff); out = diff; at = g } }
    return out === null ? null : { diff: out, at }
  }
  const bx = best([box.x, box.x + box.w / 2, box.x + box.w], t.x, dx)
  const by = best([box.y, box.y + box.h / 2, box.y + box.h], t.y, dy)
  if (bx) { dx += bx.diff; lines.push({ x: bx.at }) }
  if (by) { dy += by.diff; lines.push({ y: by.at }) }
  return { dx, dy, lines }
}

/** Snaps a single point (a guide being dragged, a shape corner) to targets. */
export function snapValue(v: number, targets: number[], tol: number) {
  let bd = tol + 1e-9, out = v
  for (const g of targets) if (Math.abs(g - v) < bd) { bd = Math.abs(g - v); out = g }
  return out
}
