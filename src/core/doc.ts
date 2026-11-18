import { canvas, copyCanvas, ctx2d, Emitter, type Rect, uid } from './util'
import { tr } from '../i18n'

export type LayerKind = 'image' | 'paint' | 'text' | 'shape' | 'highlight' | 'outline' | 'adjust' | 'background' | 'group'
export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light' | 'difference' | 'color' | 'luminosity'

export interface MaskOpts { feather: number; smooth: number; shift: number }

export interface Adjust {
  exposure: number; brightness: number; contrast: number; highlights: number; shadows: number
  whites: number; blacks: number; gamma: number; temperature: number; tint: number
  saturation: number; vibrance: number; hue: number; sharpness: number; clarity: number
  grayscale: boolean; sepia: boolean; invert: boolean
  levels: number[]
  lv: number[]
  /** Curves for RGB, red, green and blue: points as [x0, y0, x1, y1, …] from 0 to 255, sorted by x. */
  curves: number[][]
  gmap: GradientMap
}

export interface GradStop { p: number; c: string }
/** Gradient map: each pixel's brightness picks a colour from the gradient, mixed in by amount (0 to 100). */
export interface GradientMap { on: boolean; stops: GradStop[]; amount: number; reverse: boolean }

export const CURVE_CH = ['rgb', 'r', 'g', 'b'] as const
export type CurveChannel = typeof CURVE_CH[number]
export const CURVE0 = [0, 0, 255, 255]
export const curveIdentity = (pts: number[]) => pts.length === 4 && pts[0] === 0 && pts[1] === 0 && pts[2] === 255 && pts[3] === 255
const freshCurves = () => CURVE_CH.map(() => [...CURVE0])
export const GMAP0: GradientMap = { on: false, stops: [{ p: 0, c: '#000000' }, { p: 1, c: '#ffffff' }], amount: 100, reverse: false }
const cloneGmap = (g: any): GradientMap => {
  if (!g || !Array.isArray(g.stops) || g.stops.length < 2) return { ...GMAP0, stops: GMAP0.stops.map(s => ({ ...s })) }
  return { on: !!g.on, amount: typeof g.amount === 'number' ? g.amount : 100, reverse: !!g.reverse, stops: g.stops.map((s: GradStop) => ({ p: Math.min(1, Math.max(0, +s.p || 0)), c: String(s.c || '#000000') })) }
}
const cloneCurves = (c: any): number[][] => Array.isArray(c) && c.length === 4 && c.every(p => Array.isArray(p) && p.length >= 4 && p.length % 2 === 0) ? c.map((p: number[]) => [...p]) : freshCurves()

export const LV_CH = ['rgb', 'r', 'g', 'b', 'a'] as const
export type LvChannel = typeof LV_CH[number]
export const LV1 = [0, 255, 1, 0, 255]
export const LV0 = [...LV1, ...LV1, ...LV1, ...LV1, ...LV1]

export const ADJUST0: Adjust = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, gamma: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, hue: 0, sharpness: 0, clarity: 0,
  grayscale: false, sepia: false, invert: false, levels: [0, 255, 0, 255, 0, 255], lv: LV0,
  curves: freshCurves(), gmap: GMAP0
}

/** A deep copy, filling in anything missing from projects saved by older versions. */
export const cloneAdjust = (a: Adjust): Adjust => ({ ...a, levels: [...a.levels], lv: a.lv && a.lv.length === LV0.length ? [...a.lv] : [...LV0], curves: cloneCurves(a.curves), gmap: cloneGmap(a.gmap) })
export const freshAdjust = () => cloneAdjust(ADJUST0)

export type ShapeType = 'text' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'callout' | 'label' | 'marker'
export interface Shape {
  type: ShapeType
  x1: number; y1: number; x2: number; y2: number
  stroke: string; fill: string; fillOn: boolean; width: number; dash: boolean; radius: number
  text: string; font: string; size: number; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right'
  color: string; shadow: boolean; outline: number; outlineColor: string; num: number
  /** Rotation in degrees about the shape's centre (text, labels, rectangles, ellipses, callouts). */
  rot?: number
}

