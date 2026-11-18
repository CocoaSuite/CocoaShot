import { zlibSync } from 'fflate'
import { writePsd, type Layer as PsdLayer, type BlendMode } from 'ag-psd'
import type { Blend, Doc, Layer } from './doc'
import { childrenOf } from './doc'
import { flatten, layerWithFx } from './compose'
import { alphaOf, bboxOfAlpha, canvas, ctx2d, getData, mkID, putData } from './util'
import { tr } from '../i18n'

// ---------- Opening ----------

/** Truevision TGA: uncompressed and RLE, colour-mapped, true-colour and greyscale. */
export function decodeTga(buf: ArrayBuffer): HTMLCanvasElement {
  const b = new Uint8Array(buf)
  const v = new DataView(buf)
  if (b.length < 18) throw new Error(tr('This TGA file is damaged'))
  const idLen = b[0], cmType = b[1], type = b[2]
  const cmFirst = v.getUint16(3, true), cmLen = v.getUint16(5, true), cmBits = b[7]
  const w = v.getUint16(12, true), h = v.getUint16(14, true), bpp = b[16], desc = b[17]
  if (!w || !h) throw new Error(tr('This TGA file has no image'))
  const rle = type >= 9
  const base = type & 7
  if (![1, 2, 3].includes(base)) throw new Error(tr('This kind of TGA file is not supported'))
  let o = 18 + idLen
  const cmBytes = Math.ceil(cmBits / 8)
  const palette: number[][] = []
  if (cmType === 1) {
    for (let i = 0; i < cmLen; i++) { palette.push(readPx(b, o, cmBits, 2)); o += cmBytes }
  }
  const px = Math.ceil(bpp / 8)
  const n = w * h
  const out = new Uint8ClampedArray(n * 4)
  const put = (i: number, p: number[]) => { out[i * 4] = p[0]; out[i * 4 + 1] = p[1]; out[i * 4 + 2] = p[2]; out[i * 4 + 3] = p[3] }
  const read = () => {
    if (o + px > b.length) throw new Error(tr('This TGA file is damaged'))
    const p = base === 1 ? palette[(px === 2 ? v.getUint16(o, true) : b[o]) - cmFirst] || [0, 0, 0, 255] : readPx(b, o, bpp, base)
    o += px
    return p
  }
  let i = 0
  while (i < n) {
    if (!rle) { put(i++, read()); continue }
    const c = b[o++]
    const count = (c & 127) + 1
    if (c & 128) { const p = read(); for (let k = 0; k < count && i < n; k++) put(i++, p) }
    else for (let k = 0; k < count && i < n; k++) put(i++, read())
  }
  // Alpha is only real when the header says the image has alpha bits.
  const alphaBits = desc & 15
  if (!alphaBits && (bpp === 32 || (base === 1 && cmBits === 32))) for (let k = 0; k < n; k++) out[k * 4 + 3] = 255
  const flipY = !(desc & 32), flipX = !!(desc & 16)
  const img = new Uint8ClampedArray(n * 4)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sy = flipY ? h - 1 - y : y, sx = flipX ? w - 1 - x : x
    const s = (sy * w + sx) * 4, d = (y * w + x) * 4
    img[d] = out[s]; img[d + 1] = out[s + 1]; img[d + 2] = out[s + 2]; img[d + 3] = out[s + 3]
  }
  const c = canvas(w, h)
  putData(c, mkID(img, w, h))
  return c
}

function readPx(b: Uint8Array, o: number, bits: number, base: number): number[] {
  if (base === 3) { const g = b[o]; return [g, g, g, bits === 16 ? b[o + 1] : 255] }
  if (bits === 15 || bits === 16) {
    const v = b[o] | (b[o + 1] << 8)
    const r = (v >> 10) & 31, g = (v >> 5) & 31, bl = v & 31
    return [(r << 3) | (r >> 2), (g << 3) | (g >> 2), (bl << 3) | (bl >> 2), 255]
  }
  return [b[o + 2], b[o + 1], b[o], bits === 32 ? b[o + 3] : 255]
}

/** HEIC and HEIF (iPhone photos). The decoder (about 2 MB) loads the first time it's needed. */
export async function decodeHeic(buf: ArrayBuffer): Promise<HTMLCanvasElement> {
  const mod: any = await import('libheif-js/libheif-wasm/libheif-bundle.mjs')
  let lib = mod.default
  if (typeof lib === 'function') lib = await lib()
  const decoder = new lib.HeifDecoder()
  const images = decoder.decode(new Uint8Array(buf))
  if (!images?.length) throw new Error(tr('This HEIC file has no images'))
  const img = images[0]
  const w = img.get_width(), h = img.get_height()
  const data = new ImageData(w, h)
  await new Promise<void>((res, rej) => img.display(data, (d: any) => (d ? res() : rej(new Error(tr('Could not decode this HEIC image'))))))
  for (const i of images) i.free?.()
  const c = canvas(w, h)
  putData(c, data)
  return c
}

