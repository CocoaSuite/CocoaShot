import type { App } from '../app'
import type { Tool } from './types'
import { Layer, makeLayer, snapshot } from '../core/doc'
import { touch, touchMask, effectiveMask } from '../core/compose'
import { Stroke, BrushOpts } from '../core/brush'
import { job } from '../core/jobs'
import { decodeImage } from '../core/io'
import { canvas, canvasFromAlpha, copyCanvas, ctx2d, getData, putData } from '../core/util'
import { h, icon, toast } from '../ui/dom'
import { btn, hint, sec, seg, select, slider, toggle } from '../ui/controls'
import { colorWheel } from '../ui/color'
import { ai, brushControls, drawBrushCursor, jobBox, rgbaOf } from './common'
import { native, pickLocal } from '../native'

const opts = { subject: 'auto' as 'auto' | 'person' | 'product' | 'animal', hair: true }

export function targetLayer(app: App): Layer | null {
  const doc = app.doc
  if (!doc) return null
  let l = doc.active
  if (l?.kind === 'background' && l.bgFor) l = doc.layer(l.bgFor)
  if (!l || !l.canvas || l.kind === 'text' || l.kind === 'shape' || l.kind === 'outline' || l.kind === 'adjust') {
    l = [...doc.layers].reverse().find(x => x.kind === 'image' && x.visible) || undefined
  }
  return l || null
}

async function refineFull(src: HTMLCanvasElement, mask: HTMLCanvasElement, r: number, eps: number): Promise<HTMLCanvasElement> {
  const w = src.width, hh = src.height
  const d = getData(src).data
  const m = getData(mask).data
  const a = new Uint8Array(w * hh)
  for (let i = 0; i < a.length; i++) a[i] = m[i * 4 + 3]
  const out: Uint8Array = await job('refine', { data: d, mask: a, w, h: hh, r, eps }, [d.buffer, a.buffer])
  return canvasFromAlpha(out, w, hh)
}

export async function removeBackground(app: App) {
  const doc = app.doc!
  const l = targetLayer(app)
  if (!l) { toast('Select an image layer first'); return }
  const t0 = performance.now()
  await app.run('Removing the background', async prog => {
    const model = opts.subject === 'person' ? 'modnet' : app.settings.bgModel === 'modnet' ? 'isnet' : app.settings.bgModel
    const src = rgbaOf(l.canvas!, 1024)
    const r = await ai(app, 'removeBg', { ...src, model }, prog)
    prog(null, 'Matching edges at full resolution')
    const small = canvasFromAlpha(r.mask, r.w, r.h)
    let full = canvas(doc.w, doc.h)
    const fx = ctx2d(full); fx.imageSmoothingQuality = 'high'; fx.drawImage(small, 0, 0, doc.w, doc.h)
    if (opts.hair) {
      const rad = Math.max(2, Math.round(Math.max(doc.w, doc.h) / 1024 * 3))
      if (doc.w * doc.h <= 40e6) full = await refineFull(l.canvas!, full, rad, 0.0008)
    }
    const before = snapshot(doc)
    l.mask = full
    l.maskAI = copyCanvas(full)
    l.maskOpts = { feather: 0, smooth: 0, shift: 0 }
    touchMask(l)
    doc.activeId = l.id
    app.hist!.structural('Remove background', before)
    doc.structure()
    toast(`Background removed in ${((performance.now() - t0) / 1000).toFixed(1)} s. Use Refine to fix any edge.`)
  })
}

function previewSeg(app: App) {
  return seg<'normal' | 'mask' | 'overlay'>([['normal', 'Transparent'], ['mask', 'Mask'], ['overlay', 'Overlay']], () => app.view.maskView, v => { app.view.maskView = v; app.view.draw() })
}

