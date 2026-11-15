import type { App } from '../app'
import { cloneAdjust, freshAdjust, Layer, makeLayer, snapshot } from '../core/doc'
import { layerFull, touch } from '../core/compose'
import { copyCanvas, ctx2d, uid } from '../core/util'
import { h, icon, tip, toast } from './dom'
import { select, slider, toggle } from './controls'
import { BLENDS } from '../tools/paint'

const KIND_ICON: Record<string, string> = { text: 'text', shape: 'shape', adjust: 'sliders', outline: 'outline' }

export function layersPanel(app: App, box: HTMLElement) {
  const list = h('div', { id: 'layers' })
  const opac = h('div', { class: 'lopac' })
  const btns = () => {
    const doc = app.doc
    const del = tip(h('button', { class: 'ic', onclick: () => removeLayer(app) }, icon('trash')), 'Delete layer')
    del.toggleAttribute('disabled', !doc || doc.layers.length < 2)
    return [tip(h('button', { class: 'ic', onclick: () => newLayer(app) }, icon('plus')), 'New paint layer'),
      tip(h('button', { class: 'ic', onclick: () => newAdjust(app) }, icon('sliders')), 'New adjustment layer'),
      tip(h('button', { class: 'ic', onclick: () => app.setTool('alpha') }, icon('alpha')), 'Edit layer alpha'),
      tip(h('button', { class: 'ic', onclick: () => duplicate(app) }, icon('copy')), 'Duplicate layer'), del]
  }
  const controls = () => {
    const a = app.doc?.active
    if (!a) return null
    const ch = (label: string, fn: () => void) => app.hist!.op(label, fn)
    let snap: any = null
    return h('div', { class: 'lctl' },
      select('Mode', BLENDS, () => a.blend, v => ch('Blend mode', () => { a.blend = v })),
      slider('Opacity', () => Math.round(a.opacity * 100), v => { if (!snap) snap = snapshot(app.doc!); a.opacity = v / 100; app.doc!.changed() }, { min: 0, max: 100, onEnd: () => { if (snap) { app.hist!.structural('Layer opacity', snap); snap = null } } }),
      a.canvas ? h('div', { class: 'lchk' },
        toggle('Lock transparency', () => a.alphaLock, v => ch(v ? 'Lock transparency' : 'Unlock transparency', () => { a.alphaLock = v })),
        toggle('Clip to layer below', () => a.clip, v => ch(v ? 'Clip to layer below' : 'Release clipping', () => { a.clip = v })),
        toggle('Lock layer', () => a.locked, v => ch(v ? 'Lock layer' : 'Unlock layer', () => { a.locked = v }))) : null)
  }
  const arrange = () => {
    const st = app.settings.uiStyle
    box.innerHTML = ''
    if (st === 'classic') box.append(h('div', { class: 'ph' }, h('span', 'Layers'), h('span', { style: { display: 'flex', gap: '1px' } }, ...btns())), list, opac)
    else if (st === 'ps') box.append(h('div', { class: 'ph' }, h('span', 'Layers')), controls() || '', list, h('div', { class: 'lbar' }, ...btns()))
    else box.append(h('div', { class: 'pt' }, h('span', 'Layers')), h('div', { class: 'pb' }, controls() || '', h('div', { class: 'lbar' }, ...btns())), list)
  }
  app.on('new-layer', () => newLayer(app))

  const thumbs = new Map<string, HTMLCanvasElement>()
  const drawThumb = (l: Layer, c: HTMLCanvasElement) => {
    const doc = app.doc!
    const s = Math.min(28 / doc.w, 22 / doc.h)
    c.width = Math.max(1, Math.round(doc.w * s)); c.height = Math.max(1, Math.round(doc.h * s))
    const x = ctx2d(c)
    x.clearRect(0, 0, c.width, c.height)
    const src = layerFull(doc, l)
    if (src) { x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height) }
  }

  let dragId: string | null = null
  const render = () => {
    list.innerHTML = ''
    opac.innerHTML = ''
    thumbs.clear()
    const doc = app.doc
    arrange()
    if (!doc) return
    for (const l of [...doc.layers].reverse()) {
      const th = h('span', { class: 'thumb' + (l.canvas ? ' chk' : '') })
      if (l.canvas && l.kind !== 'text' && l.kind !== 'shape') { const c = h('canvas'); drawThumb(l, c); th.appendChild(c); thumbs.set(l.id, c) }
      else th.appendChild(icon(KIND_ICON[l.kind] || 'layers'))
      const nm = h('span', { class: 'nm' }, h('span', { class: 'nmt' }, l.name), h('span', { class: 'lsub' }, (BLENDS.find(b => b[0] === l.blend)?.[1] || 'Normal') + ' · ' + Math.round(l.opacity * 100) + '%'))
      nm.addEventListener('dblclick', () => {
        const i = h('input', { type: 'text', value: l.name }) as HTMLInputElement
        nm.innerHTML = ''; nm.appendChild(i); i.focus(); i.select()
        const done = () => { const v = i.value.trim(); if (v && v !== l.name) app.hist!.op('Rename layer', () => { l.name = v }); else render() }
        i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = l.name; i.blur() } })
        i.addEventListener('blur', done)
      })
      const eye = tip(h('button', { class: 'lb', onclick: (e: Event) => { e.stopPropagation(); app.hist!.op(l.visible ? 'Hide layer' : 'Show layer', () => { l.visible = !l.visible }) } }, icon(l.visible ? 'eye' : 'eyeoff')), l.visible ? 'Hide' : 'Show')
      const lock = tip(h('button', { class: 'lb', onclick: (e: Event) => { e.stopPropagation(); app.hist!.op(l.locked ? 'Unlock layer' : 'Lock layer', () => { l.locked = !l.locked }) } }, icon(l.locked ? 'lock' : 'unlock')), l.locked ? 'Unlock' : 'Lock')
      if (!l.locked) lock.style.opacity = '.45'
      const badges = h('span', { style: { display: 'flex', gap: '2px', color: 'var(--mute)' } },
        l.mask && tip(h('span', {}, icon('bg')), 'Has a mask'),
        l.alphaLock && tip(h('span', {}, icon('alpha')), 'Transparency locked'))
      const row = h('div', { class: 'lr' + (l.id === doc.activeId ? ' on' : '') + (l.visible ? '' : ' hid') + (l.clip ? ' clip' : ''), 'data-id': l.id, draggable: false },
        th, nm, badges, eye, lock)
      row.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('button,input')) return
        if (doc.activeId !== l.id) { doc.activeId = l.id; app.emit('layers'); app.emit('active') }
        dragId = l.id
        const y0 = e.clientY
        let moved = false, ln: HTMLElement | null = null, target = -1
        const mv = (ev: PointerEvent) => {
          if (!moved && Math.abs(ev.clientY - y0) < 5) return
          moved = true
          const rows = [...list.querySelectorAll('.lr')] as HTMLElement[]
          let idx = rows.length
          for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { idx = i; break } }
          target = idx
          if (!ln) { ln = h('div', { id: 'dropLn' }); list.appendChild(ln) }
          const ref = rows[Math.min(idx, rows.length - 1)].getBoundingClientRect(), lb = list.getBoundingClientRect()
          ln.style.top = (idx < rows.length ? ref.top : ref.bottom) - lb.top + list.scrollTop - 1 + 'px'
        }
        const upf = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', upf)
          ln?.remove()
          if (moved && target >= 0 && dragId) {
            const n = doc.layers.length
            const from = doc.index(dragId)
            let to = n - target
            if (to > from) to--
            if (to !== from) app.hist!.op('Reorder layers', () => { const [m] = doc.layers.splice(from, 1); doc.layers.splice(Math.max(0, Math.min(n - 1, to)), 0, m) })
          }
          dragId = null
        }
        addEventListener('pointermove', mv); addEventListener('pointerup', upf)
      })
      list.appendChild(row)
    }
    const a = doc.active
    if (a) {
      let snap: any = null
      opac.appendChild(slider('Opacity', () => Math.round(a.opacity * 100), v => { if (!snap) snap = snapshot(doc); a.opacity = v / 100; doc.changed() }, { min: 0, max: 100, onEnd: () => { if (snap) { app.hist!.structural('Layer opacity', snap); snap = null } } }))
    }
  }
  app.on('style', render)
  let tt = 0
  app.on('layers', render)
  app.on('doc', render)
  app.on('history', () => { clearTimeout(tt); tt = window.setTimeout(() => {
    const doc = app.doc
    if (!doc) return
    for (const [id, c] of thumbs) { const l = doc.layer(id); if (l) drawThumb(l, c) }
  }, 250) })
}

