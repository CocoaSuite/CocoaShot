import type { App } from '../app'
import type { Tool } from './types'
import { Adjust, Doc, freshAdjust, Layer, LV0, LV_CH, LvChannel, makeLayer, snapshot } from '../core/doc'
import { compose } from '../core/compose'
import { touch } from '../core/compose'
import { ALPHA0, AlphaOpts, autoRange, editAlpha, histogramStats, histograms, levelsLUT } from '../core/px'
import { alphaOf, canvas, clamp, ctx2d, getData, putData } from '../core/util'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider, toggle } from '../ui/controls'
import { tr } from '../i18n'

export function adjLayer(app: App, create: boolean): Layer | null {
  const doc = app.doc!
  if (doc.active?.kind === 'adjust') return doc.active
  const top = [...doc.layers].reverse().find(l => l.kind === 'adjust')
  if (top || !create) return top || null
  const l = makeLayer('adjust', tr('Adjustments'), doc.w, doc.h, false)
  l.adjust = freshAdjust()
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
    id: 'adjust', label: tr('Adjustments'), icon: 'adjust',
    panel() {
      const doc = app.doc!
      const ex = adjLayer(app, false)
      const a: Adjust = ex?.adjust || freshAdjust()
      const sliders: HTMLElement[] = []
      const ensure = () => {
        if (!snap) snap = snapshot(doc)
        const l = adjLayer(app, true)!
        if (l.adjust !== a) l.adjust = a
        return l
      }
      const changed = () => { ensure(); doc.changed() }
      const end = () => { if (snap) { app.hist!.structural(tr('Adjust'), snap); snap = null; app.emit('layers') } }
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
        sec(tr('Auto'), btn(tr('Reset all'), () => {
          snap = snapshot(doc)
          Object.assign(a, freshAdjust())
          changed(); end(); app.emit('panel')
        })),
        h('div', { class: 'g2' },
          h('button', { onclick: () => auto('enhance') }, icon('sparkle'), tr('Enhance')),
          btn(tr('White balance'), () => auto('wb')), btn(tr('Contrast'), () => auto('contrast')), btn(tr('Colour'), () => auto('color'))),
        sec(tr('Light')),
        S(tr('Exposure'), 'exposure'), S(tr('Brightness'), 'brightness'), S(tr('Contrast'), 'contrast'), S(tr('Highlights'), 'highlights'),
        S(tr('Shadows'), 'shadows'), S(tr('Whites'), 'whites'), S(tr('Blacks'), 'blacks'), S(tr('Gamma'), 'gamma'),
        sec(tr('Colour')),
        S(tr('Temperature'), 'temperature'), S(tr('Tint'), 'tint'), S(tr('Saturation'), 'saturation'), S(tr('Vibrance'), 'vibrance'), S(tr('Hue'), 'hue', -180, 180),
        sec(tr('Detail')),
        S(tr('Sharpness'), 'sharpness', 0, 100), S(tr('Clarity'), 'clarity', -100, 100),
        sec(tr('Effects')),
        h('div', { class: 'seg' }, flag(tr('Grayscale'), 'grayscale'), flag(tr('Sepia'), 'sepia'), flag(tr('Invert'), 'invert')),
        h('button', { class: 'wide' + (app.view.compare === 'split' ? ' on' : ''), onclick: (e: Event) => { app.view.compare = app.view.compare === 'split' ? 'off' : 'split'; (e.currentTarget as HTMLElement).classList.toggle('on'); app.emit('compare'); app.view.draw() } }, icon('compare'), tr('Before and after')))
    }
  }
}

const LV_LABEL: [LvChannel, string][] = [['rgb', 'RGB'], ['r', tr('Red')], ['g', tr('Green')], ['b', tr('Blue')], ['a', tr('Alpha')]]
const LV_TINT: Record<LvChannel, string> = { rgb: 'var(--fg)', r: '#e5484d', g: '#30a46c', b: '#3e63dd', a: 'var(--mute)' }

