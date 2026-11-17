import type { App } from '../app'
import type { Tool } from './types'
import { Layer, snapshot } from '../core/doc'
import { touch } from '../core/compose'
import { job } from '../core/jobs'
import { resizeDoc } from '../core/transform'
import { alphaOf, bboxOfAlpha, canvas, canvasFromAlpha, ctx2d, getData, putData, Rect, rectClip, mkID } from '../core/util'
import { morph } from '../core/px'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, slider, toggle } from '../ui/controls'
import { ai, drawBrushCursor, jobBox, rgbaOf } from './common'
import { targetLayer } from './background'
import { adjLayer, autoAdjust } from './adjust'
import { applySelection } from './select'
import { native } from '../native'
import { toolSteps } from '../core/steps'

function maskBrush(app: App, size: { v: number }, onDone: (mask: HTMLCanvasElement) => void) {
  let m: HTMLCanvasElement | null = null
  let last: { x: number; y: number } | null = null
  let drawing = false
  const dab = (x: number, y: number) => {
    const c = ctx2d(m!)
    c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineWidth = size.v
    c.beginPath()
    if (last) { c.moveTo(last.x, last.y); c.lineTo(x, y); c.stroke() }
    c.beginPath(); c.arc(x, y, size.v / 2, 0, Math.PI * 2); c.fill()
    last = { x, y }
  }
  return {
    down(p: any) { if (app.job) return; const d = app.doc!; if (!m || m.width !== d.w || m.height !== d.h) m = canvas(d.w, d.h); drawing = true; last = null; dab(p.x, p.y) },
    move(p: any, pressed: boolean) { if (pressed && drawing && m) dab(p.x, p.y) },
    up() { if (!drawing || !m) return; drawing = false; const mm = m; m = null; onDone(mm) },
    overlay(x: CanvasRenderingContext2D, v: any) {
      if (m) {
        const t = canvas(m.width, m.height), tx = ctx2d(t)
        tx.drawImage(m, 0, 0); tx.globalCompositeOperation = 'source-in'; tx.fillStyle = 'rgba(255,70,70,.5)'; tx.fillRect(0, 0, t.width, t.height)
        x.drawImage(t, v.ox, v.oy, m.width * v.zoom, m.height * v.zoom)
      }
      drawBrushCursor(x, v, size.v)
    }
  }
}

export async function inpaintLayer(app: App, l: Layer, mask: HTMLCanvasElement, method: 'ai' | 'quick', label: string) {
  const doc = app.doc!
  const a = alphaOf(mask)
  const bb = bboxOfAlpha(a, doc.w, doc.h)
  if (!bb) return
  const side = Math.max(bb.w, bb.h)
  const ctxSide = Math.min(Math.max(doc.w, doc.h), Math.max(method === 'ai' ? 256 : 64, Math.round(side * (method === 'ai' ? 2.4 : 1.6))))
  const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2
  const R = rectClip({ x: cx - ctxSide / 2, y: cy - ctxSide / 2, w: ctxSide, h: ctxSide }, doc.w, doc.h)!
  const grow = Math.max(2, Math.round(side * 0.04))
  const f = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) f[i] = a[i] / 255
  const g = morph(f, doc.w, doc.h, grow)
  const ga = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) ga[i] = g[i] > 0.05 ? 255 : 0
  const big = canvasFromAlpha(ga, doc.w, doc.h)
  let patch: HTMLCanvasElement
  if (method === 'ai') {
    const S = 512
    const img = canvas(S, S), ix = ctx2d(img); ix.imageSmoothingQuality = 'high'; ix.drawImage(l.canvas!, R.x, R.y, R.w, R.h, 0, 0, S, S)
    const mk = canvas(S, S), mx = ctx2d(mk); mx.drawImage(big, R.x, R.y, R.w, R.h, 0, 0, S, S)
    const md = getData(mk).data, m1 = new Uint8Array(S * S)
    for (let i = 0; i < m1.length; i++) m1[i] = md[i * 4 + 3] > 20 ? 255 : 0
    const out: Uint8Array = await ai(app, 'inpaint', { data: new Uint8Array(getData(img).data.buffer), mask: m1 }, () => {})
    const oc = canvas(S, S); putData(oc, mkID(out, S, S))
    patch = canvas(R.w, R.h); const px = ctx2d(patch); px.imageSmoothingQuality = 'high'; px.drawImage(oc, 0, 0, R.w, R.h)
  } else {
    const d = getData(l.canvas!, R)
    const md = getData(big, R).data, m1 = new Uint8Array(R.w * R.h)
    for (let i = 0; i < m1.length; i++) m1[i] = md[i * 4 + 3]
    const out: Uint8ClampedArray = await job('inpaint', { data: d.data, mask: m1, w: R.w, h: R.h }, [d.data.buffer])
    patch = canvas(R.w, R.h); putData(patch, mkID(out, R.w, R.h))
  }
  const soft = canvas(R.w, R.h), sx = ctx2d(soft)
  sx.filter = `blur(${Math.max(1, grow * 0.6)}px)`
  sx.drawImage(big, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h)
  sx.filter = 'none'
  sx.globalCompositeOperation = 'source-in'
  sx.drawImage(patch, 0, 0)
  const before = getData(l.canvas!, R)
  const lx = ctx2d(l.canvas!)
  lx.save()
  if (l.alphaLock || l.kind === 'image') lx.globalCompositeOperation = 'source-atop'
  lx.drawImage(soft, R.x, R.y)
  lx.restore()
  touch(l, R)
  app.hist!.raster(label, l, 'canvas', R, before)
  doc.changed(R)
}

