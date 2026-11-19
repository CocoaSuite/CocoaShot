import type { App } from '../app'
import { GROUPS, groupOf } from '../tools/types'
import { autoFit, h, icon, logo, tip, toast, confirmBox } from './dom'
import { newImageDialog } from './newimage'
import { addMask, applyMask, deleteMask, duplicate, groupLayer, invertMask, layersPanel, mergeDown, mergeVisible, newAdjust, newFolder, removeLayer, toggleMask, ungroup } from './layers'
import { FILTERS, openFilter } from '../tools/filters'
import { exportDialog, helpDialog, quickSettings, settingsDialog } from './dialogs'
import { actionsDialog } from './actions'
import { stopRecording } from '../core/actions'
import { ACTIONS, comboOf, fmtCombo } from './keys'
import { Viewport } from '../view/viewport'
import { native, RecentItem } from '../native'
import { applySelection, deletePixels, invert, selectAll } from '../tools/select'
import { rotate90, flip } from '../core/transform'
import { snapshot } from '../core/doc'
import { blackToAlpha } from '../core/px'
import { alphaOf, getData, putData } from '../core/util'
import { touch } from '../core/compose'
import { loadProject } from '../core/io'
import { flattenDoc } from '../core/actions'
import { jobBox } from '../tools/common'
import { groupKey, noteTool, psDock, psOptions, psStrip, saiBar, saiColor, saiNavigator, saiSizes, saiTools } from './styles'
import { checkForUpdates } from './update'
import { flipChosen } from '../tools/multi'
import { tr, tn, tx } from '../i18n'

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
      if (!d.selection) { toast(tr('Make a selection first')); return }
      const l = app.activeRaster()
      if (!l) return
      await app.copy()
      deletePixels(app, tr('Cut'))
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
    blackToAlpha: () => {
      const l = app.activeRaster(), doc = app.doc
      if (!l?.canvas || !doc || !app.hist) return
      app.hist.flush()
      const base = getData(l.canvas), { width: w, height: hh } = base
      const sel = doc.selection && doc.selection.width === w && doc.selection.height === hh ? alphaOf(doc.selection) : null
      putData(l.canvas, new ImageData(blackToAlpha(base.data, sel), w, hh), 0, 0)
      touch(l)
      app.hist.raster(tr('Black to transparency'), l, 'canvas', { x: 0, y: 0, w, h: hh }, base)
      doc.changed()
    },
    levels: () => app.setTool('levels'),
    curves: () => app.doc && app.setTool('curves'),
    gmap: () => app.doc && app.setTool('gmap'),
    redact: () => app.doc && app.setTool('redact'),
    expand: () => app.doc && app.setTool('expand'),
    actions: () => actionsDialog(app),
    stopRec: () => { stopRecording(app) },
    rulers: () => { app.settings.rulers = !app.settings.rulers; app.saveSettings(); app.emit('view-settings'); app.view.draw() },
    guides: () => { app.settings.showGuides = !app.settings.showGuides; app.saveSettings(); app.emit('view-settings'); app.view.draw() },
    snap: () => { app.settings.snap = !app.settings.snap; app.saveSettings(); app.emit('view-settings'); toast(app.settings.snap ? tr('Snapping on') : tr('Snapping off')) },
    clearGuides: () => {
      const d = app.doc
      if (!d || (!d.guides.x.length && !d.guides.y.length)) return
      const before = snapshot(d)
      d.guides = { x: [], y: [] }
      app.hist!.structural(tr('Clear guides'), before)
      d.changed(null)
    },
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
    deselect: () => app.doc?.selection && applySelection(app, null, 'new', tr('Deselect')),
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
      if (d.layers.length < n) toast(tr('Deleted {0}', a.name), { action: tr('Undo'), onAction: () => app.undo() })
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
    rotl: () => app.doc && (app.record({ kind: 'rotate', dir: -1 }), rotate90(app.doc, app.hist!, -1), app.view.fit()),
    rotr: () => app.doc && (app.record({ kind: 'rotate', dir: 1 }), rotate90(app.doc, app.hist!, 1), app.view.fit()),
    fliph: () => app.doc && (app.record({ kind: 'flip', horiz: true }), flip(app.doc, app.hist!, true)),
    flipLayerH: () => app.doc && flipChosen(app, true),
    flipLayerV: () => app.doc && flipChosen(app, false),
    flipv: () => app.doc && (app.record({ kind: 'flip', horiz: false }), flip(app.doc, app.hist!, false)),
    resize: () => app.setTool('resize'),
    cropSel: () => app.emit('crop-to-selection'),
    flattenImg: () => { if (app.doc) { app.record({ kind: 'flatten' }); flattenDoc(app) } },
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
  const zoomLbl = tip(h('button', { class: 'zoom', 'data-fit': 2, onclick: () => app.view.fit(true) }, '100%'), tr('Fit to screen'))
  const ib = (ic: string, label: string, act: string, fit?: number) => tip(h('button', { class: 'ic', 'data-fit': fit, onclick: () => run[act]() }, icon(ic)), label)
  const undoB = ib('undo', tr('Undo'), 'undo'), redoB = ib('redo', tr('Redo'), 'redo')
  const cmpB = ib('compare', tr('Before and after'), 'compare', 3)
  const exportB = h('button', { class: 'pri', style: { marginLeft: '4px' }, onclick: () => run.export() }, tr('Export'))
  // While an action records: what is recording, how many steps so far, and Stop.
  const recPill = h('span', { class: 'recpill', hidden: true })
  const renderRec = () => {
    const r = app.recording
    recPill.hidden = !r
    recPill.innerHTML = ''
    if (!r) return
    recPill.append(h('i', { class: 'dot rec' }), h('span', { class: 'rn' }, tr('Recording {0}', r.name)), h('span', { class: 'mute' }, String(r.steps.length)),
      h('button', { onclick: () => run.stopRec() }, tr('Stop')))
  }
  app.on('recording', renderRec)
  const top = h('header', { id: 'top' },
    h('div', { class: 'brand' }, logo(), h('span', { 'data-fit': 7 }, 'CocoaShot')),
    menu(tr('File'), () => [[tr('New image'), 'newImage', 'plus'], [tr('Open image'), 'open', 'open'], [tr('Open project'), 'openProject', 'folder'], [tr('New image from clipboard'), 'newPaste', 'image'], '-', [tr('Save project'), 'save', 'save'], [tr('Save project as'), 'saveAs'], [tr('Export image'), 'export', 'download'], '-', [app.recording ? tr('Stop recording') : tr('Actions'), app.recording ? 'stopRec' : 'actions', 'actions'], '-', [tr('Close image'), 'close', 'x']]),
    menu(tr('Edit'), [[tr('Undo'), 'undo', 'undo'], [tr('Redo'), 'redo', 'redo'], '-', [tr('Cut'), 'cut', 'cut'], [tr('Copy'), 'copy', 'copy'], [tr('Paste as layer'), 'paste'], [tr('Paste as new image'), 'newPaste', 'image'], [tr('Delete'), 'delete', 'trash'], '-', [tr('Select all'), 'selectAll'], [tr('Deselect'), 'deselect'], [tr('Invert selection'), 'invert'], '-', [tr('Settings'), 'settings', 'gear']]),
    menu(tr('Image'), [[tr('Resize'), 'resize', 'resize'], [tr('Crop to selection'), 'cropSel', 'crop'], [tr('Expand canvas'), 'expand', 'expand'], [tr('Redact'), 'redact', 'redact'], [tr('Free transform'), 'transform', 'transform'], [tr('Distort'), 'distort'], [tr('Warp'), 'warp'], '-', [tr('Rotate left'), 'rotl', 'rotl'], [tr('Rotate right'), 'rotr', 'rotr'], [tr('Flip image horizontally'), 'fliph', 'fliph'], [tr('Flip image vertically'), 'flipv', 'flipv'], '-', [tr('Flatten image'), 'flattenImg', 'layers']]),
    menu(tr('Layer'), [[tr('New layer'), 'newLayer', 'plus'], [tr('New folder'), 'newFolder', 'folder'], [tr('New adjustment layer'), 'newAdjust', 'sliders'], [tr('Duplicate layer'), 'dupLayer', 'copy'], [tr('Delete layer'), 'delLayer', 'trash'], '-', [tr('Merge down'), 'mergeDown'], [tr('Merge visible'), 'mergeVisible'], [tr('Put in folder'), 'groupLayer'], [tr('Remove folder, keep layers'), 'ungroup'], '-', [tr('Add mask'), 'addMask', 'mask'], [tr('Mask from selection'), 'maskFromSel'], [tr('Disable or enable mask'), 'toggleMask'], [tr('Invert mask'), 'invertMask'], [tr('Apply mask'), 'applyMask'], [tr('Delete mask'), 'deleteMask'], '-', [tr('Layer effects'), 'effects', 'fx'], [tr('Flip horizontally'), 'flipLayerH', 'fliph'], [tr('Flip vertically'), 'flipLayerV', 'flipv'], [tr('Free transform'), 'transform', 'transform'], [tr('Distort'), 'distort'], [tr('Warp'), 'warp'], [tr('Edit layer alpha'), 'editAlpha', 'alpha'], [tr('Black to transparency'), 'blackToAlpha'], [tr('Levels'), 'levels', 'levels'], [tr('Curves'), 'curves', 'curves'], [tr('Gradient map'), 'gmap', 'gmap'], '-', [tr('Flatten image'), 'flattenImg', 'layers']]),
    menu(tr('Filter'), () => {
      const out: ([string, string, string?] | '-')[] = []
      let cat = ''
      for (const f of FILTERS) { if (cat && f.cat !== cat) out.push('-'); cat = f.cat; out.push([f.label, 'filter:' + f.id]) }
      return out
    }),
    menu(tr('Select'), [[tr('Select all'), 'selectAll'], [tr('Deselect'), 'deselect'], [tr('Invert selection'), 'invert'], '-', [tr('Cut'), 'cut', 'cut'], [tr('Copy'), 'copy', 'copy'], [tr('Delete pixels'), 'delete', 'trash']]),
    menu(tr('View'), () => [[tr('Zoom in'), 'zoomIn', 'plus'], [tr('Zoom out'), 'zoomOut', 'minus'], [tr('Fit to screen'), 'fit', 'fit'], [tr('Actual pixels'), 'actual'], [tr('Before and after'), 'compare', 'compare'], '-', [tr('Rotate view left'), 'viewRotL', 'rotl'], [tr('Rotate view right'), 'viewRotR', 'rotr'], [tr('Reset rotation'), 'viewRot0'], [tr('Flip view'), 'viewFlip', 'fliph'], '-', [tr('Rulers'), 'rulers', app.settings.rulers ? 'check' : 'ruler'], [tr('Guides'), 'guides', app.settings.showGuides ? 'check' : 'guide'], [tr('Snap'), 'snap', app.settings.snap ? 'check' : undefined], [tr('Clear guides'), 'clearGuides'], '-', [app.fullscreen || document.fullscreenElement ? tr('Exit full screen') : tr('Full screen'), 'fullscreen', 'fullscreen'], [tr('Show or hide panels'), 'panels'], [tr('Show or hide tools'), 'toggleLeft'], [tr('Show or hide properties'), 'toggleRight'], [tr('Restore default layout'), 'resetLayout']]),
    menu(tr('Help'), () => [[tr('Quick guide'), 'help', 'help'], ...(native ? [[tr('Check for updates'), 'updates', 'update'] as [string, string, string]] : []), [tr('About CocoaShot'), 'about']]),
    h('span', { class: 'sep' }), dname, status, h('span', { class: 'sp' }),
    h('span', { class: 'topc', 'data-fit': 8 }, ib('open', tr('Open image'), 'open', 4), ib('save', tr('Save project'), 'save', 4), h('span', { class: 'sep', 'data-fit': 4 }), undoB, redoB, h('span', { class: 'sep', 'data-fit': 2 }),
      ib('minus', tr('Zoom out'), 'zoomOut', 2), zoomLbl, ib('plus', tr('Zoom in'), 'zoomIn', 2), ib('fit', tr('Fit to screen'), 'fit', 3), cmpB), recPill, ib('gear', tr('Settings'), 'settings'), exportB)
  // When the window is narrow the status, then the shortcut icons (they repeat menu items) give way, the menus close
  // up, and only then does the image name shrink; the brand name and the last icons go last.
  status.dataset.fit = '1'
  const fitTop = autoFit(top, 8)

  const tools = h('div', { id: 'tools' })
  const layersBox = h('div', { id: 'layersBox' })
  const toolsHead = h('div', { class: 'ph' }, tr('Tools'))
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
  let tab: 'props' | 'hist' | 'set' = 'props'
  const showTab = (t: 'props' | 'hist' | 'set') => { tab = t; renderInsp(); app.emit('insp-tab') }
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
        tip(h('button', { class: 'dx', onclick: (e: Event) => { e.stopPropagation(); app.closeDoc(d) } }, icon('x')), tr('Close')))
      b.addEventListener('auxclick', e => { if ((e as MouseEvent).button === 1) app.closeDoc(d) })
      docTabs.append(b)
    }
    if (app.docs.length) docTabs.append(tip(h('button', { class: 'dx add', onclick: () => run.open() }, icon('plus')), tr('Open image')))
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
    tabs.append(h('button', { class: tab === 'props' ? 'on' : '', onclick: () => showTab('props') }, tr('Properties')), h('button', { class: tab === 'hist' ? 'on' : '', onclick: () => showTab('hist') }, tr('History')),
      tip(h('button', { class: 'tset' + (tab === 'set' ? ' on' : ''), 'aria-label': tr('Settings'), onclick: () => showTab('set') }, icon('gear'), h('span', { class: 'tl' }, tr('Settings'))), tr('Settings')))
    const sc = insp.scrollTop
    insp.innerHTML = ''
    if (tab === 'set') {
      const p = quickSettings(app)
      p.classList.remove('ib')
      p.style.display = 'flex'; p.style.flexDirection = 'column'; p.style.gap = '9px'
      insp.appendChild(p)
      insp.scrollTop = sc
      return
    }
    if (!app.doc) { insp.appendChild(h('p', { class: 'hint' }, tr('Open an image to start.'))); return }
    lastActive = app.doc.activeId
    if (tab === 'hist') {
      const hs = app.hist!
      const list = h('div', { class: 'hist' })
      list.appendChild(h('button', { class: hs.past.length === 0 ? 'on' : '', onclick: () => hs.jump(-1) }, tr('Opened {0}', app.doc.name)))
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
    for (const [v, t] of [['normal', tr('Transparent')], ['mask', tr('Mask')], ['overlay', tr('Overlay')]] as const)
      float.appendChild(h('button', { class: app.view.maskView === v ? 'on' : '', onclick: () => { app.view.maskView = v; app.view.draw(); renderFloat(); renderInsp() } }, t))
  }

  const start = h('div', { class: 'start' })
  desk.appendChild(start)
  const renderStart = async () => {
    start.hidden = !!app.doc
    if (app.doc) return
    start.innerHTML = ''
    const drop = h('div', { class: 'drop', onclick: () => run.open() }, h('div', {}, icon('image', 'i'), h('div', { style: { marginTop: '8px' } }, tr('Drop an image here')), h('div', { class: 'hint', style: { marginTop: '2px' } }, 'PNG, JPG, WEBP, AVIF, HEIC, BMP, TIFF, GIF, PSD, SVG, ICO, TGA')))
    ;(drop.querySelector('svg') as SVGElement).style.cssText = 'width:22px;height:22px;margin:0 auto;color:var(--mute)'
    const rec = h('div', { class: 'rec' })
    const card = h('div', { class: 'card' },
      h('div', {}, h('h1', logo(), 'CocoaShot'), h('p', { class: 'hint', style: { fontSize: '13.5px', marginTop: '6px' } }, tr('Open an image or start a blank one. Everything stays on this computer.'))),
      h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'pri big', onclick: () => run.open() }, tr('Open image')),
        h('button', { class: 'big', onclick: () => run.newImage() }, tr('New image')),
        h('button', { class: 'big', onclick: () => run.newPaste() }, tr('Paste from clipboard')),
        h('button', { class: 'big', onclick: () => run.openProject() }, tr('Open project'))),
      drop, rec)
    start.appendChild(card)
    if (native) {
      const got = await native.loadRecovery()
      const items = !got ? [] : got instanceof ArrayBuffer ? [{ id: 'legacy', data: got }] : got
      if (items.length && !app.doc) {
        const n = items.length
        rec.before(h('div', { class: 'job' }, h('div', { class: 'fr' }, h('span', n > 1 ? tr('Unsaved work on {0} images from your last session can be recovered.', n) : tr('Unsaved work from your last session can be recovered.')),
          h('span', { style: { display: 'flex', gap: '6px' } },
            h('button', { onclick: () => native!.clearRecovery().then(renderStart) }, tr('Discard')),
            h('button', { class: 'pri', onclick: async () => {
              for (const it of items) {
                try {
                  const d = await loadProject(it.data, tr('Recovered') + '.cocoashot')
                  d.modified = true
                  // Keep the copy on disk until the image is saved or closed, under the same name.
                  if (it.id !== 'legacy') d.rid = it.id
                  app.setDoc(d)
                  if (it.id === 'legacy') native!.saveRecovery(it.data as any, d.rid).then(() => native!.clearRecovery('legacy'))
                } catch { toast(tr('One recovered image could not be read'), { err: true }) }
              }
            } }, n > 1 ? tr('Recover all') : tr('Recover'))))))
      }
      const list: RecentItem[] = await native.recent()
      if (list.length) {
        rec.appendChild(h('div', { class: 'ph', style: { padding: '0 0 6px' } }, tr('Recent')))
        for (const r of list.slice(0, 6)) rec.appendChild(h('button', { onclick: async () => { const f = await native!.readPath(r.path); if (f) app.openFile(f); else toast(tr('That file has moved or been deleted')) } },
          h('span', { class: 'thumb chk', style: { width: '44px', height: '32px' } }, r.thumb ? h('img', { src: r.thumb, style: { maxWidth: '100%', maxHeight: '100%' } }) : icon('image')),
          h('span', { class: 'sp', style: { textAlign: 'left' } }, r.name), h('span', { class: 'mute', style: { fontSize: '12px' } }, new Date(r.at).toLocaleDateString())))
      }
    }
  }

  const renderFoot = () => {
    foot.innerHTML = ''
    const d = app.doc
    if (d) foot.append(h('span', `${d.w} × ${d.h} px`), h('span', tn(d.layers.length, '{0} layer', '{0} layers')), h('span', Math.round(app.view.zoom * 100) + '%'))
    if (app.job) foot.append(h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('i', { class: 'dot busy' }), app.job.label + (app.job.progress != null ? ` ${Math.round(app.job.progress * 100)}%` : '')))
    foot.append(h('span', { class: 'sp' }), h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px' } }, h('i', { class: 'dot' }), tr('Processing on this device')))
  }
  const renderTop = () => {
    const d = app.doc
    dname.textContent = d ? d.name : ''
    ;(status.lastChild as HTMLElement).textContent = d ? (d.modified ? tr('Edited') : d.projectPath ? tr('Saved') : tr('Not saved')) : ''
    status.hidden = !d
    ;(status.firstChild as HTMLElement).className = 'dot' + (d?.modified ? ' busy' : '')
    undoB.toggleAttribute('disabled', !app.canUndo())
    redoB.toggleAttribute('disabled', !app.canRedo())
    exportB.toggleAttribute('disabled', !d)
    cmpB.classList.toggle('on', app.view.compare === 'split')
    zoomLbl.textContent = Math.round(app.view.zoom * 100) + '%'
    fitTop()
  }

  app.on('tool', () => { renderTools(); renderInsp(); renderFloat() })
  app.on('panel', renderInsp)
  app.on('doc', () => { renderInsp(); renderTop(); renderStart(); renderFoot(); renderFloat() })
  app.on('layers', () => { if (tab === 'hist' || app.doc?.activeId !== lastActive) renderInsp(); renderFoot(); renderFloat(); renderTop() })
  app.on('view-settings', () => { if (tab === 'set') renderInsp() })
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
    else if (app.doc || ['newImage', 'open', 'openProject', 'paste', 'newPaste', 'updates', 'fullscreen', 'panels', 'settings', 'help', 'actions', 'rulers', 'guides', 'snap'].includes(id)) run[id]?.()
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