export interface OutlineOpts {
  source: string
  width: number; color: string; style: 'solid' | 'dashed'; position: 'outside' | 'inside' | 'center'
  glow: number; round: boolean
}

export interface FxShadow { on: boolean; color: string; opacity: number; angle: number; distance: number; size: number }
export interface FxGlow { on: boolean; color: string; opacity: number; size: number }
export interface FxStroke { on: boolean; color: string; opacity: number; size: number; position: 'outside' | 'inside' | 'center' }
export interface FxOverlay { on: boolean; color: string; opacity: number }
/** Layer effects, drawn around and over the layer's pixels without changing them. */
export interface Effects { shadow: FxShadow; glow: FxGlow; stroke: FxStroke; inner: FxShadow; overlay: FxOverlay }

export const freshFx = (): Effects => ({
  shadow: { on: false, color: '#000000', opacity: 0.6, angle: 120, distance: 8, size: 12 },
  glow: { on: false, color: '#fff3a8', opacity: 0.8, size: 16 },
  stroke: { on: false, color: '#ffffff', opacity: 1, size: 4, position: 'outside' },
  inner: { on: false, color: '#000000', opacity: 0.5, angle: 120, distance: 4, size: 8 },
  overlay: { on: false, color: '#e25b45', opacity: 1 }
})
export const cloneFx = (f: Effects | null): Effects | null => f && {
  shadow: { ...f.shadow }, glow: { ...f.glow }, stroke: { ...f.stroke }, inner: { ...f.inner }, overlay: { ...f.overlay }
}
export const fxActive = (f: Effects | null | undefined) => !!f && (f.shadow.on || f.glow.on || f.stroke.on || f.inner.on || f.overlay.on)
/** Fills in effects missing from projects saved by older versions. */
export const normFx = (f: any): Effects | null => {
  if (!f) return null
  const d = freshFx()
  return { shadow: { ...d.shadow, ...f.shadow }, glow: { ...d.glow, ...f.glow }, stroke: { ...d.stroke, ...f.stroke }, inner: { ...d.inner, ...f.inner }, overlay: { ...d.overlay, ...f.overlay } }
}

export interface BgOpts { mode: 'none' | 'color' | 'image' | 'blur'; color: string; blur: number; image?: HTMLCanvasElement }

export interface Layer {
  id: string
  name: string
  kind: LayerKind
  visible: boolean
  locked: boolean
  opacity: number
  blend: Blend
  alphaLock: boolean
  clip: boolean
  canvas: HTMLCanvasElement | null
  mask: HTMLCanvasElement | null
  /** The mask is kept but not used (Disable mask). */
  maskOff?: boolean
  maskAI: HTMLCanvasElement | null
  maskOpts: MaskOpts
  shape: Shape | null
  outline: OutlineOpts | null
  adjust: Adjust | null
  bg: BgOpts | null
  bgFor: string | null
  /** Folder this layer belongs to, or null at the top level. */
  parent: string | null
  /** Folders only: children hidden in the layers panel. */
  collapsed: boolean
  fx: Effects | null
  fxCache: HTMLCanvasElement | null
  fxKey: string
  /** While a layer is dragged: its effects image moved along with it, shown instead of re-rendering every frame. */
  fxHold?: HTMLCanvasElement | null
  dirty: Rect | true | null
  maskDirty: Rect | true | null
  cache: HTMLCanvasElement | null
  maskCache: HTMLCanvasElement | null
}

export function makeLayer(kind: LayerKind, name: string, w: number, h: number, raster = true): Layer {
  return {
    id: uid(), name, kind, visible: true, locked: false, opacity: 1, blend: 'source-over',
    alphaLock: false, clip: false, canvas: raster ? canvas(w, h) : null, mask: null, maskAI: null,
    maskOpts: { feather: 0, smooth: 0, shift: 0 }, shape: null, outline: null, adjust: null, bg: null, bgFor: null,
    parent: null, collapsed: false, fx: null, fxCache: null, fxKey: '',
    dirty: true, maskDirty: null, cache: null, maskCache: null
  }
}

