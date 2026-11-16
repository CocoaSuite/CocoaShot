import { strFromU8, strToU8, unzipSync, zipSync, zlibSync, unzlibSync } from 'fflate'
import UTIF from 'utif'
import { readPsd } from 'ag-psd'
import { Blend, cloneAdjust, Doc, Layer, makeLayer, normalizeTree, normFx } from './doc'
import { blendFromPsd, decodeHeic, decodeSvg, decodeTga, encodeAvif, encodeIco, encodePdf, encodePsd } from './formats'
import { canvas, ctx2d, getData, putData, mkID } from './util'

export const IMAGE_EXT = /\.(png|jpe?g|jfif|webp|avif|heic|heif|bmp|tiff?|gif|psd|svg|ico|cur|tga)$/i

/** A layer read from a PSD file. Folders have no canvas; parent is the index of the folder in the same list. */
export interface ImportedLayer { name: string; canvas: HTMLCanvasElement | null; opacity: number; visible: boolean; blend: Blend; folder: boolean; open: boolean; parent: number | null; clip: boolean }

export async function decodeImage(name: string, data: ArrayBuffer): Promise<{ canvas: HTMLCanvasElement; layers?: ImportedLayer[] }> {
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (ext === 'heic' || ext === 'heif') return { canvas: await decodeHeic(data) }
  if (ext === 'svg') return { canvas: await decodeSvg(data) }
  if (ext === 'tga') return { canvas: decodeTga(data) }
  if (ext === 'tif' || ext === 'tiff') {
    const ifds = UTIF.decode(data)
    if (!ifds.length) throw new Error('This TIFF file has no images')
    UTIF.decodeImage(data, ifds[0])
    const rgba = UTIF.toRGBA8(ifds[0])
    const w = ifds[0].width, h = ifds[0].height
    const c = canvas(w, h)
    putData(c, mkID(rgba, w, h))
    return { canvas: c }
  }
  if (ext === 'psd') {
    const psd = readPsd(data, { skipThumbnail: true })
    const c = canvas(psd.width, psd.height)
    if (psd.canvas) ctx2d(c).drawImage(psd.canvas as any, 0, 0)
    const layers: ImportedLayer[] = []
    // ag-psd lists layers bottom to top. Parent links are enough: the document puts each folder above its contents.
    const walk = (ch: any[] | undefined, parent: number | null) => {
      for (const l of ch || []) {
        const common = { name: l.name || 'Layer', opacity: l.opacity ?? 1, visible: !l.hidden, blend: blendFromPsd(l.blendMode), clip: !!l.clipping, parent }
        if (l.children) {
          const at = layers.length
          layers.push({ ...common, canvas: null, folder: true, open: !!l.opened })
          walk(l.children, at)
          continue
        }
        if (!l.canvas) continue
        const lc = canvas(psd.width, psd.height)
        ctx2d(lc).drawImage(l.canvas, l.left || 0, l.top || 0)
        layers.push({ ...common, canvas: lc, folder: false, open: false })
      }
    }
    walk(psd.children, null)
    return { canvas: c, layers: layers.some(l => !l.folder) ? layers : undefined }
  }
  const bmp = await createImageBitmap(new Blob([data]), { colorSpaceConversion: 'default', premultiplyAlpha: 'none' } as any)
  const c = canvas(bmp.width, bmp.height)
  ctx2d(c).drawImage(bmp, 0, 0)
  bmp.close()
  return { canvas: c }
}

export type ExportFormat = 'png' | 'jpg' | 'webp' | 'avif' | 'tiff' | 'bmp' | 'psd' | 'pdf' | 'ico'
export const FORMATS: [ExportFormat, string][] = [['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WEBP'], ['avif', 'AVIF'], ['tiff', 'TIFF'], ['bmp', 'BMP'], ['psd', 'PSD (layers)'], ['pdf', 'PDF'], ['ico', 'ICO (icon)']]
export const EXT: Record<ExportFormat, string> = { png: 'png', jpg: 'jpg', webp: 'webp', avif: 'avif', tiff: 'tif', bmp: 'bmp', psd: 'psd', pdf: 'pdf', ico: 'ico' }
export interface ExportOpts { format: ExportFormat; quality: number; w: number; h: number; transparent: boolean; matte: string; srgb: boolean; maxCompress: boolean }

const blob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('Encoding failed'))), type, q))

