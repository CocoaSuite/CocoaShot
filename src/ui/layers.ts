import type { App } from '../app'
import { childrenOf, cloneAdjust, cloneFx, freshAdjust, isInside, Layer, makeLayer, moveLayer, shownLocked, shownVisible, snapshot, subtree } from '../core/doc'
import { composeList, effectiveMask, flatten, layerFull } from '../core/compose'
import { canvas, copyCanvas, ctx2d, uid } from '../core/util'
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
    for (const id of [...doc.picked]) if (!doc.layer(id) || id === doc.activeId) doc.picked.delete(id)
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
      const eye = tip(h('button', { class: 'lb', onclick: (e: MouseEvent) => {
        e.stopPropagation()
        if (e.altKey) { soloLayer(app, l); return }
        app.hist!.op(l.visible ? 'Hide layer' : 'Show layer', () => { l.visible = !l.visible })
      } }, icon(l.visible ? 'eye' : 'eyeoff')), (l.visible ? 'Hide' : 'Show') + '. Alt-click shows only this layer')
      const lock = tip(h('button', { class: 'lb', onclick: (e: Event) => { e.stopPropagation(); app.hist!.op(l.locked ? 'Unlock layer' : 'Lock layer', () => { l.locked = !l.locked }) } }, icon(l.locked ? 'lock' : 'unlock')), l.locked ? 'Unlock' : 'Lock')
      if (!l.locked) lock.style.opacity = '.45'
      const fold = l.kind === 'group'
        ? tip(h('button', { class: 'lb fold' + (l.collapsed ? '' : ' open'), onclick: (e: Event) => { e.stopPropagation(); l.collapsed = !l.collapsed; render() } }, icon('chev')), l.collapsed ? 'Open folder' : 'Close folder')
        : null
      const badges = h('span', { style: { display: 'flex', gap: '2px', color: 'var(--mute)' } },
        l.fx && (l.fx.shadow.on || l.fx.glow.on || l.fx.stroke.on || l.fx.inner.on || l.fx.overlay.on) && tip(h('button', { class: 'lb fxb', onclick: (e: Event) => { e.stopPropagation(); doc.activeId = l.id; app.emit('layers'); app.emit('active'); app.setTool('effects') } }, icon('fx')), 'Layer effects'),
        l.mask && tip(h('button', { class: 'lb' + (l.maskOff ? ' off' : ''), onclick: (e: Event) => { e.stopPropagation(); doc.activeId = l.id; toggleMask(app) } }, icon('mask')), l.maskOff ? 'Mask disabled: click to enable' : 'Mask: click to disable'),
        l.alphaLock && tip(h('span', {}, icon('alpha')), 'Transparency locked'))
      const hidden = !shownVisible(doc, l)
      const row = h('div', { class: 'lr' + (l.id === doc.activeId ? ' on' : doc.picked.has(l.id) ? ' pk' : '') + (hidden ? ' hid' : '') + (l.clip ? ' clip' : '') + (fold ? ' grp' : ''), 'data-id': l.id, draggable: false },
        fold, th, nm, badges, eye, lock)
      if (depth) row.style.marginLeft = depth * 14 + 'px'
      if (fold) th.addEventListener('dblclick', e => { e.stopPropagation(); l.collapsed = !l.collapsed; render() })
      else if (l.canvas) th.addEventListener('dblclick', e => { e.stopPropagation(); app.setTool('effects') })
      row.addEventListener('contextmenu', e => { e.preventDefault(); if (doc.activeId !== l.id && !doc.picked.has(l.id)) { doc.picked.clear(); doc.activeId = l.id; app.emit('layers') } layerMenu(app, e.clientX, e.clientY) })
      row.addEventListener('pointerdown', e => {
        if ((e.target as HTMLElement).closest('button,input') || e.button === 2) return
        // Ctrl-click adds or removes a layer from the picked set; Shift-click picks a run of layers.
        if (e.ctrlKey || e.metaKey) {
          if (l.id === doc.activeId && doc.picked.size) { const next = [...doc.picked].pop()!; doc.picked.delete(next); doc.activeId = next }
          else if (doc.picked.has(l.id)) doc.picked.delete(l.id)
          else { doc.picked.add(doc.activeId); doc.activeId = l.id }
          doc.picked.delete(doc.activeId)
          app.emit('layers'); app.emit('active')
          return
        }
        if (e.shiftKey) {
          const i0 = shown.findIndex(x => x.l.id === doc.activeId), i1 = shown.findIndex(x => x.l.id === l.id)
          doc.picked.clear()
          if (i0 >= 0) for (let i = Math.min(i0, i1); i <= Math.max(i0, i1); i++) doc.picked.add(shown[i].l.id)
          doc.activeId = l.id; doc.picked.delete(l.id)
          app.emit('layers'); app.emit('active')
          return
        }
        if (doc.picked.size) { doc.picked.clear(); app.emit('layers') }
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
  // Several picked layers go into the folder together, in their order, where the topmost one was.
  const list = chosen(app).filter(l => !chosen(app).some(o => o !== l && isInside(doc, l, o)))
  const top = list[list.length - 1] || a
  app.hist!.op('Put in folder', () => {
    const g = makeLayer('group', 'Folder ' + (doc.layers.filter(l => l.kind === 'group').length + 1), doc.w, doc.h, false)
    g.parent = top.parent
    doc.layers.splice(doc.index(top.id) + 1, 0, g)
    for (const l of list) l.parent = g.id
    doc.picked.clear()
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
  const gone = [...new Set(chosen(app).flatMap(l => subtree(doc, l)))]
  if (doc.layers.length - gone.length < 1 || !doc.layers.some(l => !gone.includes(l) && l.kind !== 'group')) { toast('An image needs at least one layer'); return }
  app.hist!.op(gone.length > 1 && doc.picked.size ? 'Delete layers' : a.kind === 'group' ? 'Delete folder' : 'Delete layer', () => {
    const i = doc.index(gone[0].id)
    doc.picked.clear()
    const ids = new Set(gone.map(l => l.id))
    doc.layers = doc.layers.filter(l => !ids.has(l.id) && !(l.bgFor && ids.has(l.bgFor)))
    for (const l of doc.layers) if (l.outline && ids.has(l.outline.source)) l.outline.source = 'canvas'
    doc.activeId = doc.layers[Math.max(0, Math.min(doc.layers.length - 1, i - 1))].id
  })
}


/** The layers an action applies to: every picked layer, or just the active one. Bottom to top. */
export function chosen(app: App): Layer[] {
  const doc = app.doc
  if (!doc) return []
  const ids = new Set([...doc.picked, doc.activeId])
  return doc.layers.filter(l => ids.has(l.id))
}

/** Replaces the layers in list with one pixel layer holding what they showed, in the lowest one's place. */
function mergeInto(app: App, list: Layer[], img: HTMLCanvasElement, label: string, topLevel = false) {
  const doc = app.doc!
  const base = list[0]
  app.hist!.op(label, () => {
    const gone = new Set(list.filter(l => l !== base).map(l => l.id))
    const kind = list.some(l => l.kind === 'image') ? 'image' : 'paint'
    Object.assign(base, {
      kind, canvas: img, mask: null, maskOff: false, maskAI: null, maskOpts: { feather: 0, smooth: 0, shift: 0 }, shape: null, outline: null, adjust: null, bg: null, bgFor: null,
      fx: null, fxCache: null, fxKey: '', opacity: 1, visible: true, alphaLock: false, cache: null, maskCache: null, dirty: true, maskDirty: null
    })
    for (const l of doc.layers) {
      if (l.bgFor && gone.has(l.bgFor)) l.bgFor = base.id
      if (l.outline && gone.has(l.outline.source)) l.outline.source = base.id
    }
    doc.layers = doc.layers.filter(l => !gone.has(l.id))
    if (topLevel) {
      base.parent = null; base.blend = 'source-over'; base.clip = false
      const before = new Set<string>()
      for (const g of doc.layers) if (g.kind === 'group' && shownVisible(doc, g)) before.add(g.id)
      let again = true
      while (again) {
        again = false
        for (const g of doc.layers) if (before.has(g.id) && !doc.layers.some(x => x.parent === g.id)) { doc.layers = doc.layers.filter(x => x !== g); again = true; break }
      }
    }
    doc.picked.clear()
    doc.activeId = base.id
  })
}

/** Merges the picked layers, or the active layer into the one below it. */
export function mergeDown(app: App) {
  const doc = app.doc
  const a = doc?.active
  if (!doc || !a) return
  let list = chosen(app)
  if (list.length < 2) {
    const sib = childrenOf(doc, a.parent)
    const below = sib[sib.indexOf(a) - 1]
    if (!below) { toast('There is no layer below to merge into'); return }
    list = [below, a]
  }
  list = list.flatMap(l => (l.kind === 'group' ? subtree(doc, l).filter(x => x.kind !== 'group') : [l]))
  if (list.some(l => shownLocked(doc, l))) { toast('Unlock the layers first'); return }
  if (list[0].kind === 'adjust') { toast('An adjustment layer can only be merged into a layer below it'); return }
  mergeInto(app, list, composeList(doc, list), list.length > 2 ? 'Merge layers' : 'Merge down')
}

/** Merges everything visible into one layer; hidden layers stay as they are. */
export function mergeVisible(app: App) {
  const doc = app.doc
  if (!doc) return
  const list = doc.layers.filter(l => l.kind !== 'group' && shownVisible(doc, l))
  if (list.length < 2) { toast('Nothing to merge: fewer than two layers are showing'); return }
  if (list.some(l => shownLocked(doc, l))) { toast('Unlock the layers first'); return }
  // The merged image is the whole picture, so it leaves any folder, and folders it empties go too.
  mergeInto(app, list, flatten(doc), 'Merge visible', true)
}

/** Adds a mask to the active layer: white (shows everything), or from the selection. */
export function addMask(app: App, fromSel = false) {
  const doc = app.doc
  const l = doc?.active
  if (!doc || !l?.canvas) { toast('Select a layer with pixels first'); return }
  if (fromSel && !doc.selection) { toast('Make a selection first'); return }
  app.hist!.op(fromSel ? 'Mask from selection' : 'Add mask', () => {
    const m = canvas(doc.w, doc.h), x = ctx2d(m)
    if (fromSel) x.drawImage(doc.selection!, 0, 0)
    else { x.fillStyle = '#fff'; x.fillRect(0, 0, doc.w, doc.h) }
    l.mask = m; l.maskAI = copyCanvas(m); l.maskOff = false
    l.maskDirty = true; l.dirty = true
  })
}

export function invertMask(app: App) {
  const l = app.doc?.active
  if (!l?.mask) return
  app.hist!.op('Invert mask', () => {
    const m = canvas(l.mask!.width, l.mask!.height), x = ctx2d(m)
    x.fillStyle = '#fff'; x.fillRect(0, 0, m.width, m.height)
    x.globalCompositeOperation = 'destination-out'; x.drawImage(l.mask!, 0, 0)
    l.mask = m; l.maskDirty = true; l.dirty = true
  })
}

export function toggleMask(app: App) {
  const l = app.doc?.active
  if (!l?.mask) return
  app.hist!.op(l.maskOff ? 'Enable mask' : 'Disable mask', () => { l.maskOff = !l.maskOff; l.maskDirty = true; l.dirty = true; l.cache = null })
}

/** Makes the mask's effect permanent in the layer's pixels. */
export function applyMask(app: App, l = app.doc?.active) {
  if (!l?.mask || !l.canvas) return
  if (l.maskOff) { toast('The mask is disabled. Enable it first, or delete it.'); return }
  app.hist!.op('Apply mask', () => {
    const m = effectiveMask(l)!
    const c = copyCanvas(l.canvas!), x = ctx2d(c)
    x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0)
    l.canvas = c; l.mask = null; l.maskAI = null; l.maskOff = false; l.dirty = true; l.cache = null
  })
}

export function deleteMask(app: App, l = app.doc?.active) {
  if (!l?.mask) return
  app.hist!.op('Delete mask', () => { l.mask = null; l.maskAI = null; l.maskOff = false; l.dirty = true; l.cache = null })
}

/** Alt-click on an eye: show only this layer, or, when it already is the only one, show them all again. */
export function soloLayer(app: App, l: Layer) {
  const doc = app.doc!
  const others = doc.layers.filter(x => x !== l && x.kind !== 'group' && !isInside(doc, l, x) && !isInside(doc, x, l))
  const alone = others.every(x => !x.visible)
  app.hist!.op(alone ? 'Show all layers' : 'Show only ' + l.name, () => {
    for (const x of others) x.visible = alone
    l.visible = true
    for (const a of doc.layers) if (isInside(doc, l, a)) a.visible = true
  })
}

/** Right-click menu for layers. */
export function layerMenu(app: App, x: number, y: number) {
  const doc = app.doc
  const l = doc?.active
  if (!doc || !l) return
  document.querySelector('.ctx')?.remove()
  const many = doc.picked.size > 0
  const items: ([string, () => void, boolean?] | '-')[] = [
    ['Rename', () => (document.querySelector(`.lr[data-id="${l.id}"] .nm`) as HTMLElement | null)?.dispatchEvent(new MouseEvent('dblclick'))],
    ['Duplicate', () => duplicate(app)],
    [many ? 'Delete layers' : 'Delete', () => removeLayer(app)],
    '-',
    [many ? 'Merge layers' : 'Merge down', () => mergeDown(app)],
    ['Merge visible', () => mergeVisible(app)],
    [many ? 'Put layers in a folder' : 'Put in folder', () => groupLayer(app)],
    ...(l.kind === 'group' ? [['Remove folder, keep layers', () => ungroup(app)] as [string, () => void]] : []),
    '-',
    ...(l.canvas && !l.mask ? [['Add mask', () => addMask(app)] as [string, () => void], ['Mask from selection', () => addMask(app, true), !doc.selection] as [string, () => void, boolean]] : []),
    ...(l.mask ? [
      [l.maskOff ? 'Enable mask' : 'Disable mask', () => toggleMask(app)] as [string, () => void],
      ['Invert mask', () => invertMask(app)] as [string, () => void],
      ['Apply mask', () => applyMask(app)] as [string, () => void],
      ['Delete mask', () => deleteMask(app)] as [string, () => void]] : []),
    '-',
    ['Layer effects', () => app.setTool('effects'), !l.canvas || l.kind === 'background'],
    [l.locked ? 'Unlock' : 'Lock', () => app.hist!.op(l.locked ? 'Unlock layer' : 'Lock layer', () => { l.locked = !l.locked })],
    ['Show only this layer', () => soloLayer(app, l)]
  ]
  const box = h('div', { class: 'dd ctx', role: 'menu' })
  let last: any = '-'
  for (const it of items) {
    if (it === '-') { if (last !== '-') box.appendChild(h('hr')); last = it; continue }
    const [label, fn, off] = it
    box.appendChild(h('button', { role: 'menuitem', disabled: !!off, onclick: () => { close(); fn() } }, label))
    last = it
  }
  const close = () => { box.remove(); removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc, true) }
  const away = (e: Event) => { if (!box.contains(e.target as Node)) close() }
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  document.body.appendChild(box)
  const r = box.getBoundingClientRect()
  box.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'
  box.style.top = Math.min(y, innerHeight - r.height - 6) + 'px'
  addEventListener('pointerdown', away, true)
  addEventListener('keydown', esc, true)
  ;(box.querySelector('button:not([disabled])') as HTMLElement | null)?.focus()
}
