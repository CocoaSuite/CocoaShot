import { Doc, Layer, makeLayer, normalizeTree, shownLocked, snapshot } from './core/doc'
import { History } from './core/history'
import { flatten, layerFull, touch } from './core/compose'
import type { NewImageOpts } from './ui/newimage'
import { decodeImage, loadProject, saveProject, IMAGE_EXT, type ExportFormat } from './core/io'
import { alphaOf, bboxOfAlpha, canvas, ctx2d, Emitter, fitSize, getData } from './core/util'
import { cancelJobs } from './core/jobs'
import { Viewport } from './view/viewport'
import { native, downloadLocal, pickLocal, OpenedFile } from './native'
import { confirmBox, toast } from './ui/dom'
import type { Tool } from './tools/types'

export interface Settings {
  theme: 'dark' | 'light'
  exportFormat: ExportFormat
  exportQuality: number
  openLimit: number
  bgModel: 'isnet' | 'birefnet' | 'modnet'
  gpu: boolean
  autosave: number
  shortcuts: Record<string, string>
  exportFolder: string
  leftW: number
  rightW: number
  leftOpen: boolean
  rightOpen: boolean
  checkUpdates: boolean
  uiStyle: 'classic' | 'ps' | 'sai'
  toolCols: 1 | 2
  stabilizer: number
  newImage: NewImageOpts
}

const DEFAULTS: Settings = {
  theme: 'dark', exportFormat: 'png', exportQuality: 92, openLimit: 0, bgModel: 'isnet', gpu: true, autosave: 3,
  shortcuts: {}, exportFolder: '', leftW: 220, rightW: 288, leftOpen: true, rightOpen: true, checkUpdates: true, uiStyle: 'classic', toolCols: 1, stabilizer: 0,
  newImage: { w: 1920, h: 1080, bg: 'white', color: '#f4e9d8' }
}

export interface Job { label: string; progress: number | null; detail: string; cancel?: () => void; lock?: boolean }

export class App extends Emitter {
  doc: Doc | null = null
  hist: History | null = null
  view!: Viewport
  tools = new Map<string, Tool>()
  toolId = 'move'
  stroke: { preview?: () => any } | null = null
  fg = '#111111'
  bgc = '#ffffff'
  settings: Settings
  job: Job | null = null
  /** When each image last had a recovery copy written (or was saved). */
  private saved = new WeakMap<Doc, number>()
  /** Where the last image copied inside CocoaShot came from, so Paste can put it back in place. */
  private copied: { w: number; h: number; x: number; y: number } | null = null

  constructor() {
    super()
    let s: Partial<Settings> = {}
    try { s = JSON.parse(localStorage.getItem('cocoashot.settings') || '{}') } catch {}
    this.settings = { ...DEFAULTS, ...s, shortcuts: { ...(s.shortcuts || {}) }, newImage: { ...DEFAULTS.newImage, ...(s.newImage || {}) } }
    try { const c = JSON.parse(localStorage.getItem('cocoashot.fgbg') || 'null'); if (c) { this.fg = c[0]; this.bgc = c[1] } } catch {}
    this.applyTheme()
    setInterval(() => this.autosave(), 30000)
  }

  get tool() { return this.tools.get(this.toolId) }

  /** Undo the last action: a step inside the current tool first (a polygon corner, a handle drag), then the document history. */
  /** A long task is changing an image: undo, tab switches and closing wait for it. */
  get locked() { return !!this.job?.lock }
  private waitToast() { toast('Please wait for the current task to finish, or cancel it') }

  undo() {
    if (this.stroke) return
    if (this.locked) return this.waitToast()
    if (this.tool?.steps?.undo()) { this.view.draw(); this.emit('panel'); return }
    this.hist?.undo()
  }
  redo() {
    if (this.stroke) return
    if (this.locked) return this.waitToast()
    if (this.tool?.steps?.redo()) { this.view.draw(); this.emit('panel'); return }
    this.hist?.redo()
  }
  canUndo() { return !!(this.tool?.steps?.canUndo || this.hist?.past.length) }
  canRedo() { return !!(this.tool?.steps?.canRedo || this.hist?.future.length) }