/** Encodes an export. PSD needs the document (it keeps layers); everything else uses the flattened image c. */
export async function encode(c: HTMLCanvasElement, o: ExportOpts, doc?: Doc): Promise<Uint8Array> {
  if (o.format === 'psd') { if (!doc) throw new Error('Nothing to export'); return encodePsd(doc, o.w, o.h) }
  if (o.format === 'pdf') return encodePdf(c, o.quality, o.transparent)
  let src = c
  const flat = !o.transparent || o.format === 'jpg'
  if (flat) {
    src = canvas(c.width, c.height)
    const x = ctx2d(src)
    x.fillStyle = o.matte
    x.fillRect(0, 0, c.width, c.height)
    x.drawImage(c, 0, 0)
  }
  if (o.format === 'png') {
    let b: Uint8Array = new Uint8Array(await (await blob(src, 'image/png')).arrayBuffer())
    if (o.maxCompress) b = recompressPng(b)
    if (o.srgb) b = pngWithSrgb(b)
    return b
  }
  if (o.format === 'jpg') return new Uint8Array(await (await blob(src, 'image/jpeg', o.quality / 100)).arrayBuffer())
  if (o.format === 'webp') return new Uint8Array(await (await blob(src, 'image/webp', o.quality / 100)).arrayBuffer())
  if (o.format === 'avif') return encodeAvif(src, o.quality)
  if (o.format === 'ico') return encodeIco(src)
  const d = getData(src)
  if (o.format === 'tiff') return new Uint8Array(UTIF.encodeImage(d.data.buffer, d.width, d.height))
  return encodeBmp(d)
}

export function encodeBmp(d: ImageData): Uint8Array {
  const w = d.width, h = d.height, row = w * 4, size = 122 + row * h
  const b = new ArrayBuffer(size), v = new DataView(b)
  v.setUint16(0, 0x4d42, true); v.setUint32(2, size, true); v.setUint32(10, 122, true)
  v.setUint32(14, 108, true); v.setInt32(18, w, true); v.setInt32(22, -h, true)
  v.setUint16(26, 1, true); v.setUint16(28, 32, true); v.setUint32(30, 3, true); v.setUint32(34, row * h, true)
  v.setUint32(38, 2835, true); v.setUint32(42, 2835, true)
  v.setUint32(54, 0x00ff0000, true); v.setUint32(58, 0x0000ff00, true); v.setUint32(62, 0x000000ff, true); v.setUint32(66, 0xff000000, true)
  v.setUint32(70, 0x73524742, true)
  const p = new Uint8Array(b, 122)
  for (let i = 0; i < w * h; i++) { p[i * 4] = d.data[i * 4 + 2]; p[i * 4 + 1] = d.data[i * 4 + 1]; p[i * 4 + 2] = d.data[i * 4]; p[i * 4 + 3] = d.data[i * 4 + 3] }
  return new Uint8Array(b)
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
function crc(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }

function chunks(png: Uint8Array) {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const out: { type: string; data: Uint8Array }[] = []
  let o = 8
  while (o < png.length) {
    const len = v.getUint32(o)
    const type = String.fromCharCode(...png.subarray(o + 4, o + 8))
    out.push({ type, data: png.subarray(o + 8, o + 8 + len) })
    o += 12 + len
  }
  return out
}

function build(cs: { type: string; data: Uint8Array }[]) {
  const size = 8 + cs.reduce((s, c) => s + 12 + c.data.length, 0)
  const out = new Uint8Array(size)
  out.set([137, 80, 78, 71, 13, 10, 26, 10])
  const v = new DataView(out.buffer)
  let o = 8
  for (const c of cs) {
    v.setUint32(o, c.data.length)
    const td = new Uint8Array(4 + c.data.length)
    for (let i = 0; i < 4; i++) td[i] = c.type.charCodeAt(i)
    td.set(c.data, 4)
    out.set(td, o + 4)
    v.setUint32(o + 8 + c.data.length, crc(td))
    o += 12 + c.data.length
  }
  return out
}

export function recompressPng(png: Uint8Array): Uint8Array {
  const cs = chunks(png)
  const idat = cs.filter(c => c.type === 'IDAT')
  const all = new Uint8Array(idat.reduce((s, c) => s + c.data.length, 0))
  let o = 0
  for (const c of idat) { all.set(c.data, o); o += c.data.length }
  const zl = zlibSync(unzlibSync(all), { level: 9, mem: 12 })
  if (zl.length >= all.length) return png
  const rest = cs.filter(c => c.type !== 'IDAT')
  const iend = rest.findIndex(c => c.type === 'IEND')
  rest.splice(iend, 0, { type: 'IDAT', data: zl })
  return build(rest)
}

export function pngWithSrgb(png: Uint8Array): Uint8Array {
  const cs = chunks(png).filter(c => c.type !== 'sRGB' && c.type !== 'iCCP')
  cs.splice(1, 0, { type: 'sRGB', data: new Uint8Array([0]) })
  return build(cs)
}

async function png(c: HTMLCanvasElement) { return new Uint8Array(await (await blob(c, 'image/png')).arrayBuffer()) }
async function fromPng(b: Uint8Array) { const bm = await createImageBitmap(new Blob([b as any]), { premultiplyAlpha: 'none' } as any); const c = canvas(bm.width, bm.height); ctx2d(c).drawImage(bm, 0, 0); bm.close(); return c }

const LAYER_KEYS = ['id', 'name', 'kind', 'visible', 'locked', 'opacity', 'blend', 'alphaLock', 'clip', 'maskOpts', 'shape', 'outline', 'adjust', 'bgFor', 'parent', 'collapsed', 'fx'] as const

export async function saveProject(doc: Doc): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {}
  const layers: any[] = []
  for (const l of doc.layers) {
    const o: any = {}
    for (const k of LAYER_KEYS) o[k] = (l as any)[k]
    if (l.bg) { o.bg = { ...l.bg, image: undefined }; if (l.bg.image) { files[`bg/${l.id}.png`] = await png(l.bg.image); o.bg.image = true } }
    if (l.canvas && (l.kind === 'image' || l.kind === 'paint' || l.kind === 'highlight')) files[`layers/${l.id}.png`] = await png(l.canvas)
    if (l.mask) files[`masks/${l.id}.png`] = await png(l.mask)
    if (l.maskAI) files[`masksai/${l.id}.png`] = await png(l.maskAI)
    layers.push(o)
  }
  files['original.png'] = await png(doc.original)
  if (doc.selection) files['selection.png'] = await png(doc.selection)
  files['project.json'] = strToU8(JSON.stringify({ app: 'CocoaShot', version: 1, w: doc.w, h: doc.h, name: doc.name, active: doc.activeId, layers }))
  return zipSync(files, { level: 1 })
}

