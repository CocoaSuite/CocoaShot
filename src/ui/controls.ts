import { h, tip } from './dom'

export interface SliderOpts { min: number; max: number; step?: number; unit?: string; def?: number; onEnd?: () => void; fmt?: (v: number) => string }

export function slider(label: string, get: () => number, set: (v: number) => void, o: SliderOpts) {
  const step = o.step ?? 1
  const r = h('input', { type: 'range', min: o.min, max: o.max, step, value: get() }) as HTMLInputElement
  const n = h('input', { type: 'number', min: o.min, max: o.max, step, value: get() }) as HTMLInputElement
  const fill = () => r.style.setProperty('--v', ((+r.value - o.min) / (o.max - o.min)) * 100 + '%')
  const sync = (v: number) => { r.value = String(v); n.value = String(Math.round(v / step) * step === v ? v : +v.toFixed(2)); fill() }
  const apply = (v: number) => { v = Math.min(o.max, Math.max(o.min, v)); set(v); sync(v) }
  r.addEventListener('input', () => apply(+r.value))
  r.addEventListener('change', () => o.onEnd?.())
  n.addEventListener('change', () => { apply(+n.value || 0); o.onEnd?.() })
  const id = 'r' + Math.random().toString(36).slice(2, 8)
  r.id = id
  const lab = h('label', { for: id, class: o.def !== undefined ? 'rs' : '' }, label)
  if (o.def !== undefined) {
    tip(lab, 'Click to reset')
    lab.addEventListener('click', e => { e.preventDefault(); apply(o.def!); o.onEnd?.() })
  }
  fill()
  const el = h('div', { class: 'sl' }, lab, r, n)
  ;(el as any).sync = () => sync(get())
  return el
}

export function seg<T extends string>(items: [T, string][], get: () => T, set: (v: T) => void, label?: string) {
  const box = h('div', { class: 'seg', role: 'group' })
  const draw = () => { box.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === get())) }
  for (const [v, t] of items) box.appendChild(h('button', { 'data-v': v, onclick: () => { set(v); draw() } }, t))
  draw()
  return label ? h('div', { class: 'fr' }, h('label', label), box) : box
}

export function toggle(label: string, get: () => boolean, set: (v: boolean) => void) {
  const i = h('input', { type: 'checkbox', checked: get() }) as HTMLInputElement
  i.addEventListener('change', () => set(i.checked))
  return h('label', { class: 'chkl' }, h('span', { class: 'sw' }, i, h('i')), label)
}

export function select<T extends string>(label: string, items: [T, string][], get: () => T, set: (v: T) => void) {
  const s = h('select', {}, items.map(([v, t]) => h('option', { value: v, selected: v === get() }, t))) as HTMLSelectElement
  s.addEventListener('change', () => set(s.value as T))
  const id = 'q' + Math.random().toString(36).slice(2, 8)
  s.id = id
  return h('div', { class: 'fr' }, h('label', { for: id }, label), h('div', { class: 'grow' }, s))
}

export function sec(title: string, ...right: (HTMLElement | null | false)[]) {
  return h('div', { class: 'sec' }, h('span', title), ...right.filter(Boolean) as HTMLElement[])
}

export function hint(t: string) { return h('p', { class: 'hint' }, t) }

export function btn(label: string, onclick: () => void, cls = '', ic?: SVGElement) {
  return h('button', { class: cls, onclick }, ic, label)
}

export function numField(label: string, get: () => number, set: (v: number) => void, min = 1, max = 100000) {
  const i = h('input', { type: 'number', min, max, value: get() }) as HTMLInputElement
  i.addEventListener('change', () => { const v = Math.max(min, Math.min(max, Math.round(+i.value || min))); set(v); i.value = String(get()) })
  ;(i as any).sync = () => (i.value = String(get()))
  return { el: h('label', { style: { display: 'flex', flexDirection: 'column', gap: '3px', fontSize: '11px', color: 'var(--mute)' } }, label, i), input: i }
}