  saveSettings() { try { localStorage.setItem('cocoashot.settings', JSON.stringify(this.settings)) } catch {} }
  setColors(fg: string, bg = this.bgc) {
    this.fg = fg; this.bgc = bg
    try { localStorage.setItem('cocoashot.fgbg', JSON.stringify([fg, bg])) } catch {}
    this.emit('colors')
  }
  applyTheme() {
    const r = document.documentElement
    r.classList.toggle('light', this.settings.theme === 'light')
    r.classList.toggle('wco', !!native && native.platform !== 'darwin')
    const cs = getComputedStyle(r)
    native?.setTitleBar(cs.getPropertyValue('--panel').trim(), cs.getPropertyValue('--fg').trim(), this.settings.uiStyle === 'sai' ? 31 : 41)
  }

  fullscreen = false
  async toggleFullscreen() {
    if (native) this.fullscreen = await native.toggleFullScreen()
    else if (document.fullscreenElement) await document.exitFullscreen()
    else await document.documentElement.requestFullscreen().catch(() => {})
  }

  setTool(id: string) {
    if (!this.tools.has(id)) return
    if (this.toolId === id) { this.emit('tool'); return }
    this.tool?.deactivate?.()
    this.toolId = id
    this.tool?.activate?.()
    this.emit('tool')
    this.view?.updateCursor()
    this.view?.draw()
  }

  docs: Doc[] = []
  private hists = new Map<Doc, History>()
  private views = new Map<Doc, { zoom: number; ox: number; oy: number; angle: number; flip: boolean }>()

  /** Opens d in a new tab (or switches to it), or closes the current tab when d is null. */
  setDoc(d: Doc | null) {
    if (!d) { if (this.doc) this.dropDoc(this.doc); return }
    if (this.locked && !this.docs.includes(d)) { this.waitToast(); return }
    if (!this.docs.includes(d)) {
      this.docs.push(d)
      this.hists.set(d, new History(d))
      d.on('change', r => { if (this.doc === d) this.view.dirty(r) })
      d.on('layers', () => { if (this.doc === d) this.emit('layers') })
      d.on('history', () => { if (this.doc === d) this.emit('history'); this.emit('tabs') })
      d.on('selection', () => { if (this.doc === d) { this.view.selectionChanged(); this.emit('selection') } })
      d.on('selection-live', r => { if (this.doc === d) this.view.dirty(r) })
    }
    this.activate(d)
  }

  activate(d: Doc | null) {
    if (d === this.doc && d) { this.emit('tabs'); return }
    if (this.locked && this.doc) { this.waitToast(); this.emit('tabs'); return }
    this.tool?.deactivate?.()
    if (this.doc) this.views.set(this.doc, { zoom: this.view.zoom, ox: this.view.ox, oy: this.view.oy, angle: this.view.angle, flip: this.view.flip })
    this.stroke = null
    this.doc = d
    this.hist = d ? this.hists.get(d)! : null
    this.view.compare = 'off'
    this.view.maskView = 'normal'
    this.view.alphaView = false
    this.view.selectionChanged()
    this.view.dirty(null)
    const vs = d && this.views.get(d)
    if (vs) { Object.assign(this.view, vs); this.emit('zoom'); this.view.draw() }
    else { this.view.angle = 0; this.view.flip = false; this.view.fit() }
    this.tool?.activate?.()
    this.emit('doc')
    this.emit('layers')
    this.emit('history')
    this.emit('tool')
    this.emit('tabs')
    this.emit('view')
    this.title()
  }

  private dropDoc(d: Doc) {
    const i = this.docs.indexOf(d)
    if (i < 0) return
    native?.clearRecovery(d.rid)
    if (this.doc === d) this.tool?.deactivate?.()
    this.docs.splice(i, 1)
    this.hists.delete(d)
    this.views.delete(d)
    if (this.doc === d) { this.doc = null; this.activate(this.docs[Math.min(i, this.docs.length - 1)] || null) }
    else this.emit('tabs')
  }