const CATS: Record<string, string[]> = {
  People: ['person'],
  Animals: ['bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'],
  Vehicles: ['bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat'],
}

export function aiTools(app: App): Tool[] {
  const rm = { size: { v: 50 }, method: 'ai' as 'ai' | 'quick' }
  const target = () => { const l = targetLayer(app); if (!l) toast('Select an image layer first'); else if (l.locked) { toast(`${l.name} is locked`); return null } return l }
  const rmBrush = maskBrush(app, rm.size, mask => {
    const l = target()
    if (!l) return
    app.run('Removing the object', async p => {
      await inpaintLayer(app, l, mask, rm.method, 'Remove object')
    })
  })
  const remove: Tool = {
    id: 'ai-remove', label: 'Remove object', icon: 'sparkle',
    cursor: () => 'none',
    brush: () => ({ getSize: () => rm.size.v, setSize: v => { rm.size.v = v }, minSize: 4, maxSize: 600 }),
    down: p => rmBrush.down(p), move: (p, pr) => rmBrush.move(p, pr), up: () => rmBrush.up(),
    overlay: (x, v) => rmBrush.overlay(x, v),
    panel: () => h('div', { class: 'ib' }, sec('Remove object'),
      hint('Paint over anything you want gone. It is removed when you let go, and the area is rebuilt from its surroundings.'),
      slider('Brush size', () => rm.size.v, v => (rm.size.v = v), { min: 4, max: 600 }),
      seg([['ai', 'AI, best'], ['quick', 'Quick fill']], () => rm.method, v => (rm.method = v as any), 'Method'),
      jobBox(app))
  }

  const cl = { size: { v: 24 }, noise: 40 }
  const healBrush = maskBrush(app, cl.size, mask => {
    const l = target()
    if (!l) return
    const bb = bboxOfAlpha(alphaOf(mask), mask.width, mask.height)
    const method = bb && Math.max(bb.w, bb.h) > 80 ? 'ai' : 'quick'
    app.run('Healing', () => inpaintLayer(app, l, mask, method, 'Heal'))
  })
  const cleanup: Tool = {
    id: 'ai-cleanup', label: 'Cleanup', icon: 'heal',
    cursor: () => 'none',
    brush: () => ({ getSize: () => cl.size.v, setSize: v => { cl.size.v = v }, minSize: 2, maxSize: 300 }),
    down: p => healBrush.down(p), move: (p, pr) => healBrush.move(p, pr), up: () => healBrush.up(),
    overlay: (x, v) => healBrush.overlay(x, v),
    panel: () => h('div', { class: 'ib' },
      sec('Heal'), hint('Paint over dust, spots, scratches or damage to repair them.'),
      slider('Brush size', () => cl.size.v, v => (cl.size.v = v), { min: 2, max: 300 }),
      sec('Reduce noise'),
      slider('Strength', () => cl.noise, v => (cl.noise = v), { min: 1, max: 100, def: 40 }),
      h('button', {
        class: 'wide', onclick: () => {
          const l = target()
          if (!l) return
          app.run('Reducing noise', async () => {
            const d = getData(l.canvas!)
            const before = getData(l.canvas!)
            const out: Uint8ClampedArray = await job('denoise', { data: d.data, w: d.width, h: d.height, strength: cl.noise / 100 }, [d.data.buffer])
            putData(l.canvas!, mkID(out, d.width, d.height))
            touch(l)
            app.hist!.raster('Reduce noise', l, 'canvas', { x: 0, y: 0, w: d.width, h: d.height }, before)
            app.doc!.changed()
          })
        }
      }, 'Reduce noise'),
      jobBox(app))
  }

  let scale: 2 | 4 = 2
  const upscale: Tool = {
    id: 'ai-upscale', label: 'Upscale', icon: 'up',
    panel() {
      const d = app.doc!
      return h('div', { class: 'ib' }, sec('AI upscale'),
        hint('Enlarges the image and rebuilds fine detail. Large images take a while.'),
        seg([['2', '2×'], ['4', '4×']], () => String(scale) as '2' | '4', v => { scale = +v as 2 | 4; app.emit('panel') }),
        hint(`${d.w} × ${d.h} px becomes ${d.w * scale} × ${d.h * scale} px.`),
        h('button', {
          class: 'pri big wide', disabled: !!app.job, onclick: () => {
            const l = targetLayer(app)
            if (!l) return
            if (d.w * d.h * scale * scale > 120e6) { toast('The result would be too large. Crop or resize first.'); return }
            app.run('Upscaling', async p => {
              const src = rgbaOf(l.canvas!)
              const r = await ai(app, 'upscale', { ...src, scale }, p)
              p(null, 'Finishing')
              const W = d.w * scale, H = d.h * scale
              await resizeDoc(d, app.hist!, W, H, 'lanczos')
              const up = canvas(W, H)
              putData(up, mkID(r.data, W, H))
              const ux = ctx2d(up)
              ux.globalCompositeOperation = 'destination-in'
              ux.drawImage(l.canvas!, 0, 0)
              const before = getData(l.canvas!)
              putData(l.canvas!, getData(up))
              touch(l)
              app.hist!.raster('Upscale detail', l, 'canvas', { x: 0, y: 0, w: W, h: H }, before)
              d.structure()
              app.view.fit()
            })
          }
        }, icon('sparkle'), 'Upscale'),
        jobBox(app))
    }
  }

  const en = { color: true, noise: false, sharpen: true }
  const enhance: Tool = {
    id: 'ai-enhance', label: 'Enhance', icon: 'ai',
    panel: () => h('div', { class: 'ib' }, sec('Enhance'),
      hint('Improves exposure, colour and clarity in one step. The colour changes stay adjustable in Adjustments.'),
      toggle('Exposure and colour', () => en.color, v => (en.color = v)),
      toggle('Sharpen details', () => en.sharpen, v => (en.sharpen = v)),
      toggle('Reduce noise', () => en.noise, v => (en.noise = v)),
      h('button', {
        class: 'pri big wide', onclick: () => app.run('Enhancing', async () => {
          const doc = app.doc!
          if (en.noise) {
            const l = targetLayer(app)
            if (l?.canvas && !l.locked) {
              const d = getData(l.canvas), before = getData(l.canvas)
              const out: Uint8ClampedArray = await job('denoise', { data: d.data, w: d.width, h: d.height, strength: 0.3 }, [d.data.buffer])
              putData(l.canvas, mkID(out, d.width, d.height))
              touch(l)
              app.hist!.raster('Reduce noise', l, 'canvas', { x: 0, y: 0, w: d.width, h: d.height }, before)
            }
          }
          if (en.color || en.sharpen) {
            const before = snapshot(doc)
            const l = adjLayer(app, true)!
            const auto = autoAdjust(doc, l, 'enhance')
            if (!en.color) { auto.levels = [0, 255, 0, 255, 0, 255]; auto.exposure = 0; auto.vibrance = 0; auto.shadows = 0; auto.highlights = 0 }
            if (!en.sharpen) { auto.sharpness = 0; auto.clarity = 0 }
            Object.assign(l.adjust!, auto)
            app.hist!.structural('Enhance', before)
          }
          doc.structure()
        })
      }, icon('sparkle'), 'Enhance'),
      jobBox(app))
  }

  let found: { label: string; score: number; box: number[]; on: boolean }[] = []
  const detectSteps = toolSteps(app, () => found.map(f => f.on), v => { v.forEach((on, i) => { if (found[i]) found[i].on = on }) })
  const detect: Tool = {
    id: 'ai-detect', label: 'Find objects', icon: 'person', steps: detectSteps,
    activate() { found = []; detectSteps.reset() },
    overlay(x, v) {
      x.save()
      x.font = '500 11px Inter, sans-serif'
      for (const f of found) {
        const a = v.toScreen(f.box[0], f.box[1]), b = v.toScreen(f.box[2], f.box[3])
        x.strokeStyle = f.on ? '#8AA7D9' : 'rgba(255,255,255,.4)'; x.lineWidth = f.on ? 2 : 1
        x.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
        const t = f.label, w = x.measureText(t).width + 10
        x.fillStyle = f.on ? '#8AA7D9' : 'rgba(30,30,30,.8)'; x.fillRect(a.x, a.y - 18, w, 18)
        x.fillStyle = f.on ? '#111' : '#fff'; x.fillText(t, a.x + 5, a.y - 5)
      }
      x.restore()
    },
    down(p) {
      const f = found.find(f => p.x >= f.box[0] && p.y >= f.box[1] && p.x <= f.box[2] && p.y <= f.box[3])
      if (f) { detectSteps.mark(); f.on = !f.on; app.emit('panel'); app.view.draw() }
    },
    panel() {
      const doc = app.doc!
      const find = () => app.run('Looking for objects', async p => {
        const src = rgbaOf(doc.comp, 1200)
        const s = doc.w / src.w
        const r = await ai(app, 'detect', { ...src, threshold: 0.75 }, p)
        found = r.map((f: any) => ({ ...f, box: f.box.map((v: number) => v * s), on: true }))
        detectSteps.reset()
        if (!found.length) toast('No objects found')
        app.view.draw()
      })
      const selectFound = async () => {
        const list = found.filter(f => f.on)
        if (!list.length) return false
        let ok = false
        await app.run('Selecting', async p => {
          const src = rgbaOf(doc.comp, 1024)
          const s = src.w / doc.w
          await ai(app, 'samEmbed', src, p)
          const full = canvas(doc.w, doc.h), fx = ctx2d(full)
          fx.imageSmoothingQuality = 'high'
          for (const f of list) {
            const r = await ai(app, 'samMask', { box: f.box.map(v => v * s) }, p)
            fx.drawImage(canvasFromAlpha(r.mask, r.w, r.h), 0, 0, doc.w, doc.h)
          }
          applySelection(app, full, 'new', 'Select objects')
          ok = true
        })
        return ok
      }
      const pick = (cat: string) => { found.forEach(f => (f.on = cat === 'all' || (CATS[cat] || []).includes(f.label) || (cat === 'Objects' && !Object.values(CATS).flat().includes(f.label)))); app.emit('panel'); app.view.draw() }
      const counts = Object.keys(CATS).concat('Objects').map(c => [c, found.filter(f => (CATS[c] ? CATS[c].includes(f.label) : !Object.values(CATS).flat().includes(f.label))).length] as [string, number])
      return h('div', { class: 'ib' }, sec('Find objects'),
        hint('Finds people, animals, vehicles and everyday objects so you can select, highlight or outline them in one click.'),
        h('button', { class: 'pri big wide', onclick: find }, icon('sparkle'), found.length ? 'Search again' : 'Find objects'),
        jobBox(app),
        found.length > 0 && sec(`${found.length} found`),
        found.length > 0 && h('div', { class: 'g2' }, btn('All', () => pick('all')), ...counts.filter(c => c[1]).map(([c, n]) => btn(`${c} (${n})`, () => pick(c)))),
        found.length > 0 && hint('Click a box on the image to include or leave it out.'),
        found.length > 0 && h('div', { class: 'g2' },
          h('button', { class: 'pri', onclick: () => selectFound() }, 'Select'),
          btn('Highlight', async () => { if (await selectFound()) app.setTool('highlight'); toast('Selected. Use Highlight the selection.') }),
          btn('Outline', async () => { if (await selectFound()) app.setTool('outline'); toast('Selected. Use Outline selection.') }),
          btn('Remove background', async () => {
            if (!(await selectFound())) return
            const l = targetLayer(app)
            if (!l || !doc.selection) return
            await app.hist!.op('Keep selected objects', () => { l.mask = canvas(doc.w, doc.h); ctx2d(l.mask).drawImage(doc.selection!, 0, 0); l.maskAI = canvas(doc.w, doc.h); ctx2d(l.maskAI).drawImage(doc.selection!, 0, 0); touch(l); l.maskDirty = true })
          })))
    }
  }
  return [remove, cleanup, upscale, enhance, detect]
}
