import type { App } from '../app'
import type { Tool } from './types'
import { Adjust, cloneAdjust, CURVE0, CURVE_CH, CurveChannel, Doc, freshAdjust, GradStop, Layer, LV0, LV_CH, LvChannel, makeLayer, snapshot } from '../core/doc'
import { compose } from '../core/compose'
import { touch } from '../core/compose'
import { ALPHA0, AlphaOpts, autoRange, curveLUT, editAlpha, gradientTable, histogramStats, histograms, levelsLUT } from '../core/px'
import { alphaOf, canvas, clamp, ctx2d, getData, putData, rgb2hex } from '../core/util'
import { h, icon, tip, toast } from '../ui/dom'
import { btn, hint, sec, seg, select, slider, toggle } from '../ui/controls'
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
      const end = () => { if (snap) { app.hist!.structural(tr('Adjust'), snap); snap = null; app.emit('layers'); app.record({ kind: 'adjust', a: cloneAdjust(a) }) } }
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
      const end = () => { if (snap) { app.hist!.structural(tr('Levels'), snap); snap = null; app.emit('layers'); app.record({ kind: 'adjust', a: cloneAdjust(a) }) } }
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

const CV_LABEL: [CurveChannel, string][] = [['rgb', 'RGB'], ['r', tr('Red')], ['g', tr('Green')], ['b', tr('Blue')]]
const CV_TINT: Record<CurveChannel, string> = { rgb: 'var(--fg)', r: '#e5484d', g: '#30a46c', b: '#3e63dd' }
const CV_PRESETS: [string, string, number[]][] = [
  ['linear', tr('Linear'), [0, 0, 255, 255]],
  ['contrast', tr('Medium contrast'), [0, 0, 64, 52, 192, 204, 255, 255]],
  ['strong', tr('Strong contrast'), [0, 0, 64, 40, 192, 216, 255, 255]],
  ['lighter', tr('Lighter'), [0, 0, 120, 150, 255, 255]],
  ['darker', tr('Darker'), [0, 0, 135, 105, 255, 255]],
  ['fade', tr('Faded film'), [0, 36, 64, 72, 192, 196, 255, 236]],
  ['negative', tr('Negative'), [0, 255, 255, 0]]
]

/** The histogram of everything below an adjustment layer, cached until the image changes. */
function belowHistograms(doc: Doc, ex: Layer | null, cache: { key: string; h: ReturnType<typeof histograms> | null }) {
  const key = doc.rid + ':' + doc.rev + ':' + (ex?.id || '')
  if (cache.key !== key || !cache.h) {
    const below = canvas(doc.w, doc.h)
    compose(doc, below, null, { upTo: ex?.id })
    cache.h = histograms(getData(below).data, Math.max(1, Math.round(doc.w * doc.h / 400000)))
    cache.key = key
  }
  return cache.h
}