  async closeDoc(d = this.doc) {
    if (!d) return false
    if (this.locked) { this.waitToast(); return false }
    if (d.modified) {
      this.activate(d)
      if (!(await this.confirmDiscard())) return false
    }
    this.dropDoc(d)
    return true
  }

  async closeAll() {
    for (const d of [...this.docs]) if (!(await this.closeDoc(d))) return false
    return true
  }

  title() { native?.setTitle(this.doc ? `${this.doc.name} - CocoaShot` : 'CocoaShot') }

  async confirmDiscard(): Promise<boolean> {
    if (!this.doc || !this.doc.modified) return true
    const r = await confirmBox('Unsaved changes', `Save changes to ${this.doc.name} as a project before closing it?`, 'Save project', 'Cancel', "Don't save")
    if (r === 'no') return false
    if (r === 'yes') return await this.saveProject()
    return true
  }

  async openDialog(kind?: string) {
    const f = native ? await native.openDialog(kind) : await pickLocal(kind === 'project' ? '.cocoashot' : 'image/*,.psd,.tif,.tiff,.heic,.heif,.avif,.svg,.ico,.cur,.tga,.cocoashot')
    if (f) await this.openFile(f)
  }

  async openFile(f: OpenedFile) {
    const open = f.path && this.docs.find(d => d.path === f.path || d.projectPath === f.path)
    if (open) { this.activate(open); return }
    if (this.job) { this.waitToast(); return }
    try {
      this.busy('Opening ' + f.name)
      if (/\.cocoashot$/i.test(f.name)) {
        const d = await loadProject(f.data, f.name)
        d.projectPath = f.path || null
        this.setDoc(d)
      } else if (IMAGE_EXT.test(f.name)) {
        const r = await decodeImage(f.name, f.data)
        let c = r.canvas
        const lim = this.settings.openLimit
        if (lim && Math.max(c.width, c.height) > lim) {
          const s = fitSize(c.width, c.height, lim)
          const t = canvas(s.w, s.h)
          const x = ctx2d(t); x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, s.w, s.h)
          c = t
        }
        const d = new Doc(c, f.name.replace(/\.[^.]+$/, ''))
        d.path = f.path || null
        if (r.layers && lim && c !== r.canvas) toast('The image was reduced in size, so its layers were merged into one. Change this under Settings, Large images.')
        if (r.layers && c === r.canvas) {
          const made = r.layers.map(pl => {
            const l = makeLayer(pl.folder ? 'group' : 'image', pl.name, d.w, d.h, !pl.folder)
            if (pl.canvas) ctx2d(l.canvas!).drawImage(pl.canvas, 0, 0)
            l.opacity = pl.opacity; l.visible = pl.visible; l.blend = pl.blend; l.collapsed = !pl.open; l.clip = pl.clip
            return l
          })
          r.layers.forEach((pl, i) => { if (pl.parent !== null) made[i].parent = made[pl.parent]?.id || null })
          d.layers = made
          normalizeTree(d)
          d.activeId = ([...d.layers].reverse().find(l => l.kind !== 'group') || d.layers[d.layers.length - 1]).id
        }
        d.modified = false
        this.setDoc(d)
      } else throw new Error('CocoaShot cannot open this file type')
      if (f.path && native) native.addRecent({ name: f.name, path: f.path, at: Date.now(), thumb: this.thumb() })
    } catch (e: any) {
      toast(e.message || 'Could not open the file', { err: true })
    } finally { this.idle() }
  }

  thumb() {
    if (!this.doc) return undefined
    const s = fitSize(this.doc.w, this.doc.h, 96)
    const c = canvas(s.w, s.h)
    ctx2d(c).drawImage(flatten(this.doc), 0, 0, s.w, s.h)
    return c.toDataURL('image/jpeg', 0.7)
  }

  async fromClipboard() {
    let data: ArrayBuffer | null = null
    if (native) data = await native.clipboardImage()
    else {
      try {
        for (const it of await navigator.clipboard.read()) {
          const t = it.types.find(t => t.startsWith('image/'))
          if (t) { data = await (await it.getType(t)).arrayBuffer(); break }
        }
      } catch {}
    }
    if (!data) { toast('There is no image on the clipboard'); return null }
    try { return (await decodeImage('clipboard.png', data)).canvas } catch { toast('The clipboard image could not be read', { err: true }); return null }
  }

  async newFromClipboard() {
    const c = await this.fromClipboard()
    if (!c) return
    const d = new Doc(c, 'Pasted image')
    d.modified = true
    this.setDoc(d)
  }

  async pasteLayer() {
    if (!this.doc || !this.hist) return this.newFromClipboard()
    const c = await this.fromClipboard()
    if (!c) return
    const doc = this.doc
    // Something copied in CocoaShot goes back where it came from; anything else is centred.
    // Only images larger than this one are scaled down to fit.
    const cp = this.copied
    const inPlace = cp && cp.w === c.width && cp.h === c.height && cp.x + cp.w <= doc.w && cp.y + cp.h <= doc.h
    await this.hist.op('Paste', () => {
      const l = makeLayer('paint', 'Pasted', doc.w, doc.h)
      const s = Math.min(1, doc.w / c.width, doc.h / c.height)
      const x = inPlace ? cp!.x : Math.round((doc.w - c.width * s) / 2), y = inPlace ? cp!.y : Math.round((doc.h - c.height * s) / 2)
      ctx2d(l.canvas!).drawImage(c, x, y, c.width * s, c.height * s)
      doc.add(l, doc.activeId)
    })
  }

  /** Copies the selected part of the active layer (masks applied), or the whole image without a selection. */
  async copy() {
    if (!this.doc) return
    const doc = this.doc
    const l = doc.active
    const layerImg = l && l.kind !== 'group' && l.kind !== 'adjust' ? layerFull(doc, l) : null
    const src = doc.selection ? layerImg || flatten(doc) : flatten(doc)
    let c = src
    let at = { x: 0, y: 0 }
    if (doc.selection) {
      const bb = bboxOfAlpha(alphaOf(doc.selection), doc.w, doc.h)
      if (!bb) { toast('The selection is empty'); return }
      c = canvas(bb.w, bb.h)
      const x = ctx2d(c)
      x.drawImage(src, -bb.x, -bb.y)
      x.globalCompositeOperation = 'destination-in'
      x.drawImage(doc.selection, -bb.x, -bb.y)
      at = { x: bb.x, y: bb.y }
    }
    try {
      const b: Blob = await new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Could not copy the image'))), 'image/png'))
      const u8 = new Uint8Array(await b.arrayBuffer())
      if (native) await native.copyImage(u8)
      else await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
      this.copied = { w: c.width, h: c.height, ...at }
      toast('Copied to the clipboard')
    } catch (e: any) { toast(e.message || 'Could not copy to the clipboard', { err: true }) }
  }

  async saveProject(as = false): Promise<boolean> {
    if (!this.doc) return false
    if (this.job) { this.waitToast(); return false }
    const doc = this.doc
    try {
      this.busy('Saving project')
      const data = await saveProject(doc)
      const name = doc.name + '.cocoashot'
      if (native) {
        let p = !as && doc.projectPath
        if (!p) p = await native.saveDialog(name, [{ name: 'CocoaShot project', extensions: ['cocoashot'] }])
        if (!p) return false
        await native.writePath(p, data)
        doc.projectPath = p
        doc.name = p.split(/[\\/]/).pop()!.replace(/\.cocoashot$/i, '')
        native.addRecent({ name: doc.name + '.cocoashot', path: p, at: Date.now(), thumb: this.thumb() })
        native.clearRecovery(doc.rid)
      } else downloadLocal(name, data)
      doc.modified = false
      this.hists.get(doc)?.markClean()
      this.saved.set(doc, Date.now())
      this.emit('doc')
      this.emit('tabs')
      this.title()
      toast('Project saved')
      return true
    } catch (e: any) {
      toast('Could not save: ' + e.message, { err: true })
      return false
    } finally { this.idle() }
  }

  /** Writes a recovery copy of every image with unsaved changes, each on its own schedule. */
  async autosave() {
    if (!native || this.job || this.stroke) return
    const m = this.settings.autosave
    if (!m) return
    for (const d of [...this.docs]) {
      if (!d.modified) continue
      if (!this.saved.has(d)) this.saved.set(d, Date.now())
      if (Date.now() - this.saved.get(d)! < m * 60000) continue
      this.saved.set(d, Date.now())
      try { await native.saveRecovery(await saveProject(d), d.rid) } catch {}
      if (this.job || this.stroke) return
    }
  }

  busy(label: string) { this.job = { label, progress: null, detail: '' }; this.emit('job') }
  idle() { this.job = null; this.emit('job') }

  async run<T>(label: string, fn: (progress: (p: number | null, detail?: string) => void) => Promise<T>, cancel?: () => void): Promise<T | null> {
    if (this.job) { toast('Please wait for the current task to finish'); return null }
    this.job = { label, progress: null, detail: '', lock: true, cancel: cancel || (() => { cancelJobs(); native?.aiCancel() }) }
    this.emit('job')
    try {
      return await fn((p, d) => { if (!this.job) return; this.job.progress = p; if (d !== undefined) this.job.detail = d; this.emit('job') })
    } catch (e: any) {
      if (e.message !== 'Cancelled') toast(e.message || 'Something went wrong', { err: true, ...(/AI engine|AI libraries/.test(e.message) && native ? { action: 'Open log folder', onAction: () => native!.dataFolder() } : {}) })
      return null
    } finally { this.job = null; this.emit('job') }
  }

  activeRaster(): Layer | null {
    const l = this.doc?.active
    if (!l) return null
    if (shownLocked(this.doc!, l)) { toast(`${l.name} is locked`); return null }
    if (l.kind === 'group') { toast('Select a layer inside the folder first'); return null }
    if (l.kind === 'text' || l.kind === 'shape' || l.kind === 'outline' || l.kind === 'adjust' || l.kind === 'background') {
      toast('Select an image or paint layer first')
      return null
    }
    return l
  }

  ensurePaintLayer(kind: 'paint' | 'highlight' = 'paint', name = 'Paint'): Layer | null {
    const doc = this.doc
    if (!doc) return null
    const a = doc.active
    if (a && !a.locked && a.canvas && (kind === 'highlight' ? a.kind === 'highlight' : a.kind === 'paint' || a.kind === 'image')) return a
    const before = snapshot(doc)
    const l = makeLayer(kind, name, doc.w, doc.h)
    doc.add(l, doc.activeId)
    this.hist!.structural('New ' + name.toLowerCase() + ' layer', before)
    doc.structure()
    return l
  }

  newPaintLayer(): Layer {
    const doc = this.doc!
    const before = snapshot(doc)
    const l = makeLayer('paint', 'Paint', doc.w, doc.h)
    doc.add(l, doc.activeId)
    this.hist!.structural('New paint layer', before)
    doc.structure()
    return l
  }

  sampleColor(x: number, y: number, merged = true): string | null {
    const doc = this.doc
    if (!doc) return null
    const src = merged ? doc.comp : doc.active?.canvas || doc.comp
    const ix = Math.floor(x), iy = Math.floor(y)
    if (ix < 0 || iy < 0 || ix >= doc.w || iy >= doc.h) return null
    const d = getData(src, { x: ix, y: iy, w: 1, h: 1 }).data
    return '#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join('')
  }

  touchAll() { if (this.doc) for (const l of this.doc.layers) touch(l) }
}
