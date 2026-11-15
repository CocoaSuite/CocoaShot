import { canvas, copyCanvas, ctx2d, Emitter, Rect, uid } from './util'

export type LayerKind = 'image' | 'paint' | 'text' | 'shape' | 'highlight' | 'outline' | 'adjust' | 'background'
export type Blend = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'soft-light' | 'hard-light' | 'difference' | 'color' | 'luminosity'

export interface MaskOpts { feather: number; smooth: number; shift: number }

export interface Adjust {
  exposure: number; brightness: number; contrast: number; highlights: number; shadows: number
  whites: number; blacks: number; gamma: number; temperature: number; tint: number
  saturation: number; vibrance: number; hue: number; sharpness: number; clarity: number
  grayscale: boolean; sepia: boolean; invert: boolean
  levels: number[]
  lv: number[]
}

export const LV_CH = ['rgb', 'r', 'g', 'b', 'a'] as const
export type LvChannel = typeof LV_CH[number]
export const LV1 = [0, 255, 1, 0, 255]
export const LV0 = [...LV1, ...LV1, ...LV1, ...LV1, ...LV1]

export const ADJUST0: Adjust = {
  exposure: 0, brightness: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, gamma: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, hue: 0, sharpness: 0, clarity: 0,
  grayscale: false, sepia: false, invert: false, levels: [0, 255, 0, 255, 0, 255], lv: LV0
}

export const cloneAdjust = (a: Adjust): Adjust => ({ ...a, levels: [...a.levels], lv: a.lv && a.lv.length === LV0.length ? [...a.lv] : [...LV0] })
export const freshAdjust = () => cloneAdjust(ADJUST0)

export type ShapeType = 'text' | 'arrow' | 'line' | 'rect' | 'ellipse' | 'callout' | 'label' | 'marker'
export interface Shape {
  type: ShapeType
  x1: number; y1: number; x2: number; y2: number
  stroke: string; fill: string; fillOn: boolean; width: number; dash: boolean; radius: number
  text: string; font: string; size: number; bold: boolean; italic: boolean; align: 'left' | 'center' | 'right'
  color: string; shadow: boolean; outline: number; outlineColor: string; num: number
}

export interface OutlineOpts {
  source: string
  width: number; color: string; style: 'solid' | 'dashed'; position: 'outside' | 'inside' | 'center'
  glow: number; round: boolean
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
  maskAI: HTMLCanvasElement | null
  maskOpts: MaskOpts
  shape: Shape | null
  outline: OutlineOpts | null
  adjust: Adjust | null
  bg: BgOpts | null
  bgFor: string | null
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
    dirty: true, maskDirty: null, cache: null, maskCache: null
  }
}

export const isRaster = (l: Layer) => !!l.canvas && l.kind !== 'text' && l.kind !== 'shape' && l.kind !== 'outline'

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

  constructor(img: CanvasImageSource & { width: number; height: number }, name: string) {
    super()
    this.w = img.width
    this.h = img.height
    this.name = name
    const base = makeLayer('image', 'Image', this.w, this.h)
    ctx2d(base.canvas!).drawImage(img, 0, 0)
    this.layers.push(base)
    this.activeId = base.id
    this.original = copyCanvas(base.canvas!)
    this.comp = canvas(this.w, this.h)
  }

  get active(): Layer | undefined { return this.layers.find(l => l.id === this.activeId) }
  layer(id: string) { return this.layers.find(l => l.id === id) }
  index(id: string) { return this.layers.findIndex(l => l.id === id) }

  changed(rect?: Rect | null) { this.modified = true; this.emit('change', rect || null) }
  structure() { this.modified = true; this.emit('layers'); this.emit('change', null) }

  add(l: Layer, above?: string) {
    const i = above ? this.index(above) : this.layers.length - 1
    this.layers.splice(i + 1, 0, l)
    this.activeId = l.id
  }
}

export function snapshot(doc: Doc) {
  return {
    w: doc.w, h: doc.h, active: doc.activeId, selection: doc.selection,
    layers: doc.layers.map(l => ({
      ref: l,
      p: {
        name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity, blend: l.blend, alphaLock: l.alphaLock,
        clip: l.clip, canvas: l.canvas, mask: l.mask, maskAI: l.maskAI, maskOpts: { ...l.maskOpts },
        shape: l.shape && { ...l.shape }, outline: l.outline && { ...l.outline },
        adjust: l.adjust && cloneAdjust(l.adjust), bg: l.bg && { ...l.bg }, bgFor: l.bgFor
      }
    }))
  }
}
export type Snap = ReturnType<typeof snapshot>

export function restore(doc: Doc, s: Snap) {
  doc.w = s.w; doc.h = s.h
  if (doc.comp.width !== s.w || doc.comp.height !== s.h) doc.comp = canvas(s.w, s.h)
  doc.selection = s.selection
  doc.layers = s.layers.map(({ ref, p }) => {
    Object.assign(ref, p, { maskOpts: { ...p.maskOpts }, shape: p.shape && { ...p.shape }, outline: p.outline && { ...p.outline }, adjust: p.adjust && cloneAdjust(p.adjust), bg: p.bg && { ...p.bg } })
    ref.dirty = true; ref.maskDirty = true; ref.cache = null; ref.maskCache = null
    return ref
  })
  doc.activeId = doc.layer(s.active) ? s.active : doc.layers[doc.layers.length - 1]?.id
}
