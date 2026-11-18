import type { App, ActionDef } from '../app'
import type { Adjust } from './doc'
import { cloneAdjust, snapshot } from './doc'
import { flatten } from './compose'
import { cropDoc, flip, resizeDoc, rotate90 } from './transform'
import { uid } from './util'
import type { ExportFormat } from './io'
import { adjLayer } from '../tools/adjust'
import { runFilter, FILTERS } from '../tools/filters'
import { removeBgCore, targetLayer } from '../tools/background'
import { denoiseLayer, enhanceCore, upscaleCore } from '../tools/ai'
import { expandCanvas, fillOutside, sidesForRatio, type FillMethod, type Sides } from '../tools/expand'
import { findAreas, redactLayer, type RedactOpts } from '../tools/redact'
import { exportQuick } from '../ui/dialogs'
import { toast } from '../ui/dom'
import { tr, tn } from '../i18n'

/** One recorded command. Sizes and boxes that depend on the image are kept relative where that makes sense. */
export type Step =
  | { kind: 'adjust'; a: Adjust }
  | { kind: 'filter'; id: string; p: Record<string, number> }
  | { kind: 'rotate'; dir: 1 | -1 }
  | { kind: 'flip'; horiz: boolean }
  | { kind: 'resize'; w?: number; h?: number; long?: number; pct?: number; method: string }
  | { kind: 'crop'; r: number[]; angle: number; ow?: number; oh?: number; fill: FillMethod }
  | { kind: 'expand'; s: Sides; method: FillMethod }
  | { kind: 'expandRatio'; ratio: number; label: string; method: FillMethod }
  | { kind: 'bgremove' }
  | { kind: 'enhance'; color: boolean; noise: boolean; sharpen: boolean }
  | { kind: 'denoise'; strength: number }
  | { kind: 'upscale'; scale: 2 | 4 }
  | { kind: 'redact'; o: RedactOpts; find: ('face' | 'person')[]; boxes: number[][] }
  | { kind: 'flatten' }
  | { kind: 'export'; format: ExportFormat; quality: number; transparent: boolean; matte: string; scale: number }

/** A short description of a step for the actions list. */
export function describe(s: Step): string {
  switch (s.kind) {
    case 'adjust': return tr('Adjustments')
    case 'filter': return tr('Filter: {0}', FILTERS.find(f => f.id === s.id)?.label || s.id)
    case 'rotate': return s.dir > 0 ? tr('Rotate right') : tr('Rotate left')
    case 'flip': return s.horiz ? tr('Flip image horizontally') : tr('Flip image vertically')
    case 'resize': return s.long ? tr('Resize, longest side {0} px', s.long) : s.pct ? tr('Resize to {0}%', s.pct) : tr('Resize to {0} × {1} px', s.w!, s.h!)
    case 'crop': return s.ow ? tr('Crop to {0} × {1} px', s.ow, s.oh!) : tr('Crop')
    case 'expand': return tr('Expand canvas')
    case 'expandRatio': return tr('Expand to {0}', s.label)
    case 'bgremove': return tr('Remove background')
    case 'enhance': return tr('Enhance')
    case 'denoise': return tr('Reduce noise')
    case 'upscale': return tr('Upscale {0}×', s.scale)
    case 'redact': return s.find.includes('face') ? tr('Redact faces') : tr('Redact')
    case 'flatten': return tr('Flatten image')
    case 'export': return tr('Export as {0}', s.format.toUpperCase())
  }
}

/** Merges every layer into one image layer, as one undo step. */
export async function flattenDoc(app: App) {
  const d = app.doc
  if (!d) return
  await app.hist!.op(tr('Flatten image'), () => {
    const c = flatten(d)
    const base = d.layers.find(l => l.kind === 'image') || d.layers[0]
    base.canvas = c; base.mask = null; base.maskAI = null; base.visible = true; base.opacity = 1; base.blend = 'source-over'; base.clip = false; base.kind = 'image'; base.name = tr('Image')
    base.parent = null; base.fx = null; base.fxCache = null
    base.dirty = true
    d.layers = [base]; d.activeId = base.id
  })
}

type Prog = (p: number | null, d?: string) => void

