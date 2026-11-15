import type { App } from '../app'
import type { Tool } from './types'
import { Layer, makeLayer, OutlineOpts, snapshot } from '../core/doc'
import { touch } from '../core/compose'
import { Stroke, BrushOpts } from '../core/brush'
import { copyCanvas, ctx2d, getData, rgba } from '../core/util'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, select, slider, toggle } from '../ui/controls'
import { colorPanel, drawBrushCursor, jobBox } from './common'
import { selectSubject } from './select'
import { colorWheel } from '../ui/color'

type Shape = 'brush' | 'rect' | 'ellipse'

function shapePath(x: CanvasRenderingContext2D, k: Shape, a: { x: number; y: number }, b: { x: number; y: number }) {
  const l = Math.min(a.x, b.x), t = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y)
  x.beginPath()
  if (k === 'rect') x.rect(l, t, w, hh)
  else x.ellipse(l + w / 2, t + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2)
}

function dragOverlay(x: CanvasRenderingContext2D, v: any, k: Shape, a: any, b: any) {
  x.save(); x.translate(v.ox, v.oy); x.scale(v.zoom, v.zoom)
  shapePath(x, k, a, b)
  x.lineWidth = 1 / v.zoom; x.setLineDash([4 / v.zoom, 4 / v.zoom]); x.strokeStyle = '#fff'; x.stroke()
  x.restore()
}

