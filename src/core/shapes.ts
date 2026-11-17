import type { Shape, ShapeType } from './doc'
import type { Rect } from './util'

export const SHAPE_NAMES: Record<ShapeType, string> = {
  text: 'Text', arrow: 'Arrow', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', callout: 'Callout', label: 'Label', marker: 'Number'
}

export function newShape(type: ShapeType, x: number, y: number, color: string, scale: number): Shape {
  const s = Math.max(12, Math.round(28 * scale))
  return {
    type, x1: x, y1: y, x2: x, y2: y, stroke: color, fill: type === 'label' || type === 'callout' ? '#ffffff' : color,
    fillOn: type === 'label' || type === 'callout' || type === 'marker', width: Math.max(2, Math.round(4 * scale)), dash: false, radius: Math.round(8 * scale),
    text: type === 'text' ? 'Text' : type === 'callout' ? 'Note' : type === 'label' ? 'Label' : '',
    font: 'Inter', size: s, bold: type !== 'text', italic: false, align: type === 'text' ? 'left' : 'center',
    color: type === 'label' || type === 'callout' ? '#111111' : type === 'marker' ? '#ffffff' : color,
    shadow: false, outline: 0, outlineColor: '#000000', num: 1
  }
}

const fontOf = (s: Shape) => `${s.italic ? 'italic ' : ''}${s.bold ? 600 : 400} ${s.size}px "${s.font}", Inter, system-ui, sans-serif`

const loading = new Set<string>()
/**
 * Canvas text silently falls back to another font while a web font is still loading. Returns false
 * (and calls ready once it has loaded) when the shape's font isn't ready yet, so the layer can be redrawn.
 */
export function fontReady(s: Shape, ready: () => void): boolean {
  if (!s.text && s.type !== 'marker') return true
  const f = s.type === 'marker' ? `600 ${s.size}px "${s.font}"` : fontOf(s)
  const fonts = (document as any).fonts as FontFaceSet | undefined
  if (!fonts) return true
  try { if (fonts.check(f)) return true } catch { return true }
  if (!loading.has(f)) {
    loading.add(f)
    fonts.load(f).then(() => ready(), () => {}).finally(() => loading.delete(f))
  }
  return false
}

function lines(s: Shape) { return (s.text || '').split('\n') }

export function textBox(x: CanvasRenderingContext2D, s: Shape) {
  x.font = fontOf(s)
  const ls = lines(s)
  const w = Math.max(...ls.map(l => x.measureText(l).width), s.size * 0.5)
  return { w, h: ls.length * s.size * 1.25 }
}

function drawText(x: CanvasRenderingContext2D, s: Shape, cx: number, top: number, w: number) {
  x.font = fontOf(s)
  x.textBaseline = 'top'
  x.textAlign = s.align
  const ax = s.align === 'left' ? cx - w / 2 : s.align === 'right' ? cx + w / 2 : cx
  lines(s).forEach((l, i) => {
    const y = top + i * s.size * 1.25 + s.size * 0.1
    if (s.outline > 0) { x.lineWidth = s.outline * 2; x.strokeStyle = s.outlineColor; x.lineJoin = 'round'; x.strokeText(l, ax, y) }
    x.fillStyle = s.color
    x.fillText(l, ax, y)
  })
}

function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2))
  x.beginPath()
  x.roundRect(l, t, w, h, r)
}

/** Shapes that can be turned; lines and arrows already point any way. */
export const canRotate = (s: Shape) => s.type !== 'line' && s.type !== 'arrow' && s.type !== 'marker'
const rad = (s: Shape) => (canRotate(s) && s.rot ? (s.rot * Math.PI) / 180 : 0)

/** The point a shape turns about: the middle of its box (the callout's box, not its tail). */
export function shapeCenter(s: Shape, x?: CanvasRenderingContext2D): { x: number; y: number } {
  if (s.type === 'text' || s.type === 'label') {
    const b = textBox(x || document.createElement('canvas').getContext('2d')!, s)
    const px = s.type === 'label' ? s.size * 0.6 : 0, py = s.type === 'label' ? s.size * 0.35 : 0
    return { x: s.x1 - px + (b.w + px * 2) / 2, y: s.y1 - py + (b.h + py * 2) / 2 }
  }
  if (s.type === 'marker') return { x: s.x1, y: s.y1 }
  return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }
}

