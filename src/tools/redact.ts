import type { App } from '../app'
import type { Tool } from './types'
import type { Layer } from '../core/doc'
import { touch } from '../core/compose'
import { canvas, ctx2d, getData } from '../core/util'
import { toolSteps } from '../core/steps'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider } from '../ui/controls'
import { ai, jobBox, rgbaOf } from './common'
import { targetLayer } from './background'
import { gaussianBlur, pixelate } from './filters'
import { selectionBBox } from './select'
import { tr, tn } from '../i18n'

export type RedactStyle = 'box' | 'blur' | 'pixel'
export interface RedactOpts { style: RedactStyle; strength: number; shape: 'rect' | 'ellipse'; pad: number; color: string }
interface Area { box: number[]; on: boolean; src: 'face' | 'person' | 'box' }

/** Finds faces (or people) in what the image shows and returns their boxes in image pixels. */
export async function findAreas(app: App, what: 'face' | 'person', prog: (p: number | null, d?: string) => void): Promise<number[][]> {
  const doc = app.doc!
  const src = rgbaOf(doc.comp, what === 'face' ? 3000 : 1200)
  const s = doc.w / src.w
  if (what === 'face') {
    const r = await ai(app, 'faces', { ...src, threshold: 0.5 }, prog)
    return r.map((f: any) => f.box.map((v: number) => v * s))
  }
  const r = await ai(app, 'detect', { ...src, threshold: 0.7 }, prog)
  return r.filter((f: any) => f.label === 'person').map((f: any) => f.box.map((v: number) => v * s))
}

/** Blacks out, blurs or pixelates the given boxes on layer l, for good: the hidden pixels are replaced. */
export function redactLayer(app: App, l: Layer, boxes: number[][], o: RedactOpts) {
  const doc = app.doc!
  if (!boxes.length || !l.canvas) return
  const before = getData(l.canvas)
  const c = l.canvas, x = ctx2d(c)
  const shapePath = (b: number[]) => {
    const p = new Path2D()
    const w = b[2] - b[0], hh = b[3] - b[1]
    if (o.shape === 'ellipse') p.ellipse(b[0] + w / 2, b[1] + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2)
    else p.rect(b[0], b[1], w, hh)
    return p
  }
  const padded = boxes.map(b => {
    const w = b[2] - b[0], hh = b[3] - b[1], p = Math.max(w, hh) * (o.pad / 100)
    return [Math.max(0, b[0] - p), Math.max(0, b[1] - p), Math.min(doc.w, b[2] + p), Math.min(doc.h, b[3] + p)]
  }).filter(b => b[2] - b[0] >= 1 && b[3] - b[1] >= 1)
  for (const b of padded) {
    const w = b[2] - b[0], hh = b[3] - b[1], side = Math.min(w, hh)
    x.save()
    x.clip(shapePath(b))
    if (o.style === 'box') { x.fillStyle = o.color; x.fillRect(b[0], b[1], w, hh) }
    else {
      // Work on the box with a margin, so a blur has real pixels to draw from at its edges.
      const m = Math.ceil(side * 0.5)
      const rx = Math.max(0, Math.floor(b[0] - m)), ry = Math.max(0, Math.floor(b[1] - m))
      const rw = Math.min(doc.w, Math.ceil(b[2] + m)) - rx, rh = Math.min(doc.h, Math.ceil(b[3] + m)) - ry
      const part = canvas(rw, rh)
      ctx2d(part).drawImage(c, rx, ry, rw, rh, 0, 0, rw, rh)
      let out: HTMLCanvasElement
      if (o.style === 'blur') {
        // Strong enough that the shapes underneath can't be made out, then pixelated slightly so it can't be undone by sharpening.
        const r = Math.max(4, side * (o.strength / 100) * 0.35)
        out = pixelate(gaussianBlur(part, r), Math.max(2, Math.round(r / 3)))
        out = gaussianBlur(out, Math.max(1, r / 4))
      } else out = pixelate(part, Math.max(4, Math.round(side * (o.strength / 100) * 0.3)))
      x.clearRect(rx, ry, rw, rh)
      x.drawImage(out, rx, ry)
    }
    x.restore()
  }
  touch(l)
  app.hist!.raster(tr('Redact'), l, 'canvas', { x: 0, y: 0, w: before.width, h: before.height }, before)
  doc.changed()
}