export const isRaster = (l: Layer) => !!l.canvas && l.kind !== 'text' && l.kind !== 'shape' && l.kind !== 'outline'
export const isGroup = (l: Layer | null | undefined) => l?.kind === 'group'

export class Doc extends Emitter {
  w: number
  h: number
  name: string
  path: string | null = null
  projectPath: string | null = null
  layers: Layer[] = []
  activeId = ''
  selection: HTMLCanvasElement | null = null
  original: HTMLCanvasElement
  comp: HTMLCanvasElement
  modified = false
  /** Names this image's crash-recovery copy. */
  rid = uid()
  /** Layers picked together in the Layers panel (Ctrl- or Shift-click), besides the active one. Not saved. */
  picked = new Set<string>()
  /** Guide lines: vertical ones at x positions, horizontal ones at y positions, in image pixels. */
  guides: { x: number[]; y: number[] } = { x: [], y: [] }

  constructor(img: CanvasImageSource & { width: number; height: number }, name: string) {
    super()
    this.w = img.width
    this.h = img.height
    this.name = name
    const base = makeLayer('image', tr('Image'), this.w, this.h)
    ctx2d(base.canvas!).drawImage(img, 0, 0)
    this.layers.push(base)
    this.activeId = base.id
    this.original = copyCanvas(base.canvas!)
    this.comp = canvas(this.w, this.h)
  }

  get active(): Layer | undefined { return this.layers.find(l => l.id === this.activeId) }
  layer(id: string) { return this.layers.find(l => l.id === id) }
  index(id: string) { return this.layers.findIndex(l => l.id === id) }

  /** Counts edits, so work derived from the pixels (histograms, AI analysis) knows when to redo itself. */
  rev = 0
  changed(rect?: Rect | null) {
    this.modified = true
    this.rev++
    // Effects reach beyond what changed (a shadow follows its layer), so redraw everything.
    if (rect && this.layers.some(l => l.visible && fxActive(l.fx))) rect = null
    this.emit('change', rect || null)
  }
  structure() { normalizeTree(this); this.modified = true; this.rev++; this.emit('layers'); this.emit('change', null) }

  /** Adds l above the layer `above`, in the same folder. Above an open folder, l goes to the top of that folder. */
  add(l: Layer, above?: string) {
    const ref = above ? this.layer(above) : undefined
    if (!ref) { l.parent = null; this.layers.push(l) }
    else if (ref.kind === 'group' && !ref.collapsed && l.kind !== 'background') { l.parent = ref.id; this.layers.splice(this.index(ref.id), 0, l) }
    else { l.parent = ref.parent; this.layers.splice(this.index(ref.id) + 1, 0, l) }
    this.activeId = l.id
  }
}

/** Layers whose folder is `parent` (null for the top level), bottom to top. */
export function childrenOf(doc: Doc, parent: string | null) { return doc.layers.filter(l => l.parent === parent) }

export function ancestors(doc: Doc, l: Layer): Layer[] {
  const out: Layer[] = []
  let p = l.parent ? doc.layer(l.parent) : undefined
  while (p && out.length < 64) { out.push(p); p = p.parent ? doc.layer(p.parent) : undefined }
  return out
}
export const isInside = (doc: Doc, l: Layer, folder: Layer) => ancestors(doc, l).includes(folder)
export const shownVisible = (doc: Doc, l: Layer) => l.visible && ancestors(doc, l).every(a => a.visible)
export const shownLocked = (doc: Doc, l: Layer) => l.locked || ancestors(doc, l).some(a => a.locked)
export const depthOf = (doc: Doc, l: Layer) => ancestors(doc, l).length

/** A layer with everything inside it (for folders), bottom to top, as it sits in doc.layers. */
export function subtree(doc: Doc, l: Layer): Layer[] {
  if (l.kind !== 'group') return [l]
  return [...doc.layers.filter(x => x !== l && isInside(doc, x, l)), l]
}

/**
 * Keeps doc.layers in folder order: every folder sits directly above its contents, so a folder and
 * everything in it is one unbroken run. Relative order inside each folder is kept. Broken parent
 * links (a deleted folder, a non-folder parent) fall back to the top level.
 */