/** SVG drawings are drawn at a size that's comfortable to edit: at least 2048 px on the long side. */
export async function decodeSvg(buf: ArrayBuffer): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(new Blob([buf], { type: 'image/svg+xml' }))
  try {
    const im = new Image()
    im.decoding = 'sync'
    await new Promise<void>((res, rej) => { im.onload = () => res(); im.onerror = () => rej(new Error(tr('This SVG file could not be drawn'))); im.src = url })
    let w = im.naturalWidth, h = im.naturalHeight
    if (!w || !h) {
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(new TextDecoder().decode(buf))
      w = vb ? +vb[1] : 1024; h = vb ? +vb[2] : 1024
    }
    const s = Math.max(1, 2048 / Math.max(w, h))
    const W = Math.min(16384, Math.round(w * s)), H = Math.min(16384, Math.round(h * s))
    const c = canvas(W, H)
    ctx2d(c).drawImage(im, 0, 0, W, H)
    return c
  } finally { URL.revokeObjectURL(url) }
}

// ---------- Saving ----------

const BLEND_TO_PSD: Record<Blend, BlendMode> = {
  'source-over': 'normal', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten',
  'color-dodge': 'color dodge', 'color-burn': 'color burn', 'soft-light': 'soft light', 'hard-light': 'hard light',
  difference: 'difference', color: 'color', luminosity: 'luminosity'
}
export const blendFromPsd = (m: string | undefined): Blend => (Object.entries(BLEND_TO_PSD).find(([, v]) => v === m)?.[0] as Blend) || 'source-over'

/**
 * Photoshop file with layers and folders. Masks and effects are applied to each layer's pixels;
 * text and shapes become pixel layers. Adjustment layers show in the merged image only.
 */
export function encodePsd(doc: Doc, w: number, h: number): Uint8Array {
  const sx = w / doc.w, sy = h / doc.h
  const sized = (src: HTMLCanvasElement) => {
    if (sx === 1 && sy === 1) return src
    const c = canvas(w, h), x = ctx2d(c)
    x.imageSmoothingQuality = 'high'
    x.drawImage(src, 0, 0, w, h)
    return c
  }
  const cropped = (src: HTMLCanvasElement) => {
    const bb = bboxOfAlpha(alphaOf(src), src.width, src.height)
    if (!bb) return { canvas: undefined, left: 0, top: 0 }
    const c = canvas(bb.w, bb.h)
    ctx2d(c).drawImage(src, -bb.x, -bb.y)
    return { canvas: c, left: bb.x, top: bb.y }
  }
  const node = (l: Layer): PsdLayer | null => {
    const common = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: BLEND_TO_PSD[l.blend] || 'normal', clipping: l.clip }
    if (l.kind === 'group') return { ...common, opened: !l.collapsed, children: kids(l.id) }
    if (l.kind === 'adjust') return null
    const img = layerWithFx(doc, l)
    if (!img) return null
    const c = cropped(sized(img))
    return { ...common, ...c, ...(c.canvas ? {} : { canvas: canvas(1, 1) }) }
  }
  const kids = (parent: string | null) => childrenOf(doc, parent).map(node).filter(Boolean) as PsdLayer[]
  const merged = sized(flatten(doc))
  const buf = writePsd({ width: w, height: h, canvas: merged, children: kids(null) }, { generateThumbnail: true, noBackground: false })
  return new Uint8Array(buf)
}