function levelsGraph(hist: Uint32Array | null, p: number[], o: number, tint: string) {
  const c = h('canvas', { class: 'lvg', width: 512, height: 150 }) as HTMLCanvasElement
  const draw = () => {
    const x = ctx2d(c), W = c.width, H = c.height
    x.clearRect(0, 0, W, H)
    const cs = getComputedStyle(c)
    const col = (v: string) => (v.startsWith('var(') ? cs.getPropertyValue(v.slice(4, -1)).trim() || '#999' : v)
    if (hist) {
      let mx = 1
      for (let i = 1; i < 255; i++) mx = Math.max(mx, hist[i])
      x.fillStyle = col(tint); x.globalAlpha = 0.45
      for (let i = 0; i < 256; i++) { const v = Math.min(1, hist[i] / mx); x.fillRect(i * 2, H - v * (H - 6), 2, v * (H - 6)) }
      x.globalAlpha = 1
    }
    const lut = levelsLUT(p, o)
    x.strokeStyle = col('var(--fg)'); x.lineWidth = 2; x.globalAlpha = 0.8
    x.beginPath()
    for (let i = 0; i < 256; i++) { const y = H - 2 - lut[i] * (H - 4); if (i) x.lineTo(i * 2 + 1, y); else x.moveTo(1, y) }
    x.stroke(); x.globalAlpha = 1
    const mark = (v: number, fill: string) => { const px = v * 2; x.fillStyle = fill; x.strokeStyle = '#000'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, H - 12); x.lineTo(px - 7, H); x.lineTo(px + 7, H); x.closePath(); x.fill(); x.stroke() }
    mark(p[o], '#111'); mark(p[o] + (p[o + 1] - p[o]) * Math.pow(0.5, p[o + 2]), '#888'); mark(p[o + 1], '#fff')
  }
  ;(c as any).draw = draw
  requestAnimationFrame(draw)
  return c
}

function lvSliders(p: number[], o: number, set: () => void, end: () => void, redraw: () => void) {
  const els: HTMLElement[] = []
  const S = (label: string, k: number, min: number, max: number, def: number, step = 1) => {
    const el = slider(label, () => p[o + k], v => {
      p[o + k] = v
      if (k === 0 && p[o] >= p[o + 1]) p[o] = p[o + 1] - 1
      if (k === 1 && p[o + 1] <= p[o]) p[o + 1] = p[o] + 1
      set(); redraw()
    }, { min, max, step, def, onEnd: () => { els.forEach(e => (e as any).sync()); end() } })
    els.push(el)
    return el
  }
  return [S(tr('Input black'), 0, 0, 254, 0), S(tr('Midtones'), 2, 0.1, 9.99, 1, 0.01), S(tr('Input white'), 1, 1, 255, 255), S(tr('Output black'), 3, 0, 255, 0), S(tr('Output white'), 4, 0, 255, 255)]
}

export function levelsTool(app: App): Tool {
  let snap: any = null
  let histKey = '', histCache: ReturnType<typeof histograms> | null = null
  let ch: LvChannel = 'rgb'
  return {
    id: 'levels', label: tr('Levels'), icon: 'levels',
    panel() {
      const doc = app.doc!
      const ex = adjLayer(app, false)
      const a: Adjust = ex?.adjust || freshAdjust()
      const ensure = () => {
        if (!snap) snap = snapshot(doc)
        const l = adjLayer(app, true)!
        if (l.adjust !== a) l.adjust = a
        return l
      }
      const changed = () => { ensure(); doc.changed() }
      const end = () => { if (snap) { app.hist!.structural(tr('Levels'), snap); snap = null; app.emit('layers') } }
      const ci = LV_CH.indexOf(ch), o = ci * 5
      // The histogram of everything below is reused until the image changes.
      const key = doc.rid + ':' + doc.rev + ':' + (ex?.id || '')
      if (histKey !== key) {
        const below = canvas(doc.w, doc.h)
        compose(doc, below, null, { upTo: ex?.id })
        histCache = histograms(getData(below).data, Math.max(1, Math.round(doc.w * doc.h / 400000)))
        histKey = key
      }
      const H = histCache!
      const graph = levelsGraph(H[ci], a.lv, o, LV_TINT[ch])
      const redraw = () => (graph as any).draw()
      const reset = (all: boolean) => { snap = snapshot(doc); ensure(); a.lv.splice(all ? 0 : o, all ? LV0.length : 5, ...LV0.slice(all ? 0 : o, all ? LV0.length : o + 5)); changed(); end(); app.emit('panel') }
      const auto = () => {
        snap = snapshot(doc); ensure()
        const [lo, hi] = autoRange(H[ci])
        a.lv[o] = lo; a.lv[o + 1] = hi
        changed(); end(); app.emit('panel')
      }
      return h('div', { class: 'ib' },
        sec(tr('Levels'), btn(tr('Auto'), auto)),
        seg(LV_LABEL, () => ch, v => { ch = v; app.emit('panel') }),
        graph,
        ch === 'a' ? hint(tr('Changes the transparency of everything below this adjustment layer.')) : null,
        ...lvSliders(a.lv, o, changed, end, redraw),
        h('div', { class: 'g2' }, btn(tr('Reset {0}', LV_LABEL[ci][1]), () => reset(false)), btn(tr('Reset all levels'), () => reset(true))))
    }
  }
}

