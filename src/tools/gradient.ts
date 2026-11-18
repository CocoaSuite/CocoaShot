import type { App } from '../app'
import type { Tool } from './types'
import { shownVisible, type Layer } from '../core/doc'
import { touch } from '../core/compose'
import { canvas, copyCanvas, ctx2d, getData, hex2rgb } from '../core/util'
import { h, toast } from '../ui/dom'
import { hint, sec, select, slider, toggle } from '../ui/controls'
import { colorPanel } from './common'
import { BLENDS, layerOptions } from './paint'
import type { Blend } from '../core/doc'
import { tr } from '../i18n'

type Kind = 'linear' | 'radial' | 'reflected' | 'angle' | 'diamond'
type Colours = 'fgbg' | 'fgclear' | 'rainbow'

const o = { kind: 'linear' as Kind, colours: 'fgbg' as Colours, opacity: 1, reverse: false, blend: 'source-over' as Blend }

function stops(app: App): [number, string][] {
  const rgba = (hex: string, a: number) => { const [r, g, b] = hex2rgb(hex); return `rgba(${r},${g},${b},${a})` }
  let s: [number, string][]
  if (o.colours === 'rainbow') s = ['#ff0000', '#ffa500', '#ffff00', '#00c000', '#0080ff', '#4b0082', '#8f00ff'].map((c, i, a) => [i / (a.length - 1), c])
  else s = [[0, rgba(app.fg, 1)], [1, o.colours === 'fgclear' ? rgba(app.fg, 0) : rgba(app.bgc, 1)]]
  return o.reverse ? s.map(([t, c]) => [1 - t, c] as [number, string]).reverse() : s
}

/** Draws the gradient from a to b into a canvas the size of the image. */
export function drawGradient(app: App, w: number, hh: number, a: { x: number; y: number }, b: { x: number; y: number }) {
  const c = canvas(w, hh)
  const x = ctx2d(c)
  const st = stops(app)
  const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))
  let g: CanvasGradient
  if (o.kind === 'radial') g = x.createRadialGradient(a.x, a.y, 0, a.x, a.y, len)
  else if (o.kind === 'angle') g = x.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y)
  else if (o.kind === 'reflected') {
    g = x.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y)
    for (const [t, col] of st) { g.addColorStop(0.5 + t / 2, col); g.addColorStop(0.5 - t / 2, col) }
  } else if (o.kind === 'diamond') {
    // A diamond: in each quarter around the start point, a ramp along the diagonal, so lines of equal colour form a diamond.
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    x.translate(a.x, a.y); x.rotate(ang)
    const reach = Math.hypot(w, hh) * 2
    for (const [qx, qy] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
      const lg = x.createLinearGradient(0, 0, (qx * len) / 2, (qy * len) / 2)
      for (const [s, col] of st) lg.addColorStop(s, col)
      x.save()
      // Overlap the quarters by a pixel so their anti-aliased edges don't leave see-through seams.
      x.beginPath(); x.rect(Math.min(0, qx * reach) - 1, Math.min(0, qy * reach) - 1, reach + 2, reach + 2); x.clip()
      x.fillStyle = lg; x.fillRect(-reach, -reach, reach * 2, reach * 2)
      x.restore()
    }
    x.setTransform(1, 0, 0, 1, 0, 0)
    return c
  } else g = x.createLinearGradient(a.x, a.y, b.x, b.y)
  if (o.kind !== 'reflected') for (const [t, col] of st) g.addColorStop(t, col)
  x.fillStyle = g
  x.fillRect(0, 0, w, hh)
  return c
}