export function newLayer(app: App) {
  const doc = app.doc
  if (!doc) return
  app.hist!.op('New layer', () => { const l = makeLayer('paint', 'Layer ' + (doc.layers.length + 1), doc.w, doc.h); doc.add(l, doc.activeId) })
}

export function newAdjust(app: App) {
  const doc = app.doc
  if (!doc) return
  app.hist!.op('New adjustment layer', () => {
    const l = makeLayer('adjust', 'Adjustments', doc.w, doc.h, false)
    l.adjust = freshAdjust()
    doc.add(l, doc.activeId)
  })
  app.setTool('adjust')
}

export function duplicate(app: App) {
  const doc = app.doc
  const a = doc?.active
  if (!doc || !a) return
  app.hist!.op('Duplicate layer', () => {
    const cp = (c: HTMLCanvasElement | null) => c && copyCanvas(c)
    const n: Layer = {
      ...a, id: uid(), name: a.name + ' copy', canvas: cp(a.canvas), mask: cp(a.mask), maskAI: cp(a.maskAI), cache: null, maskCache: null, dirty: true, maskDirty: true,
      maskOpts: { ...a.maskOpts }, shape: a.shape && { ...a.shape }, outline: a.outline && { ...a.outline }, adjust: a.adjust && cloneAdjust(a.adjust), bg: a.bg && { ...a.bg }
    }
    doc.add(n, a.id)
  })
}

export function removeLayer(app: App) {
  const doc = app.doc
  const a = doc?.active
  if (!doc || !a) return
  if (doc.layers.length < 2) { toast('An image needs at least one layer'); return }
  app.hist!.op('Delete layer', () => {
    const i = doc.index(a.id)
    doc.layers = doc.layers.filter(l => l !== a && l.bgFor !== a.id)
    for (const l of doc.layers) if (l.outline?.source === a.id) l.outline.source = 'canvas'
    doc.activeId = doc.layers[Math.max(0, Math.min(doc.layers.length - 1, i - 1))].id
  })
}