export function normalizeTree(doc: Doc) {
  const ids = new Map(doc.layers.map(l => [l.id, l]))
  for (const l of doc.layers) {
    const p = l.parent ? ids.get(l.parent) : undefined
    if (l.parent && (!p || p.kind !== 'group' || p === l)) l.parent = null
  }
  for (const l of doc.layers) if (l.parent) { const seen = new Set<string>(); let p: Layer | undefined = l; while (p?.parent) { if (seen.has(p.id)) { l.parent = null; break } seen.add(p.id); p = ids.get(p.parent) } }
  const out: Layer[] = []
  const emit = (parent: string | null) => { for (const l of doc.layers) if (l.parent === parent) { if (l.kind === 'group') emit(l.id); out.push(l) } }
  emit(null)
  if (out.length === doc.layers.length && out.every((l, i) => l === doc.layers[i])) return
  doc.layers = out
}

/**
 * Moves a layer (and its contents, for a folder) next to ref: 'above' or 'below' it in ref's folder,
 * or 'into' ref when ref is a folder (to the top of it). Returns false for a move into itself.
 */
export function moveLayer(doc: Doc, id: string, refId: string | null, where: 'above' | 'below' | 'into'): boolean {
  const l = doc.layer(id)
  const ref = refId ? doc.layer(refId) : null
  if (!l || ref === l) return false
  if (ref && (isInside(doc, ref, l))) return false
  if (where === 'into' && ref?.kind !== 'group') where = 'above'
  const block = subtree(doc, l)
  const rest = doc.layers.filter(x => !block.includes(x))
  let at: number
  if (!ref) { at = rest.length; l.parent = null }
  else if (where === 'into') { at = rest.indexOf(ref); l.parent = ref.id }
  else if (where === 'above') { at = rest.indexOf(ref) + 1; l.parent = ref.parent }
  else { at = rest.indexOf(subtree(doc, ref)[0]); l.parent = ref.parent }
  rest.splice(at, 0, ...block)
  doc.layers = rest
  return true
}

export function snapshot(doc: Doc) {
  return {
    w: doc.w, h: doc.h, active: doc.activeId, selection: doc.selection, original: doc.original,
    guides: doc.guides ? { x: [...doc.guides.x], y: [...doc.guides.y] } : null,
    layers: doc.layers.map(l => ({
      ref: l,
      p: {
        name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend, alphaLock: l.alphaLock,
        clip: l.clip, canvas: l.canvas, mask: l.mask, maskOff: !!l.maskOff, maskAI: l.maskAI, maskOpts: { ...l.maskOpts },
        shape: l.shape && { ...l.shape }, outline: l.outline && { ...l.outline },
        adjust: l.adjust && cloneAdjust(l.adjust), bg: l.bg && { ...l.bg }, bgFor: l.bgFor,
        parent: l.parent, collapsed: l.collapsed, fx: cloneFx(l.fx)
      }
    }))
  }
}
export type Snap = ReturnType<typeof snapshot>

export function restore(doc: Doc, s: Snap) {
  doc.w = s.w; doc.h = s.h
  if (doc.comp.width !== s.w || doc.comp.height !== s.h) doc.comp = canvas(s.w, s.h)
  doc.selection = s.selection
  doc.original = s.original
  if (s.guides) doc.guides = { x: [...s.guides.x], y: [...s.guides.y] }
  doc.layers = s.layers.map(({ ref, p }) => {
    Object.assign(ref, p, { maskOpts: { ...p.maskOpts }, shape: p.shape && { ...p.shape }, outline: p.outline && { ...p.outline }, adjust: p.adjust && cloneAdjust(p.adjust), bg: p.bg && { ...p.bg }, fx: cloneFx(p.fx) })
    ref.fxKey = ''; ref.dirty = true; ref.maskDirty = true; ref.cache = null; ref.maskCache = null
    return ref
  })
  doc.activeId = doc.layer(s.active) ? s.active : doc.layers[doc.layers.length - 1]?.id
}