async function runStep(app: App, s: Step, prog: Prog) {
  const d = app.doc!, hist = app.hist!
  const layer = () => { const l = targetLayer(app); if (!l) throw new Error(tr('This image has no image layer')); return l }
  switch (s.kind) {
    case 'adjust': {
      // The top adjustment layer takes the recorded settings (one is added if there is none).
      const before = snapshot(d)
      const l = adjLayer(app, true)!
      l.adjust = cloneAdjust(s.a)
      hist.structural(tr('Adjust'), before)
      d.structure()
      return
    }
    case 'filter': {
      // A filter works on the selected layer; pick the image when an adjustment or text layer is selected.
      const a = d.active
      if (!a || !a.canvas || ['text', 'shape', 'outline', 'adjust', 'background', 'group'].includes(a.kind)) { const l = targetLayer(app); if (l) d.activeId = l.id }
      runFilter(app, s.id, s.p)
      return
    }
    case 'rotate': rotate90(d, hist, s.dir); return
    case 'flip': flip(d, hist, s.horiz); return
    case 'resize': {
      let w = s.w || d.w, h = s.h || d.h
      if (s.long) { const k = s.long / Math.max(d.w, d.h); w = Math.max(1, Math.round(d.w * k)); h = Math.max(1, Math.round(d.h * k)) }
      else if (s.pct) { w = Math.max(1, Math.round(d.w * s.pct / 100)); h = Math.max(1, Math.round(d.h * s.pct / 100)) }
      if (w !== d.w || h !== d.h) await resizeDoc(d, hist, w, h, s.method, prog)
      return
    }
    case 'crop': {
      const l = s.fill !== 'none' ? targetLayer(app) : null
      const cover = cropDoc(d, hist, { x: s.r[0] * d.w, y: s.r[1] * d.h, w: s.r[2] * d.w, h: s.r[3] * d.h }, s.angle, s.ow, s.oh)
      if (l && d.layers.includes(l)) await fillOutside(app, l, cover, s.fill, prog, app.bgc)
      return
    }
    case 'expand': await expandCanvas(app, s.s, s.method, prog); return
    case 'expandRatio': { const sd = sidesForRatio(d.w, d.h, s.ratio); if (sd.t || sd.r || sd.b || sd.l) await expandCanvas(app, sd, s.method, prog); return }
    case 'bgremove': await removeBgCore(app, layer(), prog); return
    case 'enhance': await enhanceCore(app, s); return
    case 'denoise': await denoiseLayer(app, layer(), s.strength / 100); return
    case 'upscale': await upscaleCore(app, layer(), s.scale, prog); return
    case 'redact': {
      const boxes = s.boxes.map(b => [b[0] * d.w, b[1] * d.h, b[2] * d.w, b[3] * d.h])
      for (const w of s.find) boxes.push(...(await findAreas(app, w, prog)))
      if (boxes.length) redactLayer(app, layer(), boxes, s.o)
      return
    }
    case 'flatten': await flattenDoc(app); return
    case 'export': await exportQuick(app, s); return
  }
}

/** Plays an action on the current image, or on every open image one after another. */
export async function playAction(app: App, a: ActionDef, allOpen = false) {
  if (!a.steps.length) { toast(tr('This action has no steps yet')); return }
  if (app.recording) { toast(tr('Stop recording before playing an action')); return }
  const docs = allOpen ? [...app.docs] : app.doc ? [app.doc] : []
  if (!docs.length) { toast(tr('Open an image first')); return }
  const back = app.doc
  let done = 0
  app.playing = true
  try {
    await app.run(tr('Playing {0}', a.name), async prog => {
      for (const doc of docs) {
        // The running action holds the lock that stops tab switches; it may switch images itself.
        const j = app.job
        if (j) j.lock = false
        app.activate(doc)
        if (j) j.lock = true
        for (let i = 0; i < a.steps.length; i++) {
          const s = a.steps[i]
          prog((done * a.steps.length + i) / (docs.length * a.steps.length), (docs.length > 1 ? doc.name + ': ' : '') + describe(s))
          await runStep(app, s, () => {})
        }
        done++
      }
    })
  } finally {
    app.playing = false
    if (allOpen && back && app.docs.includes(back) && app.doc !== back) app.activate(back)
    app.view.draw()
  }
  if (done === docs.length) toast(docs.length > 1 ? tn(docs.length, 'Played {1} on {0} image', 'Played {1} on {0} images', a.name) : tr('Played {0}', a.name))
}

export function startRecording(app: App, name: string) {
  app.recording = { name: name.trim() || tr('New action'), steps: [] }
  app.emit('recording')
}

/** Ends recording and keeps the action, unless nothing was recorded. */
export function stopRecording(app: App): ActionDef | null {
  const r = app.recording
  app.recording = null
  app.emit('recording')
  if (!r) return null
  if (!r.steps.length) { toast(tr('Nothing was recorded')); return null }
  const a: ActionDef = { id: uid(), name: r.name, steps: r.steps }
  app.settings.actions = [...app.settings.actions, a]
  app.saveSettings()
  toast(tn(a.steps.length, 'Saved {1} with {0} step', 'Saved {1} with {0} steps', a.name))
  return a
}

/** Ready-made actions, offered when there are none of the user's own. */
export const STARTER_ACTIONS = (): ActionDef[] => [
  { id: 'web', name: tr('Web ready'), steps: [{ kind: 'resize', long: 1920, method: 'lanczos' }, { kind: 'filter', id: 'unsharp', p: { a: 60, r: 1, t: 2, fade: 100 } }] },
  { id: 'faces', name: tr('Blur all faces'), steps: [{ kind: 'redact', o: { style: 'blur', strength: 70, shape: 'ellipse', pad: 15, color: '#000000' }, find: ['face'], boxes: [] }] },
  { id: 'square', name: tr('Square for social media'), steps: [{ kind: 'expandRatio', ratio: 1, label: '1:1', method: 'edge' }] },
  { id: 'film', name: tr('Film look'), steps: [{ kind: 'filter', id: 'noise', p: { a: 8, z: 1.5, u: 0, m: 1, fade: 100 } }, { kind: 'filter', id: 'vignette', p: { a: 35, s: 55, f: 70, fade: 100 } }] }
]
