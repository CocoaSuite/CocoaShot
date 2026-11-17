import type { App } from '../app'
import type { Tool } from './types'
import { Blend, Layer, shownVisible } from '../core/doc'
import { flatten, touch } from '../core/compose'
import { Stroke, BrushMode, BrushOpts } from '../core/brush'
import { flood } from '../core/px'
import { canvasFromAlpha, ctx2d, getData, rgba } from '../core/util'
import { h, toast } from '../ui/dom'
import { keyOf } from '../ui/keys'
import { btn, hint, sec, select, slider, toggle } from '../ui/controls'
import { brushControls, colorPanel, drawBrushCursor, stabilizer } from './common'

export const BLENDS: [Blend, string][] = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['soft-light', 'Soft light'], ['hard-light', 'Hard light'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Colour dodge'], ['color-burn', 'Colour burn'], ['difference', 'Difference'], ['color', 'Colour'], ['luminosity', 'Luminosity']]

export function layerOptions(app: App) {
  const l = app.doc?.active
  if (!l || !l.canvas) return []
  const ch = (label: string, fn: () => void) => app.hist!.op(label, fn)
  return [sec('Layer: ' + l.name),
    toggle('Lock transparency', () => l.alphaLock, v => ch(v ? 'Lock transparency' : 'Unlock transparency', () => { l.alphaLock = v })),
    toggle('Clip to layer below', () => l.clip, v => ch(v ? 'Clip to layer below' : 'Release clipping', () => { l.clip = v })),
    select('Blend', BLENDS, () => l.blend, v => ch('Blend mode', () => { l.blend = v })),
    btn('New paint layer', () => app.emit('new-layer'), 'wide')]
}

/** Clone options: keep the source's distance between strokes, and copy from the whole image rather than one layer. */
const cloneO = { aligned: true, all: false }

const base = (o: Partial<BrushOpts>): BrushOpts => ({ size: 24, opacity: 1, hardness: 0.8, flow: 1, spacing: 0.12, color: '#000', pressure: true, pencil: false, strength: 0.5, ...o })

export function paintTools(app: App): Tool[] {
  const brushTool = (id: string, label: string, ic: string, mode: BrushMode, o: BrushOpts, cfg: { color?: boolean; hardness?: boolean; flow?: boolean; strength?: boolean; newLayer?: boolean; hint?: string } = {}): Tool => {
    let st: Stroke | null = null
    let src: { x: number; y: number } | null = null
    /** Clone: how far the source sits from the brush, kept between strokes when aligned. */
    let off: { x: number; y: number } | null = null
    let setting = false
    let lastPt: { x: number; y: number; l: any } | null = null
    const stab = stabilizer(() => app.settings.stabilizer || 0)
    const t: Tool = {
      id, label, icon: ic, altPick: mode === 'paint',
      cursor: () => 'none',
      brush: () => ({
        getSize: () => o.size, setSize: v => { o.size = v }, getOpacity: () => o.opacity, setOpacity: v => { o.opacity = v },
        color: () => (mode === 'paint' ? app.fg : undefined), altClick: mode === 'clone', opts: o
      }),
      down(p) {
        if (mode === 'clone' && (p.e.altKey || setting)) { src = { x: p.x, y: p.y }; off = null; setting = false; app.emit('panel'); return }
        if (mode === 'clone' && !src) { toast('Set the clone source first'); return }
        let l: Layer | null
        const a = app.doc!.active
        const paintable = a && a.canvas && !a.locked && (a.kind === 'paint' || a.kind === 'highlight' || (a.kind === 'image' && (a.alphaLock || a.clip)))
        if (cfg.newLayer && !paintable) l = app.newPaintLayer()
        else l = app.activeRaster()
        if (!l) return
        o.color = app.fg
        if (!shownVisible(app.doc!, l)) toast(`${l.name} is hidden, so the painting won't show`)
        // Aligned: the source keeps its distance from the brush across strokes. Otherwise every stroke starts at the source point.
        const from = mode !== 'clone' ? null : cloneO.aligned && off ? { x: p.x + off.x, y: p.y + off.y } : src
        if (mode === 'clone' && from) off = { x: from.x - p.x, y: from.y - p.y }
        st = new Stroke(app.doc!, l, mode, o, app.hist!, from, label, mode === 'clone' && cloneO.all ? flatten(app.doc!) : null)
        app.stroke = st
        if (p.e.shiftKey && lastPt && lastPt.l === l) { st.begin(lastPt.x, lastPt.y, p.p); st.move(p.x, p.y, p.p) }
        else st.begin(p.x, p.y, p.p)
        stab.start(p.x, p.y, p.p)
      },
      move(p, pressed) { if (pressed && st) { const q = stab.step(p.x, p.y, p.p); st.move(q.x, q.y, q.p) } },
      up() {
        if (!st) return
        if (st.last) lastPt = { x: st.last.x, y: st.last.y, l: st.layer }
        st.end()
        st = null; app.stroke = null
      },
      overlay(x, v) {
        drawBrushCursor(x, v, o.size)
        const at = st?.cloneOff && st.last ? { x: st.last.x + st.cloneOff.x, y: st.last.y + st.cloneOff.y } : cloneO.aligned && off && v.hover ? { x: v.hover.x + off.x, y: v.hover.y + off.y } : src
        if (mode === 'clone' && at) {
          const s = v.toScreen(at.x, at.y)
          x.save(); x.strokeStyle = '#fff'; x.lineWidth = 1.5
          x.beginPath(); x.moveTo(s.x - 8, s.y); x.lineTo(s.x + 8, s.y); x.moveTo(s.x, s.y - 8); x.lineTo(s.x, s.y + 8); x.stroke(); x.restore()
        }
      },
      key(e) {
        const k = keyOf(e)
        if (k === '[') { o.size = Math.max(1, Math.round(o.size / 1.2)); app.emit('panel'); app.view.draw(); return true }
        if (k === ']') { o.size = Math.min(1000, Math.round(o.size * 1.2 + 1)); app.emit('panel'); app.view.draw(); return true }
        return false
      },
      panel: () => h('div', { class: 'ib' },
        sec(label),
        cfg.hint && hint(cfg.hint),
        mode === 'clone' && h('div', { class: 'g2' }, h('button', { class: setting ? 'on' : '', onclick: () => { setting = true; app.emit('panel') } }, src ? 'Change source' : 'Set source'), h('span', { class: 'hint', style: { alignSelf: 'center' } }, setting ? 'Click the area to copy from' : src ? 'Source set' : 'No source yet')),
        mode === 'clone' && toggle('Aligned', () => cloneO.aligned, v => { cloneO.aligned = v; off = null }),
        mode === 'clone' && toggle('Sample all layers', () => cloneO.all, v => (cloneO.all = v)),
        ...brushControls(app, o, { hardness: cfg.hardness, flow: cfg.flow, strength: cfg.strength }),
        cfg.color && sec('Colour'), cfg.color && colorPanel(app, false),
        ...layerOptions(app))
    }
    return t
  }

  const fillO = { tol: 32, contiguous: true, merged: false, opacity: 1 }
  const fill: Tool = {
    id: 'fill', label: 'Fill', icon: 'bucket', altPick: true,
    cursor: () => 'crosshair',
    down(p) {
      const doc = app.doc!
      let l = app.activeRaster()
      if (!l) return
      if (!shownVisible(doc, l)) toast(`${l.name} is hidden, so the fill won't show`)
      const x0 = Math.floor(p.x), y0 = Math.floor(p.y)
      if (x0 < 0 || y0 < 0 || x0 >= doc.w || y0 >= doc.h) return
      const data = getData(fillO.merged ? doc.comp : l.canvas!).data
      const m = canvasFromAlpha(flood(data, doc.w, doc.h, x0, y0, fillO.tol, fillO.contiguous), doc.w, doc.h)
      const mx = ctx2d(m)
      if (doc.selection) { mx.globalCompositeOperation = 'destination-in'; mx.drawImage(doc.selection, 0, 0) }
      mx.globalCompositeOperation = 'source-in'
      mx.fillStyle = rgba(app.fg, fillO.opacity)
      mx.fillRect(0, 0, doc.w, doc.h)
      const before = getData(l.canvas!)
      const x = ctx2d(l.canvas!)
      x.save(); if (l.alphaLock) x.globalCompositeOperation = 'source-atop'
      x.drawImage(m, 0, 0); x.restore()
      touch(l)
      app.hist!.raster('Fill', l, 'canvas', { x: 0, y: 0, w: doc.w, h: doc.h }, before)
      doc.changed()
    },
    panel: () => h('div', { class: 'ib' }, sec('Fill'),
      slider('Tolerance', () => fillO.tol, v => (fillO.tol = v), { min: 0, max: 255, def: 32 }),
      slider('Opacity', () => Math.round(fillO.opacity * 100), v => (fillO.opacity = v / 100), { min: 1, max: 100 }),
      toggle('Connected areas only', () => fillO.contiguous, v => (fillO.contiguous = v)),
      toggle('Sample all layers', () => fillO.merged, v => (fillO.merged = v)),
      sec('Colour'), colorPanel(app), ...layerOptions(app))
  }

  let back: string | null = null
  app.on('pick-once', () => { back = app.toolId; app.setTool('picker') })
  const picker: Tool = {
    id: 'picker', label: 'Colour picker', icon: 'dropper',
    cursor: () => 'crosshair',
    down(p) {
      const c = app.sampleColor(p.x, p.y)
      if (!c) return
      if (p.e.altKey) app.setColors(app.fg, c)
      else app.setColors(c)
      if (back) { const b = back; back = null; app.setTool(b) }
    },
    panel: () => h('div', { class: 'ib' }, sec('Colour picker'), hint('Click the image to pick a colour.'), colorPanel(app))
  }

  return [
    brushTool('brush', 'Brush', 'brush', 'paint', base({ size: 24, hardness: 0.7 }), { color: true, flow: true, newLayer: true }),
    brushTool('pencil', 'Pencil', 'pencil', 'paint', base({ size: 3, hardness: 1, pencil: true, spacing: 0.05, pressure: false }), { color: true, hardness: false, newLayer: true }),
    brushTool('eraser', 'Eraser', 'eraser', 'erase', base({ size: 40, hardness: 0.7 }), { flow: true }),
    fill, picker,
    brushTool('clone', 'Clone', 'clone', 'clone', base({ size: 60, hardness: 0.5 }), { hint: 'Paints a copy of another part of the image.' }),
    brushTool('blur', 'Blur', 'blur', 'blur', base({ size: 60, hardness: 0.3, strength: 0.6 }), { strength: true, hardness: true }),
    brushTool('sharpen', 'Sharpen', 'sharpen', 'sharpen', base({ size: 60, hardness: 0.3, strength: 0.5 }), { strength: true }),
    brushTool('smudge', 'Smudge', 'smudge', 'smudge', base({ size: 40, hardness: 0.4, strength: 0.6, spacing: 0.08 }), { strength: true })
  ]
}
