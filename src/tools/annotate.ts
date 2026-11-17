import type { App } from '../app'
import type { Tool } from './types'
import { Layer, makeLayer, Shape, ShapeType, snapshot } from '../core/doc'
import { touch } from '../core/compose'
import { canRotate, newShape, shapeCenter, SHAPE_NAMES, textBox, turn } from '../core/shapes'
import { h } from '../ui/dom'
import { hint, sec, seg, select, slider, toggle } from '../ui/controls'
import { colorWheel } from '../ui/color'

const FONTS: [string, string][] = [['Inter', 'Inter'], ['Arial', 'Arial'], ['Helvetica', 'Helvetica'], ['Georgia', 'Georgia'], ['Times New Roman', 'Times New Roman'], ['Verdana', 'Verdana'], ['Trebuchet MS', 'Trebuchet MS'], ['Courier New', 'Courier New'], ['Impact', 'Impact']]
const ICONS: Record<ShapeType, string> = { text: 'text', arrow: 'arrow', line: 'line', rect: 'rect', ellipse: 'ellipse', callout: 'callout', label: 'label', marker: 'marker' }

export function annotateTools(app: App): Tool[] {
  const style: Partial<Shape> = {}
  let editor: HTMLTextAreaElement | null = null
  let placeEditor: (() => void) | null = null

  const editText = (l: Layer) => {
    closeEditor()
    const s = l.shape!
    if (!['text', 'callout', 'label'].includes(s.type)) return
    const doc = app.doc!
    const before = snapshot(doc)
    const v = app.view
    const ta = h('textarea', { class: 'textedit', value: s.text, spellcheck: false }) as HTMLTextAreaElement
    const place = () => {
      const x = document.createElement('canvas').getContext('2d')!
      const b = textBox(x, s)
      const rot = s.rot || 0
      const tl = turn(s.type === 'callout' ? Math.min(s.x1, s.x2) : s.x1, s.type === 'callout' ? Math.min(s.y1, s.y2) : s.y1, shapeCenter(s, x), (rot * Math.PI) / 180)
      const p = v.screenOf(tl.x, tl.y)
      const deg = (v.flip ? -rot : rot) + v.angle
      Object.assign(ta.style, {
        left: p.x + 'px', top: p.y + 'px', transformOrigin: '0 0', transform: v.rotated || rot ? `rotate(${deg}deg)${v.flip ? ' scaleX(-1)' : ''}` : '', width: Math.max(40, (s.type === 'callout' ? Math.abs(s.x2 - s.x1) : b.w + s.size) * v.zoom) + 'px',
        height: Math.max(20, (s.type === 'callout' ? Math.abs(s.y2 - s.y1) : b.h + s.size * 0.3) * v.zoom) + 'px',
        font: `${s.italic ? 'italic ' : ''}${s.bold ? 600 : 400} ${s.size * v.zoom}px "${s.font}"`, color: 'transparent', caretColor: s.color === '#ffffff' ? '#fff' : s.color,
        textAlign: s.align
      })
    }
    ta.addEventListener('input', () => { s.text = ta.value; touch(l); doc.changed(); place() })
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') ta.blur() })
    ta.addEventListener('blur', () => {
      if (!s.text.trim() && s.type === 'text') { doc.layers = doc.layers.filter(x => x !== l); doc.activeId = doc.layers[doc.layers.length - 1].id }
      app.hist!.structural('Edit text', before)
      doc.structure()
      closeEditor()
    })
    app.view.desk.appendChild(ta)
    editor = ta
    placeEditor = place
    place()
    setTimeout(() => { ta.focus(); ta.select() }, 0)
  }
  const closeEditor = () => { if (editor) { const e = editor; editor = null; placeEditor = null; e.blur(); e.remove() } }
  // The editor sits over the text on screen, so it follows every pan, zoom and view rotation.
  let rafPlace = 0
  app.on('view', () => { if (placeEditor && !rafPlace) rafPlace = requestAnimationFrame(() => { rafPlace = 0; placeEditor?.() }) })
  app.on('doc', closeEditor)

  const make = (type: ShapeType): Tool => {
    let cur: Layer | null = null, start: any = null, before: any = null
    return {
      id: type, label: SHAPE_NAMES[type], icon: ICONS[type],
      cursor: () => (type === 'text' ? 'text' : 'crosshair'),
      down(p) {
        if (editor) { closeEditor(); return }
        const doc = app.doc!
        const hit = [...doc.layers].reverse().find(l => l.shape && l.visible && l.shape.type === type && ['text', 'label', 'callout'].includes(type) && (() => {
          const s = l.shape!, x = document.createElement('canvas').getContext('2d')!, b = textBox(x, s)
          const L = type === 'callout' ? Math.min(s.x1, s.x2) : s.x1, T = type === 'callout' ? Math.min(s.y1, s.y2) : s.y1
          const W = type === 'callout' ? Math.abs(s.x2 - s.x1) : b.w, H = type === 'callout' ? Math.abs(s.y2 - s.y1) : b.h
          return p.x >= L && p.y >= T && p.x <= L + W && p.y <= T + H
        })())
        if (hit) { doc.activeId = hit.id; app.emit('layers'); editText(hit); return }
        before = snapshot(doc)
        const sc = Math.max(doc.w, doc.h) / 1400
        const s = { ...newShape(type, p.x, p.y, app.fg, sc), ...style } as Shape
        s.x1 = s.x2 = p.x; s.y1 = s.y2 = p.y
        if (type === 'marker') s.num = Math.max(0, ...doc.layers.filter(l => l.shape?.type === 'marker').map(l => l.shape!.num)) + 1
        if (type === 'label' || type === 'callout') { s.fill = style.fill || '#ffffff'; s.color = style.color || '#111111' }
        if (type === 'text') s.color = app.fg
        else if (type !== 'label' && type !== 'callout' && type !== 'marker') s.stroke = app.fg
        else if (type === 'marker') s.fill = app.fg
        const l = makeLayer(type === 'text' ? 'text' : 'shape', SHAPE_NAMES[type], doc.w, doc.h)
        l.shape = s
        doc.add(l, doc.activeId)
        cur = l; start = { x: p.x, y: p.y }
        touch(l); doc.changed(); app.emit('layers')
      },
      move(p, pressed) {
        if (!pressed || !cur || !start) return
        const s = cur.shape!
        let x = p.x, y = p.y
        if (p.e.shiftKey && (type === 'line' || type === 'arrow')) { const a = Math.round(Math.atan2(y - start.y, x - start.x) / (Math.PI / 4)) * (Math.PI / 4), d = Math.hypot(x - start.x, y - start.y); x = start.x + Math.cos(a) * d; y = start.y + Math.sin(a) * d }
        if (p.e.shiftKey && (type === 'rect' || type === 'ellipse')) { const d = Math.max(Math.abs(x - start.x), Math.abs(y - start.y)); x = start.x + Math.sign(x - start.x || 1) * d; y = start.y + Math.sign(y - start.y || 1) * d }
        if (type === 'text' || type === 'label' || type === 'marker') { s.x1 = x; s.y1 = y }
        else { s.x2 = x; s.y2 = y }
        touch(cur); app.doc!.changed()
      },
      up() {
        if (!cur) return
        const s = cur.shape!, doc = app.doc!
        const tiny = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) < 4
        if (tiny && !['text', 'label', 'marker'].includes(type)) {
          const sz = Math.max(doc.w, doc.h) / 8
          if (type === 'arrow' || type === 'line') { s.x2 = s.x1 + sz; s.y2 = s.y1 - sz * 0.5 }
          else { s.x2 = s.x1 + sz * (type === 'callout' ? 1.6 : 1.2); s.y2 = s.y1 + sz * (type === 'callout' ? 0.6 : 0.8) }
          touch(cur); doc.changed()
        }
        app.hist!.structural('Add ' + SHAPE_NAMES[type].toLowerCase(), before)
        const l = cur
        cur = null; start = null
        doc.structure()
        if (['text', 'callout', 'label'].includes(type)) editText(l)
      },
      dbl(p) { const l = app.doc?.active; if (l?.shape) editText(l) },
      deactivate: closeEditor,
      overlay(x, v) {
        const l = app.doc?.active
        if (!l?.shape || editor) return
        const s = l.shape
        x.save(); x.strokeStyle = '#8AA7D9'; x.setLineDash([4, 3])
        const a = v.toScreen(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2)), b = v.toScreen(Math.max(s.x1, s.x2), Math.max(s.y1, s.y2))
        if (b.x - a.x > 2) x.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
        x.restore()
      },
      panel: () => shapePanel(app, type, style, editText)
    }
  }
  return (['text', 'arrow', 'line', 'rect', 'ellipse', 'callout', 'label', 'marker'] as ShapeType[]).map(make)
}