function maskActions(app: App, l: Layer | null) {
  if (!l?.mask) return []
  return [sec('Mask'),
    h('div', { class: 'g2' },
      btn('Apply mask', async () => {
        await app.hist!.op('Apply mask', () => {
          const m = effectiveMask(l)!
          const c = copyCanvas(l.canvas!); const x = ctx2d(c); x.globalCompositeOperation = 'destination-in'; x.drawImage(m, 0, 0)
          l.canvas = c; l.mask = null; l.maskAI = null; touch(l)
        })
      }),
      btn('Remove mask', () => app.hist!.op('Remove mask', () => { l.mask = null; l.maskAI = null; touch(l) }), 'danger'))]
}

export function bgTools(app: App): Tool[] {
  const remove: Tool = {
    id: 'bg-remove', label: 'Remove', icon: 'bg',
    panel() {
      const l = targetLayer(app)
      return h('div', { class: 'ib' },
        sec('Background removal'),
        h('button', { class: 'pri big wide', onclick: () => removeBackground(app), disabled: !!app.job }, icon('sparkle'), 'Remove background'),
        jobBox(app),
        hint(l?.mask ? 'The background is hidden with a mask, so nothing is lost. Refine lets you paint corrections.' : 'Runs on this computer. Your image is never uploaded.'),
        seg([['auto', 'Auto'], ['person', 'Person'], ['product', 'Product'], ['animal', 'Animal']], () => opts.subject, v => (opts.subject = v as any), 'Subject'),
        select('Model', [['isnet', 'ISNet, general'], ['birefnet', 'BiRefNet, maximum detail']], () => (app.settings.bgModel === 'modnet' ? 'isnet' : app.settings.bgModel) as any, v => { app.settings.bgModel = v; app.saveSettings() }),
        toggle('Hair and fur detail', () => opts.hair, v => (opts.hair = v)),
        l?.mask && sec('Preview'), l?.mask && previewSeg(app),
        ...maskActions(app, l))
    }
  }

  const bo: BrushOpts = { size: 60, opacity: 1, hardness: 0.6, flow: 1, spacing: 0.15, color: '#fff', pressure: true, pencil: false, strength: 0.5 }
  let mode: 'mask-keep' | 'mask-remove' | 'mask-restore' = 'mask-keep'
  let stroke: Stroke | null = null
  const refine: Tool = {
    id: 'bg-refine', label: 'Refine edges', icon: 'brush',
    cursor: () => 'none',
    down(p) {
      const l = targetLayer(app)
      if (!l) return
      if (l.locked) { toast(`${l.name} is locked`); return }
      const m = p.e.altKey ? (mode === 'mask-keep' ? 'mask-remove' : 'mask-keep') : mode
      stroke = new Stroke(app.doc!, l, m, bo, app.hist!, null, m === 'mask-keep' ? 'Keep area' : m === 'mask-remove' ? 'Remove area' : 'Restore area')
      app.stroke = stroke
      stroke.begin(p.x, p.y, p.p)
    },
    move(p, pressed) { if (pressed && stroke) stroke.move(p.x, p.y, p.p) },
    up() { if (stroke) { stroke.end(); stroke = null; app.stroke = null; app.emit('layers') } },
    overlay: (x, v) => drawBrushCursor(x, v, bo.size),
    panel() {
      const l = targetLayer(app)
      if (!l?.mask) return h('div', { class: 'ib' }, sec('Refine edges'), hint('Remove the background first, or paint with Keep or Remove to build a mask by hand.'),
        h('div', { class: 'seg' }, ...(['mask-keep', 'mask-remove'] as const).map(m => h('button', { class: mode === m ? 'on' : '', onclick: () => { mode = m; app.emit('panel') } }, m === 'mask-keep' ? 'Keep' : 'Remove'))),
        ...brushControls(app, bo, { flow: false }), btn('Remove background', () => removeBackground(app), 'pri wide'))
      const upd = () => { touchMask(l); app.doc!.changed() }
      let snapBefore: any = null
      const startEdit = () => { if (!snapBefore) snapBefore = snapshot(app.doc!) }
      const endEdit = (label: string) => () => { if (snapBefore) { app.hist!.structural(label, snapBefore); snapBefore = null } }
      return h('div', { class: 'ib' },
        sec('Brush'),
        seg([['mask-keep', 'Keep'], ['mask-remove', 'Remove'], ['mask-restore', 'Restore']], () => mode, v => (mode = v as any)),
        ...brushControls(app, bo, { flow: false }),
        sec('Edges'),
        slider('Feather', () => l.maskOpts.feather, v => { startEdit(); l.maskOpts.feather = v; upd() }, { min: 0, max: 40, step: 0.5, def: 0, onEnd: endEdit('Feather edge') }),
        slider('Smooth', () => l.maskOpts.smooth, v => { startEdit(); l.maskOpts.smooth = v; upd() }, { min: 0, max: 100, def: 0, onEnd: endEdit('Smooth edge') }),
        slider('Shift edge', () => l.maskOpts.shift, v => { startEdit(); l.maskOpts.shift = v; upd() }, { min: -40, max: 40, def: 0, onEnd: endEdit('Shift edge') }),
        h('button', {
          class: 'wide', onclick: () => app.run('Refining edges', async () => {
            const nm = await refineFull(l.canvas!, l.mask!, Math.max(3, Math.round(Math.max(app.doc!.w, app.doc!.h) / 400)), 0.002)
            await app.hist!.op('Refine edges', () => { l.mask = nm; touchMask(l) })
          })
        }, icon('sparkle'), 'Snap edges to detail'),
        jobBox(app),
        sec('Preview'), previewSeg(app),
        ...maskActions(app, l))
    }
  }

  const rep = { color: '#ffffff', blur: 16 }
  const bgOf = (l: Layer) => app.doc!.layers.find(x => x.kind === 'background' && x.bgFor === l.id)
  const setBg = async (mode: 'none' | 'color' | 'image' | 'blur', image?: HTMLCanvasElement) => {
    const doc = app.doc!
    const l = targetLayer(app)
    if (!l) return
    if (!l.mask && mode !== 'none') toast('Tip: remove the background first so the new one shows through')
    await app.hist!.op('Replace background', () => {
      let b = bgOf(l)
      if (mode === 'none') { if (b) doc.layers = doc.layers.filter(x => x !== b); doc.activeId = l.id; return }
      if (!b) {
        b = makeLayer('background', 'Background', doc.w, doc.h)
        b.bgFor = l.id
        doc.layers.splice(doc.index(l.id), 0, b)
      }
      b.bg = { mode, color: rep.color, blur: rep.blur, image: image || b.bg?.image }
      touch(b)
      doc.activeId = l.id
    })
  }
  const replace: Tool = {
    id: 'bg-replace', label: 'Replace', icon: 'image',
    panel() {
      const l = targetLayer(app)
      const b = l && bgOf(l)
      const cur = b?.bg?.mode || 'none'
      const update = () => { const bb = l && bgOf(l); if (bb?.bg) { bb.bg.color = rep.color; bb.bg.blur = rep.blur; touch(bb); app.doc!.changed() } }
      return h('div', { class: 'ib' },
        sec('Replace background'),
        seg([['none', 'None'], ['color', 'Colour'], ['image', 'Image'], ['blur', 'Blur']], () => cur, async v => {
          if (v === 'image') {
            const f = native ? await native.openDialog('image-only') : await pickLocal('image/*')
            if (!f) return
            const r = await decodeImage(f.name, f.data)
            await setBg('image', r.canvas)
          } else await setBg(v as any)
          app.emit('panel')
        }),
        cur === 'color' && colorWheel({ hex: b?.bg?.color || rep.color, alpha: 1 }, (s, fin) => { rep.color = s.hex; update() }),
        cur === 'blur' && slider('Blur', () => b?.bg?.blur ?? rep.blur, v => { rep.blur = v; update() }, { min: 1, max: 120, unit: 'px', def: 16 }),
        cur === 'blur' && hint('Uses the original photo, blurred, behind your subject.'),
        cur === 'image' && btn('Choose another image', async () => {
          const f = native ? await native.openDialog('image-only') : await pickLocal('image/*')
          if (!f) return
          const r = await decodeImage(f.name, f.data)
          await setBg('image', r.canvas)
        }, 'wide'))
    }
  }
  return [remove, refine, replace]
}
