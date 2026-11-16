import { Doc, Layer, makeLayer, normalizeTree, shownLocked, snapshot } from './core/doc'
import { History } from './core/history'
import { flatten, touch } from './core/compose'
import { decodeImage, loadProject, saveProject, IMAGE_EXT, type ExportFormat } from './core/io'
import { canvas, ctx2d, Emitter, fitSize, getData } from './core/util'
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
}

const DEFAULTS: Settings = {
  theme: 'dark', exportFormat: 'png', exportQuality: 92, openLimit: 0, bgModel: 'isnet', gpu: true, autosave: 3,
  shortcuts: {}, exportFolder: '', leftW: 220, rightW: 288, leftOpen: true, rightOpen: true, checkUpdates: true, uiStyle: 'classic', toolCols: 1, stabilizer: 0
}

export interface Job { label: string; progress: number | null; detail: string; cancel?: () => void }

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
  private lastSave = Date.now()

  constructor() {
    super()
    let s: Partial<Settings> = {}
    try { s = JSON.parse(localStorage.getItem('cocoashot.settings') || '{}') } catch {}
    this.settings = { ...DEFAULTS, ...s, shortcuts: { ...(s.shortcuts || {}) } }
    try { const c = JSON.parse(localStorage.getItem('cocoashot.fgbg') || 'null'); if (c) { this.fg = c[0]; this.bgc = c[1] } } catch {}
    this.applyTheme()
    setInterval(() => this.autosave(), 30000)
  }

  get tool() { return this.tools.get(this.toolId) }

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
    if (this.doc === d) this.tool?.deactivate?.()
    this.docs.splice(i, 1)
    this.hists.delete(d)
    this.views.delete(d)
    if (this.doc === d) { this.doc = null; this.activate(this.docs[Math.min(i, this.docs.length - 1)] || null) }
    else this.emit('tabs')
  }

  async closeDoc(d = this.doc) {
    if (!d) return false
    if (d.modified) {
      this.activate(d)
      if (!(await this.confirmDiscard())) return false
    }
    this.dropDoc(d)
    if (!this.docs.length) native?.clearRecovery()
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
        if (r.layers && !lim) {
          const made = r.layers.map(pl => {
            const l = makeLayer(pl.folder ? 'group' : 'image', pl.name, d.w, d.h, !pl.folder)
            if (pl.canvas) ctx2d(l.canvas!).drawImage(pl.canvas, 0, 0)
            l.opacity = pl.opacity; l.visible = pl.visible; l.blend = pl.blend; l.collapsed = !pl.open; l.clip = pl.clip
            return l
          })
          r.layers.forEach((pl, i) => { if (pl.parent !== null) made[i].parent = made[pl.parent]?.id || null })
          d.layers = made
          normalizeTree(d)
          d.activeId = [...d.layers].reverse().find(l => l.kind !== 'group')!.id
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
    const r = await decodeImage('clipboard.png', data)
    return r.canvas
  }

  async newFromClipboard() {
    const c = await this.fromClipboard()
    if (!c) return
    const d = new Doc(c, 'Pasted image')
    this.setDoc(d)
    d.modified = true
  }

  async pasteLayer() {
    if (!this.doc || !this.hist) return this.newFromClipboard()
    const c = await this.fromClipboard()
    if (!c) return
    const doc = this.doc
    await this.hist.op('Paste', () => {
      const l = makeLayer('paint', 'Pasted', doc.w, doc.h)
      const s = Math.min(1, doc.w / c.width, doc.h / c.height)
      ctx2d(l.canvas!).drawImage(c, (doc.w - c.width * s) / 2, (doc.h - c.height * s) / 2, c.width * s, c.height * s)
      doc.add(l, doc.activeId)
    })
  }

  async copy() {
    if (!this.doc) return
    const doc = this.doc
    const src = doc.selection ? (() => { const l = doc.active; return l?.canvas || flatten(doc) })() : flatten(doc)
    let c = src
    if (doc.selection) {
      c = canvas(doc.w, doc.h)
      const x = ctx2d(c)
      x.drawImage(src, 0, 0)
      x.globalCompositeOperation = 'destination-in'
      x.drawImage(doc.selection, 0, 0)
    }
    const b: Blob = await new Promise(r => c.toBlob(b => r(b!), 'image/png'))
    const u8 = new Uint8Array(await b.arrayBuffer())
    if (native) await native.copyImage(u8)
    else await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
    toast('Copied to the clipboard')
  }

  async saveProject(as = false): Promise<boolean> {
    if (!this.doc) return false
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
        native.clearRecovery()
      } else downloadLocal(name, data)
      doc.modified = false
      this.lastSave = Date.now()
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

  async autosave() {
    if (!native || !this.doc || !this.doc.modified || this.job || this.stroke) return
    const m = this.settings.autosave
    if (!m || Date.now() - this.lastSave < m * 60000) return
    this.lastSave = Date.now()
    try { await native.saveRecovery(await saveProject(this.doc)) } catch {}
  }

  busy(label: string) { this.job = { label, progress: null, detail: '' }; this.emit('job') }
  idle() { this.job = null; this.emit('job') }

  async run<T>(label: string, fn: (progress: (p: number | null, detail?: string) => void) => Promise<T>, cancel?: () => void): Promise<T | null> {
    if (this.job) { toast('Please wait for the current task to finish'); return null }
    this.job = { label, progress: null, detail: '', cancel: cancel || (() => { cancelJobs(); native?.aiCancel() }) }
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