export function highlightTools(app: App): Tool[] {
  const ho = { shape: 'brush' as Shape, opacity: 0.35, soft: 0, marker: false }
  const bo: BrushOpts = { size: 40, opacity: 0.35, hardness: 0.8, flow: 1, spacing: 0.1, color: '#ffcc00', pressure: false, pencil: false, strength: 0.5 }
  let a: any = null, b: any = null, stroke: Stroke | null = null

  const hlLayer = () => {
    const l = app.ensurePaintLayer('highlight', 'Highlight')
    if (l) l.blend = ho.marker ? 'multiply' : 'source-over'
    return l
  }
  const fillOn = (l: Layer, draw: (x: CanvasRenderingContext2D) => void, label: string) => {
    const before = getData(l.canvas!)
    const x = ctx2d(l.canvas!)
    x.save()
    if (ho.soft) x.filter = `blur(${ho.soft}px)`
    draw(x)
    x.restore()
    touch(l)
    app.hist!.raster(label, l, 'canvas', { x: 0, y: 0, w: l.canvas!.width, h: l.canvas!.height }, before)
    app.doc!.changed()
  }
  const fillSelection = () => {
    const doc = app.doc!
    if (!doc.selection) { toast('Select something first, for example with Object or Subject in Select'); return }
    const l = hlLayer()
    if (!l) return
    fillOn(l, x => {
      const t = copyCanvas(doc.selection!)
      const tx = ctx2d(t); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = rgba(app.fg, ho.opacity); tx.fillRect(0, 0, t.width, t.height)
      x.drawImage(t, 0, 0)
    }, 'Highlight selection')
  }

  const highlight: Tool = {
    id: 'highlight', label: 'Highlight', icon: 'hl',
    cursor: () => (ho.shape === 'brush' ? 'none' : 'crosshair'),
    down(p) {
      if (ho.shape === 'brush') {
        const l = hlLayer()
        if (!l) return
        bo.color = app.fg; bo.opacity = ho.opacity; bo.hardness = 1 - Math.min(1, ho.soft / 30)
        stroke = new Stroke(app.doc!, l, 'paint', bo, app.hist!, null, 'Highlight')
        app.stroke = stroke
        stroke.begin(p.x, p.y, p.p)
      } else { a = { x: p.x, y: p.y }; b = a }
    },
    move(p, pressed) {
      if (!pressed) return
      if (stroke) stroke.move(p.x, p.y, p.p)
      else if (a) b = { x: p.x, y: p.y }
    },
    up() {
      if (stroke) { stroke.end(); stroke = null; app.stroke = null; return }
      if (!a || !b || Math.abs(a.x - b.x) < 2 || Math.abs(a.y - b.y) < 2) { a = b = null; return }
      const l = hlLayer()
      const A = a, B = b
      a = b = null
      if (!l) return
      fillOn(l, x => { shapePath(x, ho.shape, A, B); x.fillStyle = rgba(app.fg, ho.opacity); x.fill() }, 'Highlight')
    },
    overlay(x, v) { if (a && b) dragOverlay(x, v, ho.shape, a, b); else if (ho.shape === 'brush') drawBrushCursor(x, v, bo.size) },
    panel: () => h('div', { class: 'ib' },
      sec('Highlight'),
      seg([['brush', 'Brush'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']], () => ho.shape, v => { ho.shape = v as Shape; app.view.updateCursor() }),
      ho.shape === 'brush' ? slider('Size', () => bo.size, v => (bo.size = v), { min: 2, max: 600 }) : null,
      slider('Opacity', () => Math.round(ho.opacity * 100), v => (ho.opacity = v / 100), { min: 5, max: 100, def: 35 }),
      slider('Softness', () => ho.soft, v => (ho.soft = v), { min: 0, max: 30, def: 0 }),
      toggle('Marker style (keeps text readable)', () => ho.marker, v => { ho.marker = v; const l = app.doc?.active; if (l?.kind === 'highlight') { l.blend = v ? 'multiply' : 'source-over'; app.doc!.changed() } }),
      btn('Highlight the selection', fillSelection, 'wide'),
      sec('Colour'), colorPanel(app))
  }

  const so = { dim: 0.6, soft: 24, shape: 'ellipse' as Shape }
  const spot = (draw: (x: CanvasRenderingContext2D) => void) => {
    const doc = app.doc!
    const before = snapshot(doc)
    const l = makeLayer('highlight', 'Spotlight', doc.w, doc.h)
    const x = ctx2d(l.canvas!)
    x.fillStyle = `rgba(0,0,0,${so.dim})`
    x.fillRect(0, 0, doc.w, doc.h)
    x.globalCompositeOperation = 'destination-out'
    x.filter = so.soft ? `blur(${so.soft}px)` : 'none'
    draw(x)
    doc.add(l)
    app.hist!.structural('Spotlight', before)
    doc.structure()
  }
  const spotlight: Tool = {
    id: 'spotlight', label: 'Spotlight', icon: 'spot',
    cursor: () => 'crosshair',
    down(p) { a = { x: p.x, y: p.y }; b = a },
    move(p, pressed) { if (pressed && a) b = { x: p.x, y: p.y } },
    up() {
      if (!a || !b || Math.abs(a.x - b.x) < 3) { a = b = null; return }
      const A = a, B = b
      a = b = null
      spot(x => { shapePath(x, so.shape, A, B); x.fill() })
    },
    overlay(x, v) { if (a && b) dragOverlay(x, v, so.shape, a, b) },
    panel: () => h('div', { class: 'ib' }, sec('Spotlight'),
      hint('Drag over the area to keep bright. Everything around it is dimmed.'),
      seg([['ellipse', 'Ellipse'], ['rect', 'Rectangle']], () => so.shape, v => (so.shape = v as Shape)),
      slider('Dim', () => Math.round(so.dim * 100), v => (so.dim = v / 100), { min: 5, max: 95, def: 60 }),
      slider('Softness', () => so.soft, v => (so.soft = v), { min: 0, max: 200, def: 24 }),
      btn('Spotlight the selection', () => {
        const s = app.doc?.selection
        if (!s) { toast('Select something first'); return }
        spot(x => x.drawImage(s, 0, 0))
      }, 'wide'),
      hint('Change the dimming later with the layer opacity.'))
  }

  const oo: OutlineOpts = { source: '', width: 8, color: '#ffffff', style: 'solid', position: 'outside', glow: 0, round: true }
  const createOutline = async (source: 'layer' | 'selection' | 'canvas') => {
    const doc = app.doc!
    let src = ''
    let alpha: HTMLCanvasElement | null = null
    if (source === 'canvas') src = 'canvas'
    else if (source === 'selection') {
      if (!doc.selection) { toast('Select something first'); return }
      src = 'selection'; alpha = copyCanvas(doc.selection)
    } else {
      const l = doc.active
      if (!l || !l.canvas || l.kind === 'outline' || l.kind === 'adjust') { toast('Select the layer to outline first'); return }
      src = l.id
    }
    await app.hist!.op('Add outline', () => {
      const l = makeLayer('outline', 'Outline', doc.w, doc.h)
      l.outline = { ...oo, source: src }
      l.maskAI = alpha
      const at = src !== 'canvas' && src !== 'selection' ? src : undefined
      doc.add(l, at)
    })
  }
  const outline: Tool = {
    id: 'outline', label: 'Outline', icon: 'outline',
    panel() {
      const doc = app.doc!
      const cur = doc.active?.kind === 'outline' ? doc.active : null
      const o = cur?.outline || oo
      let snap: any = null
      const ch = (fn: () => void) => () => { if (cur && !snap) snap = snapshot(doc); fn(); if (cur) { touch(cur); doc.changed() } }
      const end = () => { if (snap) { app.hist!.structural('Edit outline', snap); snap = null } }
      const controls = [
        slider('Thickness', () => o.width, v => ch(() => (o.width = v))(), { min: 1, max: 200, unit: 'px', onEnd: end }),
        seg([['outside', 'Outside'], ['center', 'Centre'], ['inside', 'Inside']], () => o.position, v => { ch(() => (o.position = v as any))(); end() }, 'Position'),
        seg([['solid', 'Solid'], ['dashed', 'Dashed']], () => o.style, v => { ch(() => (o.style = v as any))(); end() }, 'Style'),
        seg([['round', 'Rounded'], ['sharp', 'Sharp']], () => (o.round ? 'round' : 'sharp'), v => { ch(() => (o.round = v === 'round'))(); end() }, 'Corners'),
        slider('Glow', () => o.glow, v => ch(() => (o.glow = v))(), { min: 0, max: 100, unit: 'px', def: 0, onEnd: end }),
        sec('Colour'),
        colorWheel({ hex: o.color, alpha: 1 }, (s, fin) => { ch(() => (o.color = s.hex))(); if (fin) end() })
      ]
      if (cur) return h('div', { class: 'ib' }, sec('Edit outline'), hint('Changes apply to the selected outline layer.'), ...controls, btn('New outline', () => { doc.activeId = doc.layers.find(l => l.kind === 'image')?.id || doc.activeId; app.emit('layers') }, 'wide'))
      return h('div', { class: 'ib' },
        sec('Outline'),
        hint('Outlines follow the real edge of the subject. Remove the background or select an object first.'),
        h('div', { class: 'g2' },
          h('button', { class: 'pri', onclick: () => createOutline('layer') }, 'Outline layer'),
          btn('Outline selection', () => createOutline('selection'))),
        h('div', { class: 'g2' },
          h('button', { onclick: async () => { await selectSubject(app); if (app.doc?.selection) createOutline('selection') } }, icon('sparkle'), 'Find subject'),
          btn('Image border', () => createOutline('canvas'))),
        jobBox(app),
        sec('Look'), ...controls)
    }
  }
  return [highlight, spotlight, outline]
}
