import type { App } from '../app'
import type { Tool } from './types'
import { Effects, freshFx, fxActive, Snap, snapshot } from '../core/doc'
import { h } from '../ui/dom'
import { btn, hint, sec, seg, slider } from '../ui/controls'

type Key = keyof Effects

const NAMES: [Key, string, string][] = [
  ['shadow', 'Drop shadow', 'A soft shadow behind the layer.'],
  ['glow', 'Outer glow', 'A soft halo around the edge.'],
  ['stroke', 'Stroke', 'An outline that follows the edge exactly.'],
  ['inner', 'Inner shadow', 'Shading just inside the edge, so the layer looks cut in.'],
  ['overlay', 'Colour overlay', 'Fills the layer with one colour, keeping its shape.']
]

/** Layer effects in the side panel. Changes show right away and each finished change is one undo step. */
export function effectsTool(app: App): Tool {
  let before: Snap | null = null
  const begin = () => { if (!before && app.doc) before = snapshot(app.doc) }
  const end = (label = 'Layer effects') => { if (before && app.hist) { app.hist.structural(label, before); before = null } }
  const live = () => { const l = app.doc?.active; if (l) l.fxKey = ''; app.doc?.changed() }

  const colour = (get: () => string, set: (v: string) => void) => {
    const i = h('input', { type: 'color', value: get() }) as HTMLInputElement
    i.addEventListener('input', () => { begin(); set(i.value); live() })
    i.addEventListener('change', () => end())
    return h('div', { class: 'fr' }, h('label', 'Colour'), i)
  }
  const sl = (label: string, get: () => number, set: (v: number) => void, o: { min: number; max: number; unit?: string; def?: number; step?: number }) =>
    slider(label, get, v => { begin(); set(v); live() }, { ...o, onEnd: () => end() })

  return {
    id: 'effects', label: 'Layer effects', icon: 'fx',
    deactivate() { end() },
    panel() {
      const doc = app.doc
      const l = doc?.active
      if (!doc || !l || !l.canvas || l.kind === 'background') return h('div', { class: 'ib' }, sec('Layer effects'), hint('Select an image, paint, text or shape layer to add effects to it. Folders and adjustment layers have no effects.'))
      const fx = () => (l.fx ||= freshFx())
      const section = (k: Key, title: string, about: string, body: () => HTMLElement[]) => {
        const on = !!l.fx?.[k].on
        const box = h('div', { class: 'fxsec' + (on ? '' : ' off') })
        const cb = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement
        cb.addEventListener('change', () => {
          begin(); fx()[k].on = cb.checked; live(); end(cb.checked ? 'Add ' + title.toLowerCase() : 'Remove ' + title.toLowerCase())
          if (!fxActive(l.fx)) l.fx = null
          app.emit('panel'); app.emit('layers')
        })
        box.append(h('label', { class: 'chkl' }, h('span', { class: 'sw' }, cb, h('i')), h('b', title)), hint(about), ...(on ? body() : []))
        return box
      }
      const f = fx()
      const shadowBody = (k: 'shadow' | 'inner') => () => [
        colour(() => f[k].color, v => (f[k].color = v)),
        sl('Opacity', () => Math.round(f[k].opacity * 100), v => (f[k].opacity = v / 100), { min: 0, max: 100, unit: '%' }),
        sl('Angle', () => f[k].angle, v => (f[k].angle = v), { min: -180, max: 180, unit: '°', def: 120 }),
        sl('Distance', () => f[k].distance, v => (f[k].distance = v), { min: 0, max: 200, unit: 'px' }),
        sl('Softness', () => f[k].size, v => (f[k].size = v), { min: 0, max: 200, unit: 'px' })]
      const out = h('div', { class: 'ib' },
        sec('Layer effects: ' + l.name),
        hint('Effects follow the layer as you paint, move or transform it. Export and Flatten apply them.'),
        section('shadow', NAMES[0][1], NAMES[0][2], shadowBody('shadow')),
        section('glow', NAMES[1][1], NAMES[1][2], () => [
          colour(() => f.glow.color, v => (f.glow.color = v)),
          sl('Opacity', () => Math.round(f.glow.opacity * 100), v => (f.glow.opacity = v / 100), { min: 0, max: 100, unit: '%' }),
          sl('Size', () => f.glow.size, v => (f.glow.size = v), { min: 1, max: 250, unit: 'px' })]),
        section('stroke', NAMES[2][1], NAMES[2][2], () => [
          colour(() => f.stroke.color, v => (f.stroke.color = v)),
          sl('Width', () => f.stroke.size, v => (f.stroke.size = v), { min: 1, max: 250, unit: 'px' }),
          sl('Opacity', () => Math.round(f.stroke.opacity * 100), v => (f.stroke.opacity = v / 100), { min: 0, max: 100, unit: '%' }),
          seg<'outside' | 'center' | 'inside'>([['outside', 'Outside'], ['center', 'Centre'], ['inside', 'Inside']], () => f.stroke.position, v => { begin(); f.stroke.position = v; live(); end() }, 'Position')]),
        section('inner', NAMES[3][1], NAMES[3][2], shadowBody('inner')),
        section('overlay', NAMES[4][1], NAMES[4][2], () => [
          colour(() => f.overlay.color, v => (f.overlay.color = v)),
          sl('Opacity', () => Math.round(f.overlay.opacity * 100), v => (f.overlay.opacity = v / 100), { min: 0, max: 100, unit: '%' })]),
        fxActive(l.fx) && btn('Remove all effects', () => { begin(); l.fx = null; live(); end('Remove effects'); app.emit('panel'); app.emit('layers') }, 'wide'))
      if (!fxActive(l.fx)) l.fx = null
      return out
    }
  }
}