/** Turns a point about c by a (radians). */
export const turn = (px: number, py: number, c: { x: number; y: number }, a: number) => {
  const co = Math.cos(a), sn = Math.sin(a), dx = px - c.x, dy = py - c.y
  return { x: c.x + dx * co - dy * sn, y: c.y + dx * sn + dy * co }
}

/** The shape's box on the image, rotation included. */
export function shapeBounds(s: Shape, x?: CanvasRenderingContext2D): Rect {
  const b = flatBounds(s, x), a = rad(s)
  if (!a) return b
  const c = shapeCenter(s, x)
  const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(([px, py]) => turn(px, py, c, a))
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const l = Math.min(...xs), t = Math.min(...ys)
  return { x: l, y: t, w: Math.max(...xs) - l, h: Math.max(...ys) - t }
}

/** The shape's box before rotation. */
export function flatBounds(s: Shape, x?: CanvasRenderingContext2D): Rect {
  const pad = s.width * 2 + 4 + (s.type === 'arrow' ? s.width * 4 : 0)
  if (s.type === 'text' || s.type === 'label' || s.type === 'marker') {
    const c = x || document.createElement('canvas').getContext('2d')!
    const b = textBox(c, s)
    if (s.type === 'marker') { const r = s.size * 0.9; return { x: s.x1 - r - pad, y: s.y1 - r - pad, w: r * 2 + pad * 2, h: r * 2 + pad * 2 } }
    const px = s.type === 'label' ? s.size * 0.6 : 0, py = s.type === 'label' ? s.size * 0.35 : 0
    return { x: s.x1 - px - pad, y: s.y1 - py - pad, w: b.w + px * 2 + pad * 2, h: b.h + py * 2 + pad * 2 }
  }
  const l = Math.min(s.x1, s.x2), t = Math.min(s.y1, s.y2)
  const ex = s.type === 'callout' ? Math.abs(s.y2 - s.y1) * 0.6 : 0
  return { x: l - pad, y: t - pad, w: Math.abs(s.x2 - s.x1) + pad * 2, h: Math.abs(s.y2 - s.y1) + pad * 2 + ex }
}

export function drawShape(x: CanvasRenderingContext2D, s: Shape) {
  x.save()
  const a = rad(s)
  if (a) { const c = shapeCenter(s, x); x.translate(c.x, c.y); x.rotate(a); x.translate(-c.x, -c.y) }
  if (s.shadow) { x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = Math.max(4, s.size * 0.3); x.shadowOffsetY = Math.max(2, s.size * 0.08) }
  x.lineWidth = s.width
  x.strokeStyle = s.stroke
  x.fillStyle = s.fill
  x.lineCap = 'round'
  x.lineJoin = 'round'
  if (s.dash) x.setLineDash([s.width * 3, s.width * 2])
  const l = Math.min(s.x1, s.x2), t = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1)
  switch (s.type) {
    case 'line':
      x.beginPath(); x.moveTo(s.x1, s.y1); x.lineTo(s.x2, s.y2); x.stroke(); break
    case 'arrow': {
      const a = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), hl = s.width * 4.5
      const bx = s.x2 - Math.cos(a) * hl * 0.8, by = s.y2 - Math.sin(a) * hl * 0.8
      x.beginPath(); x.moveTo(s.x1, s.y1); x.lineTo(bx, by); x.stroke()
      x.setLineDash([])
      x.beginPath()
      x.moveTo(s.x2, s.y2)
      x.lineTo(s.x2 - Math.cos(a - 0.45) * hl, s.y2 - Math.sin(a - 0.45) * hl)
      x.lineTo(s.x2 - Math.cos(a + 0.45) * hl, s.y2 - Math.sin(a + 0.45) * hl)
      x.closePath(); x.fillStyle = s.stroke; x.fill(); break
    }
    case 'rect':
      roundRect(x, l, t, w, h, s.radius)
      if (s.fillOn) x.fill()
      x.stroke(); break
    case 'ellipse':
      x.beginPath(); x.ellipse(l + w / 2, t + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (s.fillOn) x.fill()
      x.stroke(); break
    case 'callout': {
      const tw = Math.min(w * 0.25, 40 + s.size), tx = l + w * 0.22
      x.beginPath()
      x.roundRect(l, t, w, h, Math.min(s.radius, w / 2, h / 2))
      x.moveTo(tx, t + h); x.lineTo(tx + tw * 0.2, t + h + Math.max(16, h * 0.6)); x.lineTo(tx + tw, t + h)
      if (s.fillOn) x.fill()
      x.stroke()
      x.shadowColor = 'transparent'
      const b = textBox(x, s)
      drawText(x, s, l + w / 2, t + (h - b.h) / 2, w - s.size)
      break
    }
    case 'label': {
      const b = textBox(x, s), px = s.size * 0.6, py = s.size * 0.35
      roundRect(x, s.x1 - px, s.y1 - py, b.w + px * 2, b.h + py * 2, s.radius)
      if (s.fillOn) x.fill()
      if (s.width > 0) x.stroke()
      x.shadowColor = 'transparent'
      drawText(x, s, s.x1 + b.w / 2, s.y1, b.w)
      break
    }
    case 'marker': {
      const r = s.size * 0.9
      x.beginPath(); x.arc(s.x1, s.y1, r, 0, Math.PI * 2)
      x.fillStyle = s.fill; x.fill()
      x.shadowColor = 'transparent'
      if (s.width > 0 && s.stroke !== s.fill) x.stroke()
      x.font = `600 ${s.size}px "${s.font}", Inter, sans-serif`
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = s.color
      x.fillText(String(s.num), s.x1, s.y1 + s.size * 0.05)
      break
    }
    case 'text': {
      const b = textBox(x, s)
      drawText(x, s, s.x1 + b.w / 2, s.y1, b.w)
      break
    }
  }
  x.restore()
}