/** The curve editor: drag points, click to add one, drag a point out of the box (or double-click it) to remove it. */
function curveGraph(hist: Uint32Array | null, pts: () => number[], tint: string, onChange: () => void, onEnd: () => void) {
  const c = h('canvas', { class: 'lvg cvg', width: 512, height: 512 }) as HTMLCanvasElement
  const info = h('span', { class: 'hint' }, '')
  let sel = -1, drag = -1, out = false
  // A margin inside the canvas so points at 0 and 255 are drawn whole.
  const M = 14, S = 512 - M * 2
  const X = (v: number) => M + (v / 255) * S, Y = (v: number) => M + (1 - v / 255) * S
  const toV = (e: PointerEvent) => {
    const r = c.getBoundingClientRect(), k = 512 / r.width
    return { x: (((e.clientX - r.left) * k - M) / S) * 255, y: (1 - ((e.clientY - r.top) * k - M) / S) * 255, ox: e.clientX < r.left - 24 || e.clientX > r.right + 24 || e.clientY < r.top - 24 || e.clientY > r.bottom + 24 }
  }
  const near = (v: { x: number; y: number }) => { const p = pts(); let best = -1, bd = 12; for (let i = 0; i < p.length; i += 2) { const d = Math.hypot(p[i] - v.x, p[i + 1] - v.y); if (d < bd) { bd = d; best = i } } return best }
  const label = () => { const p = pts(); info.textContent = sel >= 0 && sel < p.length ? tr('Input {0}, output {1}', Math.round(p[sel]), Math.round(p[sel + 1])) : tr('Click the curve to add a point. Drag a point off the graph to remove it.') }
  const draw = () => {
    const x = ctx2d(c)
    x.clearRect(0, 0, c.width, c.height)
    const cs = getComputedStyle(c)
    const col = (v: string) => (v.startsWith('var(') ? cs.getPropertyValue(v.slice(4, -1)).trim() || '#999' : v)
    x.strokeStyle = col('var(--line)') || 'rgba(128,128,128,.3)'; x.lineWidth = 1
    x.beginPath(); for (const f of [0, 0.25, 0.5, 0.75, 1]) { x.moveTo(X(f * 255), Y(0)); x.lineTo(X(f * 255), Y(255)); x.moveTo(X(0), Y(f * 255)); x.lineTo(X(255), Y(f * 255)) } x.stroke()
    x.beginPath(); x.moveTo(X(0), Y(0)); x.lineTo(X(255), Y(255)); x.globalAlpha = 0.35; x.stroke(); x.globalAlpha = 1
    if (hist) {
      let mx = 1
      for (let i = 1; i < 255; i++) mx = Math.max(mx, hist[i])
      x.fillStyle = col(tint); x.globalAlpha = 0.25
      for (let i = 0; i < 256; i++) { const v = Math.min(1, hist[i] / mx); x.fillRect(X(i), Y(0) - v * S, S / 256 + 0.5, v * S) }
      x.globalAlpha = 1
    }
    const p = pts(), lut = curveLUT(p)
    x.strokeStyle = col(tint); x.lineWidth = 3
    x.beginPath()
    for (let i = 0; i < 256; i++) { const y = Y(lut[i] * 255); if (i) x.lineTo(X(i), y); else x.moveTo(X(0), y) }
    x.stroke()
    for (let i = 0; i < p.length; i += 2) {
      x.fillStyle = i === sel ? col(tint) : col('var(--panel)') || '#222'; x.strokeStyle = col(tint); x.lineWidth = 2.5
      x.beginPath(); x.arc(X(p[i]), Y(p[i + 1]), 9, 0, Math.PI * 2); x.fill(); x.stroke()
    }
    label()
  }
  const sortKeep = (p: number[], idx: number) => {
    const pairs: [number, number][] = []
    for (let i = 0; i < p.length; i += 2) pairs.push([p[i], p[i + 1]])
    const moving = pairs[idx / 2]
    pairs.sort((a, b) => a[0] - b[0])
    p.splice(0, p.length, ...pairs.flat())
    return pairs.indexOf(moving) * 2
  }
  c.addEventListener('pointerdown', e => {
    c.setPointerCapture(e.pointerId)
    const v = toV(e), p = pts()
    let i = near(v)
    if (i < 0) {
      // A new point on the curve where it was clicked.
      p.push(Math.min(255, Math.max(0, v.x)), Math.min(255, Math.max(0, v.y)))
      i = sortKeep(p, p.length - 2)
      onChange()
    }
    sel = drag = i; out = false
    draw()
  })
  c.addEventListener('pointermove', e => {
    if (drag < 0) return
    const v = toV(e), p = pts()
    const n = p.length / 2, k = drag / 2
    out = v.ox && n > 2
    const lo = k > 0 ? p[drag - 2] + 1 : 0, hi = k < n - 1 ? p[drag + 2] - 1 : 255
    p[drag] = Math.round(Math.min(hi, Math.max(lo, v.x)))
    p[drag + 1] = Math.round(Math.min(255, Math.max(0, v.y)))
    onChange(); draw()
  })
  const up = () => {
    if (drag < 0) return
    const p = pts()
    if (out && p.length > 4) { p.splice(drag, 2); sel = -1; onChange() }
    drag = -1; out = false
    draw(); onEnd()
  }
  c.addEventListener('pointerup', up)
  c.addEventListener('pointercancel', up)
  c.addEventListener('dblclick', e => {
    const p = pts(), i = near(toV(e as PointerEvent))
    if (i >= 0 && p.length > 4) { p.splice(i, 2); sel = -1; onChange(); draw(); onEnd() }
  })
  ;(c as any).draw = draw
  requestAnimationFrame(draw)
  return { el: h('div', { class: 'cvbox' }, c, info), draw }
}

