import type { App } from '../app'
import { native } from '../native'
import { confirmBox, h, icon, tip } from '../ui/dom'
import { colorWheel } from '../ui/color'
import { slider, toggle } from '../ui/controls'
import { canvas, ctx2d, fitSize, getData } from '../core/util'
import type { BrushOpts } from '../core/brush'
import type { Viewport } from '../view/viewport'

export const mb = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(n / 1e6)) + ' MB')

export async function ai(app: App, op: string, args: any, progress: (p: number | null, d?: string) => void): Promise<any> {
  if (!native) throw new Error('AI tools run in the CocoaShot desktop app')
  const prog = (p: any) => { if (p.total) progress(p.loaded / p.total, p.file ? 'Downloading ' + mb(p.total) : '') }
  try {
    return await native.ai(op, args, prog)
  } catch (e: any) {
    const m = /MODEL_MISSING:(\w+)/.exec(e.message)
    if (!m) throw e
    const st = await native.ai('status')
    const info = st[m[1]]
    const ok = await confirmBox(`Download ${info.name}?`,
      `${info.use}. This is a one-time ${mb(info.size)} download (${info.license} licence). After that it runs entirely on this computer and your images are never uploaded.`, 'Download')
    if (ok !== 'yes') throw new Error('Cancelled')
    progress(0, 'Downloading ' + info.name)
    await native.ai('download', { key: m[1] }, p => p.total && progress(p.loaded / p.total, 'Downloading ' + info.name))
    progress(null, '')
    return await native.ai(op, args, prog)
  }
}

export function rgbaOf(src: HTMLCanvasElement, max = 0, region?: { x: number; y: number; w: number; h: number }) {
  const r = region || { x: 0, y: 0, w: src.width, h: src.height }
  const s = max ? fitSize(r.w, r.h, max) : { w: r.w, h: r.h, s: 1 }
  const c = canvas(s.w, s.h)
  const x = ctx2d(c)
  x.imageSmoothingQuality = 'high'
  x.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, s.w, s.h)
  const d = getData(c)
  return { w: s.w, h: s.h, data: new Uint8Array(d.data.buffer) }
}

export function brushControls(app: App, o: BrushOpts, which: { hardness?: boolean; flow?: boolean; strength?: boolean; color?: boolean; opacity?: boolean } = {}) {
  const out: HTMLElement[] = []
  out.push(slider('Size', () => o.size, v => { o.size = v; app.view.draw() }, { min: 1, max: 1000, unit: 'px' }))
  if (which.opacity !== false) out.push(slider('Opacity', () => Math.round(o.opacity * 100), v => (o.opacity = v / 100), { min: 1, max: 100 }))
  if (which.hardness !== false) out.push(slider('Hardness', () => Math.round(o.hardness * 100), v => (o.hardness = v / 100), { min: 0, max: 100 }))
  if (which.flow) out.push(slider('Flow', () => Math.round(o.flow * 100), v => (o.flow = v / 100), { min: 1, max: 100 }))
  if (which.strength) out.push(slider('Strength', () => Math.round(o.strength * 100), v => (o.strength = v / 100), { min: 1, max: 100 }))
  out.push(toggle('Pen pressure', () => o.pressure, v => (o.pressure = v)))
  return out
}

export function colorPanel(app: App, alpha = false, onAlpha?: (a: number) => void, getAlpha?: () => number) {
  const st = { hex: app.fg, alpha: getAlpha ? getAlpha() : 1 }
  const fgB = h('button', { class: 'fg', style: { background: app.fg }, 'aria-label': 'Foreground colour' })
  const bgB = h('button', { class: 'bgc', style: { background: app.bgc }, 'aria-label': 'Background colour' })
  let editing: 'fg' | 'bg' = 'fg'
  const wheel = colorWheel(st, (s, fin) => {
    if (editing === 'fg') app.setColors(s.hex)
    else app.setColors(app.fg, s.hex)
    if (alpha && onAlpha) onAlpha(s.alpha)
    fgB.style.background = app.fg; bgB.style.background = app.bgc
    if (fin) app.view.draw()
  }, { alpha, pick: () => { app.emit('pick-once') } })
  fgB.addEventListener('click', () => { editing = 'fg'; (wheel as any).set(app.fg); fgB.style.outlineColor = 'var(--sel)'; bgB.style.outlineColor = '' })
  bgB.addEventListener('click', () => { editing = 'bg'; (wheel as any).set(app.bgc); bgB.style.outlineColor = 'var(--sel)'; fgB.style.outlineColor = '' })
  const swap = tip(h('button', { class: 'ic', onclick: () => { app.setColors(app.bgc, app.fg); fgB.style.background = app.fg; bgB.style.background = app.bgc; (wheel as any).set(editing === 'fg' ? app.fg : app.bgc) } }, icon('swap')), 'Swap colours')
  const off = app.on('colors', () => { fgB.style.background = app.fg; bgB.style.background = app.bgc; (wheel as any).set(editing === 'fg' ? app.fg : app.bgc) })
  const el = h('div', { class: 'cw' }, h('div', { class: 'cwrow' }, h('div', { class: 'fgbg' }, bgB, fgB), swap, h('span', { class: 'sp' })), wheel)
  ;(el as any).dispose = off
  return el
}

export function drawBrushCursor(x: CanvasRenderingContext2D, v: Viewport, size: number) {
  if (!v.hover) return
  const p = v.toScreen(v.hover.x, v.hover.y)
  const r = Math.max(1.5, (size * v.zoom) / 2)
  x.save()
  x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2)
  x.lineWidth = 2.5; x.strokeStyle = 'rgba(0,0,0,.55)'; x.stroke()
  x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.9)'; x.stroke()
  if (r < 4) { x.beginPath(); x.moveTo(p.x - 6, p.y); x.lineTo(p.x + 6, p.y); x.moveTo(p.x, p.y - 6); x.lineTo(p.x, p.y + 6); x.stroke() }
  x.restore()
}

export function jobBox(app: App) {
  const j = app.job
  if (!j) return null
  return h('div', { class: 'job' },
    h('div', { class: 'fr' }, h('span', j.label), j.cancel && h('button', { onclick: () => j.cancel!() }, 'Cancel')),
    h('div', { class: 'prog' + (j.progress == null ? ' ind' : '') }, h('i', { style: { width: (j.progress ?? 0) * 100 + '%' } })),
    j.detail && h('span', { class: 'hint' }, j.detail))
}