export async function loadProject(data: ArrayBuffer, fileName: string): Promise<Doc> {
  const z = unzipSync(new Uint8Array(data))
  if (!z['project.json']) throw new Error('This is not a CocoaShot project')
  const p = JSON.parse(strFromU8(z['project.json']))
  const orig = await fromPng(z['original.png'])
  const doc = new Doc(orig, p.name || fileName.replace(/\.cocoashot$/i, ''))
  doc.w = p.w; doc.h = p.h
  doc.comp = canvas(p.w, p.h)
  doc.layers = []
  for (const o of p.layers) {
    const l: Layer = makeLayer(o.kind, o.name, p.w, p.h, o.kind !== 'adjust' && o.kind !== 'group')
    for (const k of LAYER_KEYS) if (o[k] !== undefined) (l as any)[k] = o[k]
    if (l.adjust) l.adjust = cloneAdjust(l.adjust)
    l.fx = normFx(o.fx)
    l.parent = o.parent || null
    l.collapsed = !!o.collapsed
    if (z[`layers/${o.id}.png`]) l.canvas = await fromPng(z[`layers/${o.id}.png`])
    if (z[`masks/${o.id}.png`]) l.mask = await fromPng(z[`masks/${o.id}.png`])
    if (z[`masksai/${o.id}.png`]) l.maskAI = await fromPng(z[`masksai/${o.id}.png`])
    if (o.bg) l.bg = { ...o.bg, image: z[`bg/${o.id}.png`] ? await fromPng(z[`bg/${o.id}.png`]) : undefined }
    l.dirty = true; l.maskDirty = true
    doc.layers.push(l)
  }
  normalizeTree(doc)
  if (z['selection.png']) doc.selection = await fromPng(z['selection.png'])
  doc.activeId = doc.layer(p.active) ? p.active : doc.layers[doc.layers.length - 1].id
  doc.modified = false
  return doc
}