export function curvesTool(app: App): Tool {
  let snap: any = null
  const cache = { key: '', h: null as ReturnType<typeof histograms> | null }
  let ch: CurveChannel = 'rgb'
  return {
    id: 'curves', label: tr('Curves'), icon: 'curves',
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
      const end = () => { if (snap) { app.hist!.structural(tr('Curves'), snap); snap = null; app.emit('layers'); app.record({ kind: 'adjust', a: cloneAdjust(a) }) } }
      const ci = CURVE_CH.indexOf(ch)
      const H = belowHistograms(doc, ex, cache)
      const hist = H[[0, 1, 2, 3][ci]]
      const g = curveGraph(hist, () => a.curves[ci], CV_TINT[ch], changed, end)
      const setPts = (p: number[], all = false) => {
        snap = snapshot(doc); ensure()
        if (all) a.curves = CURVE_CH.map((_, i) => (i === ci ? [...p] : [...CURVE0]))
        else a.curves[ci] = [...p]
        changed(); end(); g.draw()
      }
      return h('div', { class: 'ib' },
        sec(tr('Curves')),
        seg(CV_LABEL, () => ch, v => { ch = v; app.emit('panel') }),
        g.el,
        select(tr('Preset'), [['', tr('Choose a preset')], ...CV_PRESETS.map(p => [p[0], p[1]] as [string, string])], () => '', v => { const p = CV_PRESETS.find(x => x[0] === v); if (p) setPts(p[2]) }),
        h('div', { class: 'g2' },
          btn(tr('Reset {0}', CV_LABEL[ci][1]), () => setPts(CURVE0)),
          btn(tr('Reset all curves'), () => { snap = snapshot(doc); ensure(); a.curves = CURVE_CH.map(() => [...CURVE0]); changed(); end(); app.emit('panel') })),
        h('button', { class: 'wide' + (app.view.compare === 'split' ? ' on' : ''), onclick: (e: Event) => { app.view.compare = app.view.compare === 'split' ? 'off' : 'split'; (e.currentTarget as HTMLElement).classList.toggle('on'); app.emit('compare'); app.view.draw() } }, icon('compare'), tr('Before and after')))
    }
  }
}

export const GMAP_PRESETS: [string, string, GradStop[]][] = [
  ['bw', tr('Black and white'), [{ p: 0, c: '#000000' }, { p: 1, c: '#ffffff' }]],
  ['duo', tr('Teal and orange'), [{ p: 0, c: '#0b2e3a' }, { p: 0.5, c: '#5f8f8c' }, { p: 1, c: '#ffd29a' }]],
  ['sepia', tr('Warm sepia'), [{ p: 0, c: '#1e120a' }, { p: 0.55, c: '#8c6239' }, { p: 1, c: '#fbeed7' }]],
  ['night', tr('Midnight blue'), [{ p: 0, c: '#05061a' }, { p: 0.5, c: '#2a3d8f' }, { p: 1, c: '#d9e4ff' }]],
  ['sunset', tr('Sunset'), [{ p: 0, c: '#1b0b33' }, { p: 0.35, c: '#a1225b' }, { p: 0.7, c: '#f2763b' }, { p: 1, c: '#ffe7a3' }]],
  ['ir', tr('Infrared'), [{ p: 0, c: '#000000' }, { p: 0.3, c: '#5a0e7a' }, { p: 0.6, c: '#ff3d6e' }, { p: 0.85, c: '#ffd166' }, { p: 1, c: '#ffffff' }]],
  ['mint', tr('Mint duotone'), [{ p: 0, c: '#12332a' }, { p: 1, c: '#c8f7e1' }]],
  ['pop', tr('Pop art'), [{ p: 0, c: '#1d1d8f' }, { p: 0.33, c: '#e5245e' }, { p: 0.66, c: '#ffd400' }, { p: 1, c: '#fff8e1' }]]
]

