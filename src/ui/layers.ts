import type { App } from '../app'
import { childrenOf, cloneAdjust, cloneFx, freshAdjust, Layer, makeLayer, moveLayer, shownVisible, snapshot, subtree } from '../core/doc'
import { layerFull } from '../core/compose'
import { copyCanvas, ctx2d, uid } from '../core/util'
import { h, icon, tip, toast } from './dom'
import { select, slider, toggle } from './controls'
import { BLENDS } from '../tools/paint'

const KIND_ICON: Record<string, string> = { text: 'text', shape: 'shape', adjust: 'sliders', outline: 'outline', group: 'folder' }

export function layersPanel(app: App, box: HTMLElement) {
  const list = h('div', { id: 'layers' })
  const opac = h('div', { class: 'lopac' })
  const btns = () => {
    const doc = app.doc
    const del = tip(h('button', { class: 'ic', onclick: () => removeLayer(app) }, icon('trash')), 'Delete layer')
    del.toggleAttribute('disabled', !doc || doc.layers.length < 2)
    const fx = tip(h('button', { class: 'ic', onclick: () => app.setTool('effects') }, icon('fx')), 'Layer effects')
    fx.toggleAttribute('disabled', !doc?.active?.canvas)
    return [tip(h('button', { class: 'ic', onclick: () => newLayer(app) }, icon('plus')), 'New paint layer'),
      tip(h('button', { class: 'ic', onclick: () => newFolder(app) }, icon('folder')), 'New folder'),
      tip(h('button', { class: 'ic', onclick: () => newAdjust(app) }, icon('sliders')), 'New adjustment layer'), fx,
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
    const shown: { l: Layer; depth: number }[] = []
    const walk = (parent: string | null, depth: number) => {
      for (const l of childrenOf(doc, parent).reverse()) {
        shown.push({ l, depth })
        if (l.kind === 'group' && !l.collapsed) walk(l.id, depth + 1)
      }
    }
    walk(null, 0)
    for (const { l, depth } of shown) {
      const th = h('span', { class: 'thumb' + (l.canvas ? ' chk' : '') })
      if (l.canvas && l.kind !== 'text' && l.kind !== 'shape') { const c = h('canvas'); drawThumb(l, c); th.appendChild(c); thumbs.set(l.id, c) }
      else th.appendChild(icon(KIND_ICON[l.kind] || 'layers'))
      const sub = (l.kind === 'group' ? childrenOf(doc, l.id).length + ' inside  ' : '') + (BLENDS.find(b => b[0] === l.blend)?.[1] || 'Normal') + '  ' + Math.round(l.opacity * 100) + '%'
      const nm = h('span', { class: 'nm' }, h('span', { class: 'nmt' }, l.name), h('span', { class: 'lsub' }, sub))
      nm.addEventListener('dblclick', () => {
        const i = h('input', { type: 'text', value: l.name }) as HTMLInputElement
        nm.innerHTML = ''; nm.appendChild(i); i.focus(); i.select()
        const done = () => { const v = i.value.trim(); if (v && v !== l.name) app.hist!.op(l.kind === 'group' ? 'Rename folder' : 'Rename layer', () => { l.name = v }); else render() }
        i.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); if (e.key === 'Escape') { i.value = l.name; i.blur() } })
        i.addEventListener('blur', done)
      })
      const eye = tip(h('button', { class: 'lb', onclick: (e: Event) => { e.stopPropagation(); app.hist!.op(l.visible ? 'Hide layer' : 'Show layer', () => { l.visible = !l.visible }) } }, icon(l.visible ? 'eye' : 'eyeoff')), l.visible ? 'Hide' : 'Show')
      const lock = tip(h('button', { class: 'lb', onclick: (e: Event) => { e.stopPropagation(); app.hist!.op(l.locked ? 'Unlock layer' : 'Lock layer', () => { l.locked = !l.locked }) } }, icon(l.locked ? 'lock' : 'unlock')), l.locked ? 'Unlock' : 'Lock')
      if (!l.locked) lock.style.opacity = '.45'
      const fold = l.kind === 'group'
        ? tip(h('button', { class: 'lb fold' + (l.collapsed ? '' : ' open'), onclick: (e: Event) => { e.stopPropagation(); l.collapsed = !l.collapsed; render() } }, icon('chev')), l.collapsed ? 'Open folder' : 'Close folder')
        : null
      const badges = h('span', { style: { display: 'flex', gap: '2px', color: 'var(--mute)' } },
        l.fx && (l.fx.shadow.on || l.fx.glow.on || l.fx.stroke.on || l.fx.inner.on || l.fx.overlay.on) && tip(h('button', { class: 'lb fxb', onclick: (e: Event) => { e.stopPropagation(); doc.activeId = l.id; app.emit('layers'); app.emit('active'); app.setTool('effects') } }, icon('fx')), 'Layer effects'),
        l.mask && tip(h('span', {}, icon('bg')), 'Has a mask'),
        l.alphaLock && tip(h('span', {}, icon('alpha')), 'Transparency locked'))
      const hidden = !shownVisible(doc, l)
      const row = h('div', { class: 'lr' + (l.id === doc.activeId ? ' on' : '') + (hidden ? ' hid' : '') + (l.clip ? ' clip' : '') + (fold ? ' grp' : ''), 'data-id': l.id, draggable: false },
        fold, th, nm, badges, eye, lock)
      if (depth) row.style.marginLeft = depth * 14 + 'px'
      if (fold) th.addEventListener('dblclick', e => { e.stopPropagation(); l.collapsed = !l.collapsed; render() })
      else if (l.canvas) th.addEventListener('dblclick', e => { e.stopPropagation(); app.setTool('effects') })
      row.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('button,input')) return
        if (doc.activeId !== l.id) { doc.activeId = l.id; app.emit('layers'); app.emit('active') }
        dragId = l.id
        const y0 = e.clientY
        let moved = false, ln: HTMLElement | null = null, into: HTMLElement | null = null
        let drop: { ref: string | null; where: 'above' | 'below' | 'into' } | null = null
        const mv = (ev: PointerEvent) => {
          if (!moved && Math.abs(ev.clientY - y0) < 5) return
          moved = true
          const rows = [...list.querySelectorAll('.lr')] as HTMLElement[]
          into?.classList.remove('dropin'); into = null
          if (!ln) { ln = h('div', { id: 'dropLn' }); list.appendChild(ln) }
          const lb = list.getBoundingClientRect()
          let i = rows.findIndex(r => ev.clientY < r.getBoundingClientRect().bottom)
          if (i < 0) {
            // Below the last row: the bottom of the stack, at the top level.
            const bottom = childrenOf(doc, null)[0]
            drop = { ref: bottom?.id || null, where: 'below' }
            const rb = rows[rows.length - 1].getBoundingClientRect()
            ln.hidden = false; ln.style.left = '6px'; ln.style.top = rb.bottom - lb.top + list.scrollTop - 1 + 'px'
            return
          }
          const rr = rows[i].getBoundingClientRect()
          const f = (ev.clientY - rr.top) / rr.height
          const target = shown[i]
          let where: 'above' | 'below' | 'into' = f < 0.5 ? 'above' : 'below'
          if (target.l.kind === 'group' && f > 0.25 && f < 0.75) where = 'into'
          if (where === 'below' && target.l.kind === 'group' && !target.l.collapsed) where = 'into'
          drop = { ref: target.l.id, where }
          if (where === 'into') { ln.hidden = true; into = rows[i]; into.classList.add('dropin'); return }
          ln.hidden = false
          ln.style.left = 6 + target.depth * 14 + 'px'
          ln.style.top = (where === 'above' ? rr.top : rr.bottom) - lb.top + list.scrollTop - 1 + 'px'
        }
        const upf = () => {
          removeEventListener('pointermove', mv); removeEventListener('pointerup', upf)
          ln?.remove(); into?.classList.remove('dropin')
          if (moved && drop && dragId && drop.ref !== dragId) {
            const id = dragId, d = drop
            const ref = d.ref ? doc.layer(d.ref) : null
            const before = snapshot(doc)
            if (moveLayer(doc, id, d.ref, d.where)) {
              if (d.where === 'into' && ref) ref.collapsed = false
              app.hist!.structural(d.where === 'into' ? 'Move into ' + (ref?.name || 'folder') : 'Reorder layers', before)
              doc.structure()
            } else toast("A folder can't go inside itself")
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

export function newFolder(app: App) {
  const doc = app.doc
  if (!doc) return
  app.hist!.op('New folder', () => {
    const n = doc.layers.filter(l => l.kind === 'group').length + 1
    doc.add(makeLayer('group', 'Folder ' + n, doc.w, doc.h, false), doc.activeId)
  })
}

/** Puts the selected layer (or folder) into a new folder in its place. */
export function groupLayer(app: App) {
  const doc = app.doc
  const a = doc?.active
  if (!doc || !a) return
  app.hist!.op('Put in folder', () => {
    const g = makeLayer('group', 'Folder ' + (doc.layers.filter(l => l.kind === 'group').length + 1), doc.w, doc.h, false)
    g.parent = a.parent
    doc.layers.splice(doc.index(a.id) + 1, 0, g)
    a.parent = g.id
    doc.activeId = g.id
  })
}

/** Removes a folder and keeps its contents where they are. */
export function ungroup(app: App) {
  const doc = app.doc
  const g = doc?.active
  if (!doc || !g) return
  if (g.kind !== 'group') { toast('Select a folder first'); return }
  app.hist!.op('Remove folder', () => {
    const kids = childrenOf(doc, g.id)
    for (const k of kids) k.parent = g.parent
    doc.layers = doc.layers.filter(l => l !== g)
    doc.activeId = kids.length ? kids[kids.length - 1].id : doc.layers[doc.layers.length - 1].id
  })
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

export function copyLayer(a: Layer, id = uid()): Layer {
  const cp = (c: HTMLCanvasElement | null) => c && copyCanvas(c)
  return {
    ...a, id, canvas: cp(a.canvas), mask: cp(a.mask), maskAI: cp(a.maskAI), cache: null, maskCache: null, dirty: true, maskDirty: true,
    maskOpts: { ...a.maskOpts }, shape: a.shape && { ...a.shape }, outline: a.outline && { ...a.outline }, adjust: a.adjust && cloneAdjust(a.adjust), bg: a.bg && { ...a.bg },
    fx: cloneFx(a.fx), fxCache: null, fxKey: ''
  }
}

export function duplicate(app: App) {
  const doc = app.doc
  const a = doc?.active
  if (!doc || !a) return
  app.hist!.op(a.kind === 'group' ? 'Duplicate folder' : 'Duplicate layer', () => {
    const block = subtree(doc, a)
    const ids = new Map(block.map(l => [l.id, uid()]))
    const copies = block.map(l => { const n = copyLayer(l, ids.get(l.id)!); n.parent = l === a ? a.parent : ids.get(l.parent!) || l.parent; return n })
    copies[copies.length - 1].name = a.name + ' copy'
    doc.layers.splice(doc.index(a.id) + 1, 0, ...copies)
    doc.activeId = copies[copies.length - 1].id
  })
}

export function removeLayer(app: App) {
  const doc = app.doc
  const a = doc?.active
  if (!doc || !a) return
  const gone = subtree(doc, a)
  if (doc.layers.length - gone.length < 1 || !doc.layers.some(l => !gone.includes(l) && l.kind !== 'group')) { toast('An image needs at least one layer'); return }
  app.hist!.op(a.kind === 'group' ? 'Delete folder' : 'Delete layer', () => {
    const i = doc.index(gone[0].id)
    const ids = new Set(gone.map(l => l.id))
    doc.layers = doc.layers.filter(l => !ids.has(l.id) && !(l.bgFor && ids.has(l.bgFor)))
    for (const l of doc.layers) if (l.outline && ids.has(l.outline.source)) l.outline.source = 'canvas'
    doc.activeId = doc.layers[Math.max(0, Math.min(doc.layers.length - 1, i - 1))].id
  })
}