export function gradientTool(app: App): Tool {
  let drag: { l: Layer; a: { x: number; y: number }; b: { x: number; y: number }; orig: HTMLCanvasElement; made: boolean } | null = null
  const apply = () => {
    if (!drag) return
    const doc = app.doc!
    const { l, a, b, orig } = drag
    const g = drawGradient(app, doc.w, doc.h, a, b)
    if (doc.selection) { const gx = ctx2d(g); gx.globalCompositeOperation = 'destination-in'; gx.drawImage(doc.selection, 0, 0) }
    const x = ctx2d(l.canvas!)
    x.save()
    x.globalCompositeOperation = 'copy'
    x.drawImage(orig, 0, 0)
    x.globalCompositeOperation = l.alphaLock ? 'source-atop' : o.blend
    x.globalAlpha = o.opacity
    x.drawImage(g, 0, 0)
    x.restore()
    touch(l)
    doc.changed()
  }
  const snap = (a: { x: number; y: number }, p: { x: number; y: number; e: PointerEvent }) => {
    if (!p.e.shiftKey) return { x: p.x, y: p.y }
    const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(p.x - a.x, p.y - a.y)
    return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d }
  }
  return {
    id: 'gradient', label: tr('Gradient'), icon: 'gradient', altPick: true,
    cursor: () => 'crosshair',
    down(p) {
      const doc = app.doc!
      const act = doc.active
      const paintable = act && act.canvas && !act.locked && (act.kind === 'paint' || act.kind === 'image' || act.kind === 'highlight')
      const l = paintable ? app.activeRaster() : app.newPaintLayer()
      if (!l) return
      if (!shownVisible(doc, l)) toast(tr('{0} is hidden, so the gradient won\'t show', l.name))
      drag = { l, a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, orig: copyCanvas(l.canvas!), made: !paintable }
    },
    move(p, pressed) {
      if (!pressed || !drag) return
      drag.b = snap(drag.a, p)
      apply()
      app.view.draw()
    },
    up() {
      const d = drag
      if (!d) return
      drag = null
      const doc = app.doc!
      if (Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) < 1) {
        const x = ctx2d(d.l.canvas!); x.globalCompositeOperation = 'copy'; x.drawImage(d.orig, 0, 0); x.globalCompositeOperation = 'source-over'; touch(d.l); doc.changed()
        // A click without a drag leaves no empty layer behind.
        if (d.made) { app.hist!.undo(); app.hist!.future.pop(); app.emit('history') }
        return
      }
      app.hist!.raster(tr('Gradient'), d.l, 'canvas', { x: 0, y: 0, w: doc.w, h: doc.h }, getData(d.orig))
      app.view.draw()
    },
    overlay(x, v) {
      if (!drag) return
      const a = v.toScreen(drag.a.x, drag.a.y), b = v.toScreen(drag.b.x, drag.b.y)
      x.save()
      x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.5)'
      x.beginPath(); x.moveTo(a.x, a.y); x.lineTo(b.x, b.y); x.stroke()
      x.lineWidth = 1.2; x.strokeStyle = '#fff'; x.stroke()
      for (const q of [a, b]) { x.beginPath(); x.arc(q.x, q.y, 4, 0, Math.PI * 2); x.fillStyle = '#fff'; x.fill(); x.strokeStyle = '#4a6fae'; x.stroke() }
      x.restore()
    },
    panel: () => h('div', { class: 'ib' },
      sec(tr('Gradient')),
      hint(tr('Drag across the image to draw a gradient. Hold Shift to keep the line straight. With a selection, only the selected area is filled.')),
      select(tr('Shape'), [['linear', tr('Linear')], ['radial', tr('Radial')], ['reflected', tr('Reflected')], ['angle', tr('Angle')], ['diamond', tr('Diamond')]], () => o.kind, v => (o.kind = v)),
      select<Colours>(tr('Colours'), [['fgbg', tr('Front to back colour')], ['fgclear', tr('Front colour to clear')], ['rainbow', tr('Rainbow')]], () => o.colours, v => { o.colours = v; app.emit('panel') }),
      toggle(tr('Reverse'), () => o.reverse, v => (o.reverse = v)),
      slider(tr('Opacity'), () => Math.round(o.opacity * 100), v => (o.opacity = v / 100), { min: 1, max: 100, unit: '%' }),
      select(tr('Blend'), BLENDS, () => o.blend, v => (o.blend = v)),
      o.colours !== 'rainbow' && sec(tr('Colour')), o.colours !== 'rainbow' && colorPanel(app),
      ...layerOptions(app))
  }
}