export function redactTools(app: App): Tool[] {
  const o: RedactOpts = { style: 'blur', strength: 60, shape: 'rect', pad: 12, color: '#000000' }
  let areas: Area[] = []
  /** What was searched for, so an action can search again on another image. */
  let found = new Set<'face' | 'person'>()
  let drag: { x: number; y: number; ex: number; ey: number } | null = null
  const steps = toolSteps(app, () => areas.map(a => ({ ...a, box: [...a.box] })), v => { areas = v; app.emit('panel') })
  const on = () => areas.filter(a => a.on)
  const hitArea = (x: number, y: number) => [...areas].reverse().find(a => x >= a.box[0] && y >= a.box[1] && x <= a.box[2] && y <= a.box[3])

  const find = (what: 'face' | 'person') => app.run(what === 'face' ? tr('Looking for faces') : tr('Looking for people'), async p => {
    const boxes = await findAreas(app, what, p)
    steps.mark()
    // A box already in the list (from an earlier search) is not added twice.
    const dup = (b: number[]) => areas.some(a => Math.abs(a.box[0] - b[0]) + Math.abs(a.box[1] - b[1]) + Math.abs(a.box[2] - b[2]) + Math.abs(a.box[3] - b[3]) < 8)
    for (const b of boxes) if (!dup(b)) areas.push({ box: b, on: true, src: what })
    found.add(what)
    if (!boxes.length) toast(what === 'face' ? tr('No faces found') : tr('No people found'))
    else toast(what === 'face' ? tn(boxes.length, 'Found {0} face', 'Found {0} faces') : tn(boxes.length, 'Found {0} person', 'Found {0} people'))
    app.view.draw()
  })

  const apply = () => {
    const l = targetLayer(app)
    if (!l) { toast(tr('Select an image layer first')); return }
    if (l.locked) { toast(tr('{0} is locked', l.name)); return }
    const list = on()
    if (!list.length) { toast(tr('Draw a box over what to hide, or find faces first')); return }
    const doc = app.doc!
    // Boxes drawn by hand are kept relative to the image, so an action can reuse them on a screenshot of the same layout.
    const manual = list.filter(a => a.src === 'box').map(a => [a.box[0] / doc.w, a.box[1] / doc.h, a.box[2] / doc.w, a.box[3] / doc.h])
    app.record({ kind: 'redact', o: { ...o }, find: [...found].filter(w => list.some(a => a.src === w)), boxes: manual })
    redactLayer(app, l, list.map(a => a.box), o)
    areas = []; found = new Set(); steps.reset()
    app.emit('panel'); app.view.draw()
    toast(tn(list.length, 'Redacted {0} area', 'Redacted {0} areas'))
  }

  const redact: Tool = {
    id: 'redact', label: tr('Redact'), icon: 'redact', steps,
    activate() { areas = []; found = new Set(); steps.reset() },
    cursor: p => (p && hitArea(p.x, p.y) ? 'pointer' : 'crosshair'),
    down(p) { drag = { x: p.x, y: p.y, ex: p.x, ey: p.y } },
    move(p, pressed) { if (pressed && drag) { drag.ex = p.x; drag.ey = p.y; app.view.draw() } },
    up() {
      const d = drag
      drag = null
      if (!d) return
      const doc = app.doc!
      const z = app.view.zoom
      if (Math.abs(d.ex - d.x) * z < 4 && Math.abs(d.ey - d.y) * z < 4) {
        const a = hitArea(d.x, d.y)
        if (a) { steps.mark(); a.on = !a.on; app.emit('panel') }
        app.view.draw()
        return
      }
      const b = [Math.max(0, Math.min(d.x, d.ex)), Math.max(0, Math.min(d.y, d.ey)), Math.min(doc.w, Math.max(d.x, d.ex)), Math.min(doc.h, Math.max(d.y, d.ey))]
      if (b[2] - b[0] < 1 || b[3] - b[1] < 1) return
      steps.mark()
      areas.push({ box: b, on: true, src: 'box' })
      app.emit('panel'); app.view.draw()
    },
    key(e) {
      if (e.key === 'Enter') { apply(); return true }
      if (e.key === 'Escape' && areas.length) { steps.mark(); areas = []; app.emit('panel'); app.view.draw(); return true }
      return false
    },
    overlay(x, v) {
      x.save()
      const pad = (b: number[]) => { const w = b[2] - b[0], hh = b[3] - b[1], p = Math.max(w, hh) * (o.pad / 100); return [b[0] - p, b[1] - p, b[2] + p, b[3] + p] }
      const draw = (b: number[], active: boolean) => {
        const q = pad(b)
        const a = v.toScreen(q[0], q[1]), c = v.toScreen(q[2], q[3])
        x.beginPath()
        if (o.shape === 'ellipse') x.ellipse((a.x + c.x) / 2, (a.y + c.y) / 2, Math.abs(c.x - a.x) / 2, Math.abs(c.y - a.y) / 2, 0, 0, Math.PI * 2)
        else x.rect(a.x, a.y, c.x - a.x, c.y - a.y)
        x.fillStyle = active ? (o.style === 'box' ? o.color + 'cc' : 'rgba(229,72,77,.28)') : 'rgba(255,255,255,.08)'
        x.fill()
        x.lineWidth = active ? 2 : 1
        x.setLineDash(active ? [] : [4, 3])
        x.strokeStyle = active ? '#e5484d' : 'rgba(255,255,255,.6)'
        x.stroke()
      }
      for (const a of areas) draw(a.box, a.on)
      if (drag) draw([Math.min(drag.x, drag.ex), Math.min(drag.y, drag.ey), Math.max(drag.x, drag.ex), Math.max(drag.y, drag.ey)], true)
      x.restore()
    },
    panel() {
      const l = targetLayer(app)
      const n = on().length
      return h('div', { class: 'ib' },
        sec(tr('Redact')),
        hint(tr('Hides faces, names and other private details for good. Drag boxes over what to hide, or let CocoaShot find faces. Click a box to leave it out.')),
        h('div', { class: 'g2' },
          h('button', { onclick: () => find('face') }, icon('sparkle'), tr('Find faces')),
          h('button', { onclick: () => find('person') }, icon('person'), tr('Find people')),
          btn(tr('Use selection'), () => {
            const b = selectionBBox(app.doc!)
            if (!b) { toast(tr('Make a selection first')); return }
            steps.mark(); areas.push({ box: [b.x, b.y, b.x + b.w, b.y + b.h], on: true, src: 'box' }); app.emit('panel'); app.view.draw()
          }),
          btn(tr('Clear boxes'), () => { if (areas.length) { steps.mark(); areas = []; found = new Set(); app.emit('panel'); app.view.draw() } })),
        jobBox(app),
        sec(tr('Style')),
        seg<RedactStyle>([['box', tr('Solid box')], ['blur', tr('Blur')], ['pixel', tr('Pixelate')]], () => o.style, v => { o.style = v; app.emit('panel'); app.view.draw() }),
        o.style === 'box'
          ? h('div', { class: 'fr' }, h('label', tr('Colour')), h('input', { type: 'color', value: o.color, oninput: (e: Event) => { o.color = (e.target as HTMLInputElement).value; app.view.draw() } }))
          : slider(tr('Strength'), () => o.strength, v => (o.strength = v), { min: 20, max: 100, def: 60, unit: '%' }),
        seg<'rect' | 'ellipse'>([['rect', tr('Rectangle')], ['ellipse', tr('Ellipse')]], () => o.shape, v => { o.shape = v; app.view.draw() }, tr('Shape')),
        slider(tr('Margin'), () => o.pad, v => { o.pad = v; app.view.draw() }, { min: 0, max: 50, def: 12, unit: '%' }),
        o.style !== 'box' ? hint(tr('For text such as names, numbers or addresses, Solid box is the safest: it leaves nothing to recover.')) : null,
        areas.length > 0 && hint(tr('{0} of {1} boxes will be hidden.', n, areas.length)),
        l ? hint(tr('Changes the layer {0}.', l.name)) : null,
        h('button', { class: 'pri big wide', disabled: !n, onclick: apply }, icon('redact'), n ? tn(n, 'Redact {0} area', 'Redact {0} areas') : tr('Redact')))
    }
  }
  return [redact]
}