const gradCss = (stops: GradStop[], reverse: boolean) => 'linear-gradient(90deg,' + [...stops].map(s => ({ p: reverse ? 1 - s.p : s.p, c: s.c })).sort((x, y) => x.p - y.p).map(s => `${s.c} ${Math.round(s.p * 100)}%`).join(',') + ')'

export function gradientMapTool(app: App): Tool {
  let snap: any = null
  return {
    id: 'gmap', label: tr('Gradient map'), icon: 'gmap',
    panel() {
      const doc = app.doc!
      const ex = adjLayer(app, false)
      const a: Adjust = ex?.adjust || freshAdjust()
      const gm = a.gmap
      const ensure = () => {
        if (!snap) snap = snapshot(doc)
        const l = adjLayer(app, true)!
        if (l.adjust !== a) l.adjust = a
        return l
      }
      const changed = () => { ensure(); doc.changed(); bar.style.background = gradCss(gm.stops, gm.reverse) }
      const end = () => { if (snap) { app.hist!.structural(tr('Gradient map'), snap); snap = null; app.emit('layers'); app.record({ kind: 'adjust', a: cloneAdjust(a) }) } }
      const bar = h('div', { class: 'gbar', style: { background: gradCss(gm.stops, gm.reverse) } })
      const once = (fn: () => void) => { snap = snapshot(doc); ensure(); fn(); changed(); end(); app.emit('panel') }
      const rows = gm.stops.map((s, i) => {
        const col = h('input', { type: 'color', value: s.c }) as HTMLInputElement
        col.addEventListener('input', () => { s.c = col.value; changed() })
        col.addEventListener('change', end)
        col.title = tr('Colour of stop {0}', i + 1)
        return h('div', { class: 'gstop' }, col,
          slider(tr('Position of stop {0}', i + 1), () => Math.round(s.p * 100), v => { s.p = v / 100; changed() }, { min: 0, max: 100, unit: '%', onEnd: end }),
          gm.stops.length > 2 ? tip(h('button', { class: 'ic', onclick: () => once(() => gm.stops.splice(i, 1)) }, icon('x')), tr('Remove stop')) : null)
      })
      return h('div', { class: 'ib' },
        sec(tr('Gradient map')),
        hint(tr('Recolours the image by brightness: dark areas take the colours on the left of the gradient, light areas those on the right.')),
        toggle(tr('Gradient map on'), () => gm.on, v => once(() => { gm.on = v })),
        bar,
        select(tr('Preset'), [['', tr('Choose a preset')], ...GMAP_PRESETS.map(p => [p[0], p[1]] as [string, string])], () => '', v => { const p = GMAP_PRESETS.find(x => x[0] === v); if (p) once(() => { gm.stops = p[2].map(s => ({ ...s })); gm.on = true }) }),
        slider(tr('Amount'), () => gm.amount, v => { gm.amount = v; changed() }, { min: 0, max: 100, def: 100, unit: '%', onEnd: end }),
        toggle(tr('Reverse'), () => gm.reverse, v => once(() => { gm.reverse = v })),
        sec(tr('Colour stops'), btn(tr('Add stop'), () => once(() => {
          // A new stop in the widest gap, coloured as the gradient already is there.
          const st = [...gm.stops].sort((x, y) => x.p - y.p)
          let at = 0.5, gap = -1
          for (let i = 0; i < st.length - 1; i++) if (st[i + 1].p - st[i].p > gap) { gap = st[i + 1].p - st[i].p; at = (st[i].p + st[i + 1].p) / 2 }
          const t = gradientTable(gm.stops, false), k = Math.round(at * 255) * 4
          gm.stops.push({ p: at, c: rgb2hex(t[k], t[k + 1], t[k + 2]) })
        }))),
        ...rows,
        h('button', { class: 'wide' + (app.view.compare === 'split' ? ' on' : ''), onclick: (e: Event) => { app.view.compare = app.view.compare === 'split' ? 'off' : 'split'; (e.currentTarget as HTMLElement).classList.toggle('on'); app.emit('compare'); app.view.draw() } }, icon('compare'), tr('Before and after')))
    }
  }
}