export function alphaTool(app: App): Tool {
  const o: AlphaOpts = { ...ALPHA0, lv: [...ALPHA0.lv] }
  let target: Layer | null = null
  let base: ImageData | null = null
  let raf = 0
  const clear = () => { target = null; base = null; Object.assign(o, { ...ALPHA0, lv: [...ALPHA0.lv] }); if (app.hist?.pending === commit) app.hist.pending = null }
  const render = () => {
    raf = 0
    const doc = app.doc
    if (!doc || !target || !base) return
    const { width: w, height: hh } = base
    const n = w * hh, src = base.data
    const a = new Uint8Array(n)
    for (let i = 0; i < n; i++) a[i] = src[i * 4 + 3]
    const sel = doc.selection && doc.selection.width === w && doc.selection.height === hh ? alphaOf(doc.selection) : null
    const na = editAlpha(a, w, hh, o, sel)
    const out = new ImageData(new Uint8ClampedArray(src), w, hh)
    for (let i = 0; i < n; i++) out.data[i * 4 + 3] = na[i]
    putData(target.canvas!, out, 0, 0)
    touch(target)
    doc.changed()
  }
  function commit() {
    if (!target || !base || !app.hist) return clear()
    if (raf) { cancelAnimationFrame(raf); render() }
    const l = target, b = base
    clear()
    app.hist.raster(tr('Layer alpha'), l, 'canvas', { x: 0, y: 0, w: b.width, h: b.height }, b)
    app.doc?.changed()
  }
  const cancel = () => {
    if (raf) { cancelAnimationFrame(raf); raf = 0 }
    if (target && base) { putData(target.canvas!, base, 0, 0); touch(target); app.doc?.changed() }
    clear()
  }
  const changed = () => {
    const l = app.activeRaster()
    if (!l || !l.canvas) return
    if (target && target !== l) commit()
    if (!target) { target = l; base = getData(l.canvas); app.hist!.pending = commit }
    if (!raf) raf = requestAnimationFrame(render)
  }
  const setView = (v: boolean) => { app.view.alphaView = v; app.view.draw() }
  return {
    id: 'alpha', label: tr('Layer alpha'), icon: 'alpha',
    deactivate() { commit(); setView(false) },
    panel() {
      const l = app.doc?.active
      if (target && l !== target) commit()
      const ok = !!l && !!l.canvas && !['text', 'shape', 'outline', 'adjust', 'background'].includes(l.kind)
      if (!ok) return h('div', { class: 'ib' }, sec(tr('Layer alpha')), hint(tr('Select an image or paint layer to edit its transparency.')))
      const src = base || getData(l!.canvas!)
      const graph = levelsGraph(histograms(src.data, Math.max(1, Math.round(src.width * src.height / 400000)))[4], o.lv, 0, 'var(--mute)')
      const redraw = () => (graph as any).draw()
      const pending = !!target
      return h('div', { class: 'ib' },
        sec(tr('Layer alpha: {0}', l!.name)),
        hint(app.doc!.selection ? tr('Only the selected area changes.') : tr('Edits the transparency of the selected layer. Black is fully transparent, white is fully opaque.')),
        toggle(tr('Show alpha as black and white'), () => app.view.alphaView, setView),
        sec(tr('Alpha levels')),
        graph,
        ...lvSliders(o.lv, 0, changed, () => {}, redraw),
        sec(tr('Edges')),
        slider(tr('Grow or shrink'), () => o.grow, v => { o.grow = v; changed() }, { min: -50, max: 50, def: 0, unit: 'px' }),
        slider(tr('Feather'), () => o.feather, v => { o.feather = v; changed() }, { min: 0, max: 50, step: 0.5, def: 0, unit: 'px' }),
        toggle(tr('Hard edges'), () => o.hard, v => { o.hard = v; changed() }),
        toggle(tr('Invert alpha'), () => o.invert, v => { o.invert = v; changed() }),
        h('div', { class: 'g2' },
          btn(tr('Make opaque'), () => { o.lv[3] = 255; o.lv[4] = 255; changed(); app.emit('panel') }),
          btn(tr('Reset'), () => { if (target) { Object.assign(o, { ...ALPHA0, lv: [...ALPHA0.lv] }); changed() } app.emit('panel') })),
        h('div', { class: 'g2' },
          h('button', { disabled: !pending, onclick: () => { cancel(); app.emit('panel') } }, tr('Cancel')),
          h('button', { class: 'pri', disabled: !pending, onclick: () => { commit(); app.emit('panel'); toast(tr('Layer alpha applied')) } }, tr('Apply'))))
    }
  }
}