export function hitShape(s: Shape, px: number, py: number, tol: number): boolean {
  if (s.type === 'line' || s.type === 'arrow') {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / L))
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy)) <= tol + s.width
  }
  const a = rad(s)
  if (a) { const q = turn(px, py, shapeCenter(s), -a); px = q.x; py = q.y }
  const b = flatBounds(s)
  return px >= b.x - tol && py >= b.y - tol && px <= b.x + b.w + tol && py <= b.y + b.h + tol
}

/**
 * Moves a shape through a transform of the whole image: map takes image points to new ones, scale
 * resizes text and line widths, turn (radians) is how far the image turned and mirror whether it was flipped.
 * Text stays readable: a flip mirrors its angle rather than the letters.
 */
export function transformShape(s: Shape, map: (x: number, y: number) => [number, number], scale: number, turnBy: number, mirror: boolean) {
  const m = document.createElement('canvas').getContext('2d')!
  const right = Math.abs(Math.round(turnBy / (Math.PI / 2)) * (Math.PI / 2) - turnBy) < 1e-6
  if (canRotate(s) && (s.type === 'text' || s.type === 'label' || s.rot || !right)) {
    // Anchored shapes move by their centre and turn instead of being skewed.
    const c = shapeCenter(s, m)
    const [cx, cy] = map(c.x, c.y)
    const hw = (s.type === 'text' || s.type === 'label') ? 0 : Math.abs(s.x2 - s.x1) / 2, hh = (s.type === 'text' || s.type === 'label') ? 0 : Math.abs(s.y2 - s.y1) / 2
    s.size *= scale; s.width *= scale; s.radius *= scale; s.outline *= scale
    const deg = (turnBy * 180) / Math.PI
    s.rot = ((((mirror ? -(s.rot || 0) : (s.rot || 0)) + deg) % 360) + 540) % 360 - 180
    if (Math.abs(s.rot) < 1e-6) s.rot = 0
    if (s.type === 'text' || s.type === 'label') {
      const nc = shapeCenter({ ...s, x1: 0, y1: 0, x2: 0, y2: 0 }, m)
      s.x1 = cx - nc.x; s.y1 = cy - nc.y; s.x2 = s.x1; s.y2 = s.y1
    } else {
      s.x1 = cx - hw * scale; s.x2 = cx + hw * scale; s.y1 = cy - hh * scale; s.y2 = cy + hh * scale
    }
    return
  }
  ;[s.x1, s.y1] = map(s.x1, s.y1)
  ;[s.x2, s.y2] = map(s.x2, s.y2)
  s.size *= scale; s.width *= scale; s.radius *= scale; s.outline *= scale
}
