import type { App } from '../app'
import { GROUPS, groupOf } from '../tools/types'
import { h, icon, logo, tip, toast, confirmBox } from './dom'
import { newImageDialog } from './newimage'
import { addMask, applyMask, deleteMask, duplicate, groupLayer, invertMask, layersPanel, mergeDown, mergeVisible, newAdjust, newFolder, removeLayer, toggleMask, ungroup } from './layers'
import { FILTERS, openFilter } from '../tools/filters'
import { exportDialog, helpDialog, settingsDialog } from './dialogs'
import { ACTIONS, comboOf, fmtCombo } from './keys'
import { Viewport } from '../view/viewport'
import { native, RecentItem } from '../native'
import { applySelection, deletePixels, invert, selectAll } from '../tools/select'
import { rotate90, flip } from '../core/transform'
import { snapshot } from '../core/doc'
import { flatten } from '../core/compose'
import { loadProject } from '../core/io'
import { jobBox } from '../tools/common'
import { groupKey, noteTool, psDock, psOptions, psStrip, saiBar, saiColor, saiNavigator, saiSizes, saiTools } from './styles'
import { checkForUpdates } from './update'
import { flipChosen } from '../tools/multi'

export function buildShell(app: App, root: HTMLElement) {
  const run: Record<string, () => void> = {
    open: () => app.openDialog(),
    openProject: () => app.openDialog('project'),
    save: () => app.saveProject(),
    saveAs: () => app.saveProject(true),
    export: () => exportDialog(app),
    undo: () => app.undo(),
    redo: () => app.redo(),
    copy: () => app.copy(),
    cut: async () => {
      const d = app.doc
      if (!d) return
      if (!d.selection) { toast('Make a selection first'); return }
      const l = app.activeRaster()
      if (!l) return
      await app.copy()
      deletePixels(app, 'Cut')
    },
    fullscreen: () => app.toggleFullscreen(),
    newLayer: () => app.emit('new-layer'),
    newAdjust: () => app.doc && newAdjust(app),
    newFolder: () => app.doc && newFolder(app),
    groupLayer: () => app.doc && groupLayer(app),
    ungroup: () => app.doc && ungroup(app),
    effects: () => app.doc && app.setTool('effects'),
    transform: () => app.doc && app.setTool('transform'),
    distort: () => { if (app.doc) { app.setTool('transform'); app.emit('transform-mode', 'distort') } },
    warp: () => { if (app.doc) { app.setTool('transform'); app.emit('transform-mode', 'warp') } },
    gradient: () => app.doc && app.setTool('gradient'),
    lastFilter: () => app.doc && openFilter(app),
    ...Object.fromEntries(FILTERS.map(f => ['filter:' + f.id, () => { if (app.doc) openFilter(app, f.id) }])),
    dupLayer: () => app.doc && duplicate(app),
    mergeDown: () => app.doc && mergeDown(app),
    mergeVisible: () => app.doc && mergeVisible(app),
    addMask: () => app.doc && addMask(app),
    maskFromSel: () => app.doc && addMask(app, true),
    invertMask: () => app.doc && invertMask(app),
    toggleMask: () => app.doc && toggleMask(app),
    applyMask: () => app.doc && applyMask(app),
    deleteMask: () => app.doc && deleteMask(app),
    delLayer: () => app.doc && removeLayer(app),
    editAlpha: () => app.setTool('alpha'),
    levels: () => app.setTool('levels'),
    viewRotL: () => app.view.setAngle(app.view.angle - 15),
    viewRotR: () => app.view.setAngle(app.view.angle + 15),
    viewRot0: () => app.view.setAngle(0),
    viewFlip: () => app.view.setFlip(!app.view.flip),
    panels: () => {
      const s = app.settings
      const show = !(s.leftOpen || s.rightOpen)
      s.leftOpen = show; s.rightOpen = show
      layout()
    },
    paste: () => app.pasteLayer(),
    selectAll: () => app.doc && selectAll(app),
    deselect: () => app.doc?.selection && applySelection(app, null, 'new', 'Deselect'),
    invert: () => app.doc && invert(app),
    delete: () => {
      const d = app.doc
      if (!d) return
      if (d.selection) { deletePixels(app); return }
      // Without a selection, Delete removes the selected layer (Ctrl+Z brings it back).
      const a = d.active
      if (!a) return
      const n = d.layers.length
      removeLayer(app)
      if (d.layers.length < n) toast(`Deleted ${a.name}`, { action: 'Undo', onAction: () => app.undo() })
    },
    zoomIn: () => app.view.zoomStep(1),
    zoomOut: () => app.view.zoomStep(-1),
    fit: () => app.view.fit(true),
    actual: () => app.view.setZoom(1),
    compare: () => { app.view.compare = app.view.compare === 'split' ? 'off' : 'split'; app.emit('compare'); app.view.draw() },
    swap: () => app.setColors(app.bgc, app.fg),
    settings: () => settingsDialog(app),
    help: () => helpDialog(),
    about: () => settingsDialog(app, 'about'),
    updates: () => checkForUpdates(app),
    rotl: () => app.doc && (rotate90(app.doc, app.hist!, -1), app.view.fit()),
    rotr: () => app.doc && (rotate90(app.doc, app.hist!, 1), app.view.fit()),
    fliph: () => app.doc && flip(app.doc, app.hist!, true),
    flipLayerH: () => app.doc && flipChosen(app, true),
    flipLayerV: () => app.doc && flipChosen(app, false),
    flipv: () => app.doc && flip(app.doc, app.hist!, false),
    resize: () => app.setTool('resize'),
    cropSel: () => app.emit('crop-to-selection'),
    flattenImg: () => {
      const d = app.doc
      if (!d) return
      app.hist!.op('Flatten image', () => {
        const c = flatten(d)
        const base = d.layers.find(l => l.kind === 'image') || d.layers[0]
        base.canvas = c; base.mask = null; base.maskAI = null; base.visible = true; base.opacity = 1; base.blend = 'source-over'; base.clip = false; base.kind = 'image'; base.name = 'Image'
        base.parent = null; base.fx = null; base.fxCache = null
        base.dirty = true
        d.layers = [base]; d.activeId = base.id
      })
    },
    newImage: () => newImageDialog(app),
    newPaste: () => app.newFromClipboard(),
    close: () => app.closeDoc(),
    toggleLeft: () => { app.settings.leftOpen = !app.settings.leftOpen; layout() },
    toggleRight: () => { app.settings.rightOpen = !app.settings.rightOpen; layout() },
    resetLayout: () => { Object.assign(app.settings, { leftW: 220, rightW: 288, leftOpen: true, rightOpen: true }); layout() }
  }

  let openMenu: HTMLElement | null = null
  const closeMenus = () => { openMenu?.classList.remove('on'); openMenu = null }
  addEventListener('pointerdown', e => { if (openMenu && !openMenu.contains(e.target as Node)) closeMenus() })
  const menu = (title: string, items: ([string, string, string?] | '-')[] | (() => ([string, string, string?] | '-')[])) => {
    const dd = h('div', { class: 'dd', role: 'menu' })
    const mn = h('div', { class: 'mn' }, h('button', { class: 'mt', onclick: () => {
      if (openMenu === mn) return closeMenus()
      closeMenus()
      dd.innerHTML = ''
      for (const it of typeof items === 'function' ? items() : items) {
        if (it === '-') { dd.appendChild(h('hr')); continue }
        const [label, act, ic] = it
        const key = keymap().get('#' + act)
        dd.appendChild(h('button', { role: 'menuitem', onclick: () => { closeMenus(); run[act]?.() } }, ic ? icon(ic) : h('span', { style: { width: '16px' } }), label,
          key ? h('span', { class: 'kb' }, fmtCombo(key)) : null))
      }
      mn.classList.add('on'); openMenu = mn
      ;(dd.querySelector('button') as HTMLElement | null)?.focus()
    } }, title), dd)
    // Arrow keys move through an open menu, Escape closes it.
    dd.addEventListener('keydown', e => {
      const items = [...dd.querySelectorAll('button')] as HTMLElement[]
      const i = items.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus() }
      else if (e.key === 'Escape') { e.stopPropagation(); closeMenus() }
    })
    return mn
  }

  const dname = h('span', { class: 'dname' })
  const status = h('span', { class: 'status' }, h('i', { class: 'dot' }), h('span'))
  const zoomLbl = tip(h('button', { class: 'zoom', onclick: () => app.view.fit(true) }, '100%'), 'Fit to screen')
  const ib = (ic: string, label: string, act: string) => tip(h('button', { class: 'ic', onclick: () => run[act]() }, icon(ic)), label)
  const undoB = ib('undo', 'Undo', 'undo'), redoB = ib('redo', 'Redo', 'redo')
  const cmpB = ib('compare', 'Before and after', 'compare')
  const exportB = h('button', { class: 'pri', style: { marginLeft: '4px' }, onclick: () => run.export() }, 'Export')
  const top = h('header', { id: 'top' },
    h('div', { class: 'brand' }, logo(), 'CocoaShot'),
    menu('File', () => [['New image', 'newImage', 'plus'], ['Open image', 'open', 'open'], ['Open project', 'openProject', 'folder'], ['New image from clipboard', 'newPaste', 'image'], '-', ['Save project', 'save', 'save'], ['Save project as', 'saveAs'], ['Export image', 'export', 'download'], '-', ['Close image', 'close', 'x']]),
    menu('Edit', [['Undo', 'undo', 'undo'], ['Redo', 'redo', 'redo'], '-', ['Cut', 'cut', 'cut'], ['Copy', 'copy', 'copy'], ['Paste as layer', 'paste'], ['Paste as new image', 'newPaste', 'image'], ['Delete', 'delete', 'trash'], '-', ['Select all', 'selectAll'], ['Deselect', 'deselect'], ['Invert selection', 'invert'], '-', ['Settings', 'settings', 'gear']]),
    menu('Image', [['Resize', 'resize', 'resize'], ['Crop to selection', 'cropSel', 'crop'], ['Free transform', 'transform', 'transform'], ['Distort', 'distort'], ['Warp', 'warp'], '-', ['Rotate left', 'rotl', 'rotl'], ['Rotate right', 'rotr', 'rotr'], ['Flip image horizontally', 'fliph', 'fliph'], ['Flip image vertically', 'flipv', 'flipv'], '-', ['Flatten image', 'flattenImg', 'layers']]),
    menu('Layer', [['New layer', 'newLayer', 'plus'], ['New folder', 'newFolder', 'folder'], ['New adjustment layer', 'newAdjust', 'sliders'], ['Duplicate layer', 'dupLayer', 'copy'], ['Delete layer', 'delLayer', 'trash'], '-', ['Merge down', 'mergeDown'], ['Merge visible', 'mergeVisible'], ['Put in folder', 'groupLayer'], ['Remove folder, keep layers', 'ungroup'], '-', ['Add mask', 'addMask', 'mask'], ['Mask from selection', 'maskFromSel'], ['Disable or enable mask', 'toggleMask'], ['Invert mask', 'invertMask'], ['Apply mask', 'applyMask'], ['Delete mask', 'deleteMask'], '-', ['Layer effects', 'effects', 'fx'], ['Flip horizontally', 'flipLayerH', 'fliph'], ['Flip vertically', 'flipLayerV', 'flipv'], ['Free transform', 'transform', 'transform'], ['Distort', 'distort'], ['Warp', 'warp'], ['Edit layer alpha', 'editAlpha', 'alpha'], ['Levels', 'levels', 'levels'], '-', ['Flatten image', 'flattenImg', 'layers']]),
    menu('Filter', () => {
      const out: ([string, string, string?] | '-')[] = []
      let cat = ''
      for (const f of FILTERS) { if (cat && f.cat !== cat) out.push('-'); cat = f.cat; out.push([f.label, 'filter:' + f.id]) }
      return out
    }),
    menu('Select', [['Select all', 'selectAll'], ['Deselect', 'deselect'], ['Invert selection', 'invert'], '-', ['Cut', 'cut', 'cut'], ['Copy', 'copy', 'copy'], ['Delete pixels', 'delete', 'trash']]),
    menu('View', () => [['Zoom in', 'zoomIn', 'plus'], ['Zoom out', 'zoomOut', 'minus'], ['Fit to screen', 'fit', 'fit'], ['Actual pixels', 'actual'], ['Before and after', 'compare', 'compare'], '-', ['Rotate view left', 'viewRotL', 'rotl'], ['Rotate view right', 'viewRotR', 'rotr'], ['Reset rotation', 'viewRot0'], ['Flip view', 'viewFlip', 'fliph'], '-', [app.fullscreen || document.fullscreenElement ? 'Exit full screen' : 'Full screen', 'fullscreen', 'fullscreen'], ['Show or hide panels', 'panels'], ['Show or hide tools', 'toggleLeft'], ['Show or hide properties', 'toggleRight'], ['Restore default layout', 'resetLayout']]),
    menu('Help', () => [['Quick guide', 'help', 'help'], ...(native ? [['Check for updates', 'updates', 'update'] as [string, string, string]] : []), ['About CocoaShot', 'about']]),
    h('span', { class: 'sep' }), dname, status, h('span', { class: 'sp' }),
    h('span', { class: 'topc' }, ib('open', 'Open image', 'open'), ib('save', 'Save project', 'save'), h('span', { class: 'sep' }), undoB, redoB, h('span', { class: 'sep' }),
      ib('minus', 'Zoom out', 'zoomOut'), zoomLbl, ib('plus', 'Zoom in', 'zoomIn'), ib('fit', 'Fit to screen', 'fit'), cmpB, ib('gear', 'Settings', 'settings')), exportB)

  const tools = h('div', { id: 'tools' })
  const layersBox = h('div', { id: 'layersBox' })
  const toolsHead = h('div', { class: 'ph' }, 'Tools')
  const left = h('aside', { id: 'left' })
  const tabs = h('div', { class: 'tabs' })
  const insp = h('div', { class: 'ib', id: 'insp' })
  const right = h('aside', { id: 'right' })
  const desk = h('main', { id: 'desk', tabIndex: -1 })
  const docTabs = h('div', { id: 'doctabs', role: 'tablist' })
  const center = h('div', { id: 'center' })
  const g1 = h('div', { class: 'grip' }), g2 = h('div', { class: 'grip' })
  const mid = h('div', { id: 'mid' })
  const foot = h('footer', { id: 'foot' })
  app.view = new Viewport(app, desk)
  let tab: 'props' | 'hist' = 'props'
  const showTab = (t: 'props' | 'hist') => { tab = t; renderInsp(); app.emit('insp-tab') }
  const opts = psOptions(app, run), strip = psStrip(app, run), dock = psDock(app, showTab, () => tab)
  const sbar = saiBar(app, run), nav = saiNavigator(app), scol = saiColor(app), stiles = saiTools(app), ssizes = saiSizes(app)
  const col1 = h('aside', { id: 'col1' }), col2 = h('aside', { id: 'col2' })

  const arrange = () => {
    const st = app.settings.uiStyle || 'classic'
    const r = document.documentElement
    for (const c of ['ui-classic', 'ui-ps', 'ui-sai']) r.classList.toggle(c, c === 'ui-' + st)
    root.innerHTML = ''
    mid.innerHTML = ''; left.innerHTML = ''; right.innerHTML = ''; center.innerHTML = ''; col1.innerHTML = ''; col2.innerHTML = ''
    if (st === 'ps') {
      center.append(docTabs, desk)
      right.append(tabs, insp, layersBox)
      mid.append(strip, center, g2, dock, right)
      root.append(top, opts, mid, foot)
    } else if (st === 'sai') {
      center.append(desk, docTabs)
      col1.append(nav, layersBox)
      col2.append(scol, stiles, h('div', { class: 'pnl grow' }, tabs, insp, ssizes))
      mid.append(col1, col2, center)
      root.append(top, sbar, mid, foot)
    } else {
      center.append(docTabs, desk)
      left.append(toolsHead, tools, layersBox)
      right.append(tabs, insp)
      mid.append(left, g1, center, g2, right)
      root.append(top, mid, foot)
    }
    app.applyTheme()
    renderTabs()
    renderInsp()
    requestAnimationFrame(() => app.view.resize())
  }

  const renderTabs = () => {
    docTabs.innerHTML = ''
    const st = app.settings.uiStyle || 'classic'
    docTabs.hidden = !(app.docs.length > 1 || (st !== 'classic' && app.docs.length > 0))
    for (const d of app.docs) {
      const on = d === app.doc
      const b = h('div', { class: 'dtab' + (on ? ' on' : ''), role: 'tab', 'aria-selected': on ? 'true' : 'false', onclick: () => app.activate(d), title: d.name },
        h('span', { class: 'dn' }, d.name), d.modified ? h('i', { class: 'dot busy' }) : null,
        on ? h('span', { class: 'mute dz' }, Math.round(app.view.zoom * 100) + '%') : null,
        tip(h('button', { class: 'dx', onclick: (e: Event) => { e.stopPropagation(); app.closeDoc(d) } }, icon('x')), 'Close'))
      b.addEventListener('auxclick', e => { if ((e as MouseEvent).button === 1) app.closeDoc(d) })
      docTabs.append(b)
    }
    if (app.docs.length) docTabs.append(tip(h('button', { class: 'dx add', onclick: () => run.open() }, icon('plus')), 'Open image'))
  }
  app.on('tabs', renderTabs)
  app.on('zoom', renderTabs)
  app.on('style', arrange)

  const layout = () => {
    mid.style.setProperty('--sw', app.settings.toolCols === 2 ? '84px' : '48px')
    mid.style.setProperty('--lw', app.settings.leftW + 'px')
    mid.style.setProperty('--rw', app.settings.rightW + 'px')
    mid.classList.toggle('nol', !app.settings.leftOpen)
    mid.classList.toggle('nor', !app.settings.rightOpen)
    app.saveSettings()
  }
  const grip = (g: HTMLElement, side: 'l' | 'r') => g.addEventListener('pointerdown', e => {
    g.setPointerCapture(e.pointerId); g.classList.add('drag')
    const x0 = e.clientX, w0 = side === 'l' ? app.settings.leftW : app.settings.rightW
    const mv = (ev: PointerEvent) => {
      const w = Math.max(180, Math.min(460, w0 + (side === 'l' ? ev.clientX - x0 : x0 - ev.clientX)))
      if (side === 'l') app.settings.leftW = w; else app.settings.rightW = w
      layout()
    }
    g.addEventListener('pointermove', mv)
    g.addEventListener('pointerup', () => { g.removeEventListener('pointermove', mv); g.classList.remove('drag') }, { once: true })
  })
  grip(g1, 'l'); grip(g2, 'r')
  layout()

  const renderTools = () => {
    tools.innerHTML = ''
    const cur = groupOf(app.toolId)
    for (const g of GROUPS) {
      const on = cur?.id === g.id
      tools.appendChild(h('button', { class: 'tr' + (on ? ' on' : ''), onclick: () => app.setTool(on ? app.toolId : g.tools[0]) }, icon(g.icon), g.name))
      if (on && g.tools.length > 1) tools.appendChild(h('div', { class: 'sub' }, g.tools.map(t => h('button', { class: t === app.toolId ? 'on' : '', onclick: () => app.setTool(t) }, app.tools.get(t)!.label))))
    }
  }

  let lastActive = ''
  const renderInsp = () => {
    tabs.innerHTML = ''
    tabs.append(h('button', { class: tab === 'props' ? 'on' : '', onclick: () => showTab('props') }, 'Properties'), h('button', { class: tab === 'hist' ? 'on' : '', onclick: () => showTab('hist') }, 'History'))
    const sc = insp.scrollTop
    insp.innerHTML = ''
    if (!app.doc) { insp.appendChild(h('p', { class: 'hint' }, 'Open an image to start.')); return }
    lastActive = app.doc.activeId
    if (tab === 'hist') {
      const hs = app.hist!
      const list = h('div', { class: 'hist' })
      list.appendChild(h('button', { class: hs.past.length === 0 ? 'on' : '', onclick: () => hs.jump(-1) }, 'Opened ' + app.doc.name))
      hs.past.forEach((e, i) => list.appendChild(h('button', { class: i === hs.past.length - 1 ? 'on' : '', onclick: () => hs.jump(i) }, e.label)))
      ;[...hs.future].reverse().forEach((e, i) => list.appendChild(h('button', { class: 'fut', onclick: () => hs.jump(hs.past.length + i) }, e.label)))
      insp.appendChild(list)
      return
    }
    const p = app.tool!.panel()
    p.classList.remove('ib')
    p.style.display = 'flex'; p.style.flexDirection = 'column'; p.style.gap = '9px'
    insp.appendChild(p)
    insp.scrollTop = sc
  }

  const float = h('div', { class: 'float', hidden: true })
  desk.appendChild(float)
  const renderFloat = () => {
    const l = app.doc?.active
    const bgTool = groupOf(app.toolId)?.id === 'bg'
    float.innerHTML = ''
    const show = !!app.doc && bgTool && !!(l?.mask || app.doc.layers.some(x => x.mask))
    float.hidden = !show
    if (!show) { if (app.view.maskView !== 'normal') { app.view.maskView = 'normal'; app.view.draw() } return }
    for (const [v, t] of [['normal', 'Transparent'], ['mask', 'Mask'], ['overlay', 'Overlay']] as const)
      float.appendChild(h('button', { class: app.view.maskView === v ? 'on' : '', onclick: () => { app.view.maskView = v; app.view.draw(); renderFloat(); renderInsp() } }, t))
  }

  const start = h('div', { class: 'start' })
  desk.appendChild(start)
  const renderStart = async () => {
    start.hidden = !!app.doc
    if (app.doc) return
    start.innerHTML = ''
    const drop = h('div', { class: 'drop', onclick: () => run.open() }, h('div', {}, icon('image', 'i'), h('div', { style: { marginTop: '8px' } }, 'Drop an image here'), h('div', { class: 'hint', style: { marginTop: '2px' } }, 'PNG, JPG, WEBP, AVIF, HEIC, BMP, TIFF, GIF, PSD, SVG, ICO, TGA')))
    ;(drop.querySelector('svg') as SVGElement).style.cssText = 'width:22px;height:22px;margin:0 auto;color:var(--mute)'
    const rec = h('div', { class: 'rec' })
    const card = h('div', { class: 'card' },
      h('div', {}, h('h1', logo(), 'CocoaShot'), h('p', { class: 'hint', style: { fontSize: '13.5px', marginTop: '6px' } }, 'Open an image or start a blank one. Everything stays on this computer.')),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'pri big', onclick: () => run.open() }, 'Open image'),
        h('button', { class: 'big', onclick: () => run.newImage() }, 'New image'),
        h('button', { class: 'big', onclick: () => run.newPaste() }, 'Paste from clipboard'),
        h('button', { class: 'big', onclick: () => run.openProject() }, 'Open project')),
      drop, rec)
    start.appendChild(card)
    if (native) {
      const got = await native.loadRecovery()
      const items = !got ? [] : got instanceof ArrayBuffer ? [{ id: 'legacy', data: got }] : got
      if (items.length && !app.doc) {
        const n = items.length
        rec.before(h('div', { class: 'job' }, h('div', { class: 'fr' }, h('span', n > 1 ? `Unsaved work on ${n} images from your last session can be recovered.` : 'Unsaved work from your last session can be recovered.'),
          h('span', { style: { display: 'flex', gap: '6px' } },
            h('button', { onclick: () => native!.clearRecovery().then(renderStart) }, 'Discard'),
            h('button', { class: 'pri', onclick: async () => {
              for (const it of items) {
                try {
                  const d = await loadProject(it.data, 'Recovered.cocoashot')
                  d.modified = true
                  // Keep the copy on disk until the image is saved or closed, under the same name.
                  if (it.id !== 'legacy') d.rid = it.id
                  app.setDoc(d)
                  if (it.id === 'legacy') native!.saveRecovery(it.data as any, d.rid).then(() => native!.clearRecovery('legacy'))
                } catch { toast('One recovered image could not be read', { err: true }) }
              }
            } }, n > 1 ? 'Recover all' : 'Recover')))))
      }
      const list: RecentItem[] = await native.recent()
      if (list.length) {
        rec.appendChild(h('div', { class: 'ph', style: { padding: '0 0 6px' } }, 'Recent'))
        for (const r of list.slice(0, 6)) rec.appendChild(h('button', { onclick: async () => { const f = await native!.readPath(r.path); if (f) app.openFile(f); else toast('That file has moved or been deleted') } },
          h('span', { class: 'thumb chk', style: { width: '44px', height: '32px' } }, r.thumb ? h('img', { src: r.thumb, style: { maxWidth: '100%', maxHeight: '100%' } }) : icon('image')),
          h('span', { class: 'sp', style: { textAlign: 'left' } }, r.name), h('span', { class: 'mute', style: { fontSize: '12px' } }, new Date(r.at).toLocaleDateString())))
      }
    }
  }

  const renderFoot = () => {
    foot.innerHTML = ''
    const d = app.doc
    if (d) foot.append(h('span', `${d.w} × ${d.h} px`), h('span', `${d.layers.length} layer${d.layers.length > 1 ? 's' : ''}`), h('span', Math.round(app.view.zoom * 100) + '%'))
    if (app.job) foot.append(h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('i', { class: 'dot busy' }), app.job.label + (app.job.progress != null ? ` ${Math.round(app.job.progress * 100)}%` : '')))
    foot.append(h('span', { class: 'sp' }), h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('i', { class: 'dot' }), 'Processing on this device'))
  }
  const renderTop = () => {
    const d = app.doc
    dname.textContent = d ? d.name : ''
    ;(status.lastChild as HTMLElement).textContent = d ? (d.modified ? 'Edited' : d.projectPath ? 'Saved' : 'Not saved') : ''
    status.hidden = !d
    ;(status.firstChild as HTMLElement).className = 'dot' + (d?.modified ? ' busy' : '')
    undoB.toggleAttribute('disabled', !app.canUndo())
    redoB.toggleAttribute('disabled', !app.canRedo())
    exportB.toggleAttribute('disabled', !d)
    cmpB.classList.toggle('on', app.view.compare === 'split')
    zoomLbl.textContent = Math.round(app.view.zoom * 100) + '%'
  }

  app.on('tool', () => { renderTools(); renderInsp(); renderFloat() })
  app.on('panel', renderInsp)
  app.on('doc', () => { renderInsp(); renderTop(); renderStart(); renderFoot(); renderFloat() })
  app.on('layers', () => { if (tab === 'hist' || app.doc?.activeId !== lastActive) renderInsp(); renderFoot(); renderFloat(); renderTop() })
  app.on('history', () => { renderTop(); if (tab === 'hist') renderInsp() })
  app.on('zoom', () => { renderTop(); renderFoot() })
  app.on('compare', renderTop)
  app.on('steps', renderTop)
  app.on('tool', renderTop)
  let jt = 0
  app.on('job', () => {
    renderFoot()
    const box = insp.querySelector('.job')
    const nb = jobBox(app)
    if (box && nb) box.replaceWith(nb)
    else { clearTimeout(jt); jt = window.setTimeout(renderInsp, 30) }
  })
  app.on('selection-empty', () => app.emit('selection'))
  app.on('selection', () => { if (groupOf(app.toolId)?.id === 'select') renderInsp() })

  layersPanel(app, layersBox)

  desk.addEventListener('dragover', e => { e.preventDefault(); desk.classList.add('drop') })
  desk.addEventListener('dragleave', () => desk.classList.remove('drop'))
  desk.addEventListener('drop', async e => {
    e.preventDefault(); desk.classList.remove('drop')
    const files = [...(e.dataTransfer?.files || [])]
    if (!files.length) return
    // Electron 32 and later only give a dropped file's path through webUtils.
    for (const f of files) {
      const path = native?.pathForFile?.(f) || (f as any).path || undefined
      await app.openFile({ name: f.name, path, data: await f.arrayBuffer() })
    }
  })

  /** Shortcut to action, plus '#action' to shortcut for showing keys in the menus. */
  function keymap() {
    const m = new Map<string, string>()
    for (const a of ACTIONS) { const k = app.settings.shortcuts[a.id] ?? a.key; if (k) { m.set(k, a.id); m.set('#' + a.id, k) } }
    return m
  }
  addEventListener('keydown', e => {
    const t = e.target as HTMLElement
    if (t?.closest?.('input,textarea,select,[contenteditable]') || document.querySelector('.modal')) return
    if (e.key === ' ' && !e.repeat) { app.view.space = true; app.view.updateCursor(); e.preventDefault(); return }
    if (app.tool?.key?.(e)) { e.preventDefault(); return }
    let c = comboOf(e)
    if (c === 'Mod+Shift+=') c = 'Mod+='
    if (c === 'Mod+Y' && !keymap().has(c)) c = 'Mod+Shift+Z'
    const id = keymap().get(c)
    if (!id) {
      if (e.key === 'Escape' && app.fullscreen && native) { app.toggleFullscreen(); return }
      if (e.key === 'Escape' && app.doc?.selection) run.deselect()
      return
    }
    e.preventDefault()
    if (id.startsWith('tool:')) { if (app.doc) app.setTool(app.settings.uiStyle === 'ps' ? groupKey(app, id.slice(5)) : id.slice(5)) }
    else if (app.doc || ['newImage', 'open', 'openProject', 'paste', 'newPaste', 'updates', 'fullscreen', 'panels', 'settings', 'help'].includes(id)) run[id]?.()
  })
  addEventListener('keyup', e => { if (e.key === ' ') { app.view.space = false; app.view.updateCursor() } })
  addEventListener('blur', () => { app.view.space = false })

  const fsChanged = (on: boolean) => { app.fullscreen = on; document.documentElement.classList.toggle('fs', on); app.view.resize() }
  native?.onFullScreen(fsChanged)
  document.addEventListener('fullscreenchange', () => fsChanged(!!document.fullscreenElement))
  native?.onOpenFile(f => app.openFile(f))
  native?.onWantClose(async () => { if (await app.closeAll()) { await native!.clearRecovery(); native!.closeNow() } })

  app.on('style', layout)
  app.on('tool', () => noteTool(app.toolId))
  arrange()
  renderTools(); renderInsp(); renderTop(); renderFoot(); renderStart()
}