/** A single-page PDF the size of the image (at 96 pixels per inch). Opaque images are stored as JPEG, transparent ones losslessly. */
export async function encodePdf(c: HTMLCanvasElement, quality: number, transparent: boolean): Promise<Uint8Array> {
  const w = c.width, h = c.height
  const pw = (w * 72) / 96, ph = (h * 72) / 96
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const push = (x: Uint8Array | string) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); size += b.length }
  const obj = (n: number, head: string, stream?: Uint8Array) => {
    offsets[n] = size
    if (stream) { push(`${n} 0 obj\n${head.replace('>>', `/Length ${stream.length}>>`)}\nstream\n`); push(stream); push('\nendstream\nendobj\n') }
    else push(`${n} 0 obj\n${head}\nendobj\n`)
  }
  const d = getData(c).data
  let hasAlpha = false
  if (transparent) for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { hasAlpha = true; break }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, '<</Type/Catalog/Pages 2 0 R>>')
  obj(2, '<</Type/Pages/Kids[3 0 R]/Count 1>>')
  obj(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}]/Resources<</XObject<</Im0 5 0 R>>>>/Contents 4 0 R>>`)
  obj(4, '<<>>', enc.encode(`q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`))
  if (hasAlpha) {
    const rgb = new Uint8Array(w * h * 3), a = new Uint8Array(w * h)
    for (let i = 0, j = 0; i < w * h; i++, j += 3) { rgb[j] = d[i * 4]; rgb[j + 1] = d[i * 4 + 1]; rgb[j + 2] = d[i * 4 + 2]; a[i] = d[i * 4 + 3] }
    obj(5, `<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/FlateDecode/SMask 6 0 R>>`, zlibSync(rgb, { level: 6 }))
    obj(6, `<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceGray/BitsPerComponent 8/Filter/FlateDecode>>`, zlibSync(a, { level: 6 }))
  } else {
    let src = c
    if (transparent) { src = canvas(w, h); const x = ctx2d(src); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(c, 0, 0) }
    const jpg = new Uint8Array(await (await new Promise<Blob>((res, rej) => src.toBlob(b => (b ? res(b) : rej(new Error(tr('Encoding failed')))), 'image/jpeg', quality / 100))).arrayBuffer())
    obj(5, `<</Type/XObject/Subtype/Image/Width ${w}/Height ${h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode>>`, jpg)
  }
  const count = offsets.length
  const xref = size
  push(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let i = 1; i < count; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n')
  push(`trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`)
  const out = new Uint8Array(size)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]

/** Windows icon with every standard size up to 256 px. The image is centred on a square. */
export async function encodeIco(c: HTMLCanvasElement): Promise<Uint8Array> {
  const pngs: { s: number; b: Uint8Array }[] = []
  for (const s of ICO_SIZES) {
    const t = canvas(s, s), x = ctx2d(t)
    const k = Math.min(s / c.width, s / c.height)
    const w = c.width * k, h = c.height * k
    x.imageSmoothingQuality = 'high'
    // Step down in halves so small sizes stay crisp.
    let src: HTMLCanvasElement = c
    while (src.width / 2 > w && src.height / 2 > h) { const n = canvas(Math.ceil(src.width / 2), Math.ceil(src.height / 2)); const nx = ctx2d(n); nx.imageSmoothingQuality = 'high'; nx.drawImage(src, 0, 0, n.width, n.height); src = n }
    x.drawImage(src, (s - w) / 2, (s - h) / 2, w, h)
    const b = new Uint8Array(await (await new Promise<Blob>(res => t.toBlob(b => res(b!), 'image/png'))).arrayBuffer())
    pngs.push({ s, b })
  }
  const head = 6 + 16 * pngs.length
  const total = head + pngs.reduce((a, p) => a + p.b.length, 0)
  const out = new Uint8Array(total), v = new DataView(out.buffer)
  v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, pngs.length, true)
  let off = head
  pngs.forEach((p, i) => {
    const e = 6 + i * 16
    out[e] = p.s >= 256 ? 0 : p.s; out[e + 1] = p.s >= 256 ? 0 : p.s
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true)
    v.setUint32(e + 8, p.b.length, true); v.setUint32(e + 12, off, true)
    out.set(p.b, off); off += p.b.length
  })
  return out
}

let avifModule: Promise<any> | null = null

/**
 * AVIF through a WebAssembly encoder that loads the first time it's needed. The single-threaded
 * build is used directly: the multi-threaded one needs a cross-origin isolated page.
 */
export async function encodeAvif(c: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  avifModule ||= (async () => {
    const [{ default: factory }, { initEmscriptenModule }] = await Promise.all([
      import('@jsquash/avif/codec/enc/avif_enc.js'), import('@jsquash/avif/utils.js')])
    return initEmscriptenModule(factory)
  })()
  const [mod, { defaultOptions }] = await Promise.all([avifModule, import('@jsquash/avif/meta.js')])
  const d = getData(c)
  const out = mod.encode(new Uint8Array(d.data.buffer), d.width, d.height, { ...defaultOptions, quality: Math.round(quality * 0.9), speed: 6 })
  if (!out) { avifModule = null; throw new Error(tr('Could not encode AVIF')) }
  return new Uint8Array(out.buffer)
}
