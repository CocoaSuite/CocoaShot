import type { App } from '../app'
import type { Tool } from './types'
import { Adjust, ADJUST0, Doc, Layer, makeLayer, snapshot } from '../core/doc'
import { compose } from '../core/compose'
import { histogramStats } from '../core/px'
import { canvas, clamp, getData } from '../core/util'
import { h, icon } from '../ui/dom'
import { btn, sec, slider } from '../ui/controls'

export function adjLayer(app: App, create: boolean): Layer | null {
  const doc = app.doc!
  if (doc.active?.kind === 'adjust') return doc.active
  const top = [...doc.layers].reverse().find(l => l.kind === 'adjust')
  if (top || !create) return top || null
  const l = makeLayer('adjust', 'Adjustments', doc.w, doc.h, false)
  l.adjust = { ...ADJUST0, levels: [...ADJUST0.levels] }
  doc.layers.push(l)
  return l
}

function statsBelow(doc: Doc, l: Layer | null) {
  const c = canvas(doc.w, doc.h)
  compose(doc, c, null, { upTo: l?.id })
  return histogramStats(getData(c).data)
}

export function autoAdjust(doc: Doc, l: Layer | null, kind: 'enhance' | 'wb' | 'contrast' | 'color'): Partial<Adjust> {
  const s = statsBelow(doc, l)
  if (!s.n) return {}
  const [R, G, B] = s.mean
  const wb = () => ({ temperature: clamp(Math.round(((B - R) / (0.22 * (R + B))) * 100), -60, 60), tint: clamp(Math.round((((R + B) / 2 / G - 1) / 0.18) * 100), -60, 60) })
  if (kind === 'wb') return wb()
  if (kind === 'contrast') { const lo = Math.min(s.llo, 60), hi = Math.max(s.lhi, 190); return { levels: [lo, hi, lo, hi, lo, hi] } }
  if (kind === 'color') return { levels: [Math.min(s.lo[0], 70), Math.max(s.hi[0], 180), Math.min(s.lo[1], 70), Math.max(s.hi[1], 180), Math.min(s.lo[2], 70), Math.max(s.hi[2], 180)] }
  const lv = [0, 1, 2].flatMap(i => [Math.round(Math.min(s.lo[i], 50) * 0.7), Math.round(255 - (255 - Math.max(s.hi[i], 200)) * 0.7)])
  const mid = s.lmid / 255
  return { levels: lv, exposure: clamp(Math.round((0.45 - mid) * 60), -25, 25), vibrance: 18, clarity: 12, sharpness: 15, shadows: mid < 0.4 ? 12 : 0, highlights: -8 }
}

export function adjustTool(app: App): Tool {
  let snap: any = null
  return {
    id: 'adjust', label: 'Adjustments', icon: 'adjust',
    panel() {
      const doc = app.doc!
      const ex = adjLayer(app, false)
      const a: Adjust = ex?.adjust || { ...ADJUST0, levels: [...ADJUST0.levels] }
      const sliders: HTMLElement[] = []
      const ensure = () => {
        if (!snap) snap = snapshot(doc)
        const l = adjLayer(app, true)!
        if (l.adjust !== a) l.adjust = a
        return l
      }
      const changed = () => { ensure(); doc.changed() }
      const end = () => { if (snap) { app.hist!.structural('Adjust', snap); snap = null; app.emit('layers') } }
      const S = (label: string, k: keyof Adjust, min = -100, max = 100) => {
        const el = slider(label, () => a[k] as number, v => { (a as any)[k] = v; changed() }, { min, max, def: 0, onEnd: end })
        sliders.push(el)
        return el
      }
      const flag = (label: string, k: 'grayscale' | 'sepia' | 'invert') => {
        const b = h('button', { class: a[k] ? 'on' : '', onclick: () => { a[k] = !a[k]; b.classList.toggle('on', a[k]); changed(); end() } }, label)
        return b
      }
      const auto = (kind: 'enhance' | 'wb' | 'contrast' | 'color') => {
        snap = snapshot(doc)
        const l = ensure()
        Object.assign(a, autoAdjust(doc, l, kind))
        changed(); end()
        sliders.forEach(s => (s as any).sync())
      }
      return h('div', { class: 'ib' },
        sec('Auto', btn('Reset all', () => {
          snap = snapshot(doc)
          Object.assign(a, { ...ADJUST0, levels: [...ADJUST0.levels] })
          changed(); end(); app.emit('panel')
        })),
        h('div', { class: 'g2' },
          h('button', { onclick: () => auto('enhance') }, icon('sparkle'), 'Enhance'),
          btn('White balance', () => auto('wb')), btn('Contrast', () => auto('contrast')), btn('Colour', () => auto('color'))),
        sec('Light'),
        S('Exposure', 'exposure'), S('Brightness', 'brightness'), S('Contrast', 'contrast'), S('Highlights', 'highlights'),
        S('Shadows', 'shadows'), S('Whites', 'whites'), S('Blacks', 'blacks'), S('Gamma', 'gamma'),
        sec('Colour'),
        S('Temperature', 'temperature'), S('Tint', 'tint'), S('Saturation', 'saturation'), S('Vibrance', 'vibrance'), S('Hue', 'hue', -180, 180),
        sec('Detail'),
        S('Sharpness', 'sharpness', 0, 100), S('Clarity', 'clarity', -100, 100),
        sec('Effects'),
        h('div', { class: 'seg' }, flag('Grayscale', 'grayscale'), flag('Sepia', 'sepia'), flag('Invert', 'invert')),
        h('button', { class: 'wide' + (app.view.compare === 'split' ? ' on' : ''), onclick: (e: Event) => { app.view.compare = app.view.compare === 'split' ? 'off' : 'split'; (e.currentTarget as HTMLElement).classList.toggle('on'); app.emit('compare'); app.view.draw() } }, icon('compare'), 'Before and after'))
    }
  }
}