function shapePanel(app: App, type: ShapeType, style: Partial<Shape>, editText: (l: Layer) => void) {
  const doc = app.doc!
  const l = doc.active?.shape && doc.active.shape.type === type ? doc.active : null
  const s: Partial<Shape> = l ? l.shape! : style
  const def = newShape(type, 0, 0, app.fg, Math.max(doc.w, doc.h) / 1400)
  const g = <K extends keyof Shape>(k: K) => (s[k] ?? def[k]) as Shape[K]
  let snap: any = null
  const set = <K extends keyof Shape>(k: K, v: Shape[K]) => {
    if (l && !snap) snap = snapshot(doc)
    ;(s as any)[k] = v
    if (l) { touch(l); doc.changed() }
  }
  const end = () => { if (snap) { app.hist!.structural('Edit ' + SHAPE_NAMES[type].toLowerCase(), snap); snap = null } }
  const hasText = ['text', 'callout', 'label'].includes(type)
  const out: (HTMLElement | null | false)[] = [sec(l ? 'Edit ' + SHAPE_NAMES[type].toLowerCase() : SHAPE_NAMES[type])]
  if (!l) out.push(hint(type === 'text' ? 'Click the image to add text.' : ['label', 'marker'].includes(type) ? 'Click the image to place it.' : 'Drag on the image to draw it.'))
  if (hasText && l) {
    const ta = h('textarea', { value: g('text'), rows: 3 }) as HTMLTextAreaElement
    ta.addEventListener('input', () => set('text', ta.value))
    ta.addEventListener('change', end)
    ta.addEventListener('keydown', e => e.stopPropagation())
    out.push(ta)
  }
  if (type === 'marker' && l) out.push(slider('Number', () => g('num'), v => set('num', v), { min: 0, max: 99, onEnd: end }))
  if (hasText || type === 'marker') {
    out.push(select('Font', FONTS, () => g('font'), v => { set('font', v); end() }))
    out.push(slider('Size', () => Math.round(g('size')), v => set('size', v), { min: 6, max: 600, onEnd: end }))
  }
  if (hasText) {
    out.push(h('div', { class: 'seg' },
      ...(['bold', 'italic'] as const).map(k => { const b = h('button', { class: g(k) ? 'on' : '', onclick: () => { set(k, !g(k)); b.classList.toggle('on', !!g(k)); end() } }, k === 'bold' ? 'Bold' : 'Italic'); return b })))
    out.push(seg([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], () => g('align'), v => { set('align', v as any); end() }, 'Align'))
    out.push(slider('Outline', () => g('outline'), v => set('outline', v), { min: 0, max: 40, def: 0, onEnd: end }))
  }
  if (type !== 'text') {
    out.push(slider('Line width', () => g('width'), v => set('width', v), { min: 0, max: 80, onEnd: end }))
    if (type !== 'marker' && type !== 'label') out.push(toggle('Dashed', () => g('dash'), v => { set('dash', v); end() }))
  }
  if (l && canRotate(l.shape!)) out.push(slider('Rotation', () => Math.round(g('rot') || 0), v => set('rot', v), { min: -180, max: 180, def: 0, unit: '°', onEnd: end }))
  if (type === 'rect' || type === 'callout' || type === 'label') out.push(slider('Corners', () => g('radius'), v => set('radius', v), { min: 0, max: 200, onEnd: end }))
  if (type === 'rect' || type === 'ellipse' || type === 'callout' || type === 'label') out.push(toggle('Fill', () => g('fillOn'), v => { set('fillOn', v); end() }))
  out.push(toggle('Shadow', () => g('shadow'), v => { set('shadow', v); end() }))
  if (l) out.push(slider('Opacity', () => Math.round(l.opacity * 100), v => { if (!snap) snap = snapshot(doc); l.opacity = v / 100; doc.changed() }, { min: 0, max: 100, onEnd: end }))
  const colorKeys: [keyof Shape, string][] = type === 'text' ? [['color', 'Text']] : type === 'marker' ? [['fill', 'Fill'], ['color', 'Number']] : hasText ? [['fill', 'Fill'], ['color', 'Text'], ['stroke', 'Line']] : type === 'rect' || type === 'ellipse' ? [['stroke', 'Line'], ['fill', 'Fill']] : [['stroke', 'Colour']]
  if (hasText) colorKeys.push(['outlineColor', 'Outline'])
  let ck = colorKeys[0][0]
  const wheel = colorWheel({ hex: String(g(ck)), alpha: 1 }, (st, fin) => { set(ck, st.hex as any); if (fin) end(); if (!l && ck === colorKeys[0][0] && type !== 'label' && type !== 'callout') app.setColors(st.hex) })
  out.push(sec('Colour'))
  if (colorKeys.length > 1) out.push(seg(colorKeys.map(([k, t]) => [k as string, t]) as [string, string][], () => ck as string, v => { ck = v as keyof Shape; (wheel as any).set(String(g(ck))) }))
  out.push(wheel)
  if (l && hasText) out.push(h('button', { class: 'wide', onclick: () => editText(l) }, 'Edit on the image'))
  return h('div', { class: 'ib' }, ...out.filter(Boolean) as HTMLElement[])
}
