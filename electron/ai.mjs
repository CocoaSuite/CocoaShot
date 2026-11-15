import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
let env, AutoModel, AutoProcessor, RawImage, SamModel, pipeline, ort
let loadError = null
try {
  ;({ env, AutoModel, AutoProcessor, RawImage, SamModel, pipeline } = await import('@huggingface/transformers'))
  ort = require('onnxruntime-node')
} catch (e) {
  loadError = e
  console.error('Failed to load the AI libraries:', e?.stack || e)
}

const DIR = process.env.COCOA_MODELS || path.join(process.cwd(), '.models')
if (env) {
  env.cacheDir = DIR
  env.allowLocalModels = true
  env.localModelPath = DIR
  env.allowRemoteModels = true
}

export const MODELS = {
  isnet: { repo: 'isnet', files: ['isnet-general-use.onnx'], url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx', size: 179e6, name: 'ISNet', use: 'Background removal for products, animals, people and objects', license: 'Apache-2.0', raw: true },
  birefnet: { repo: 'onnx-community/BiRefNet_lite-ONNX', files: ['onnx/model.onnx'], size: 224e6, name: 'BiRefNet Lite', use: 'Maximum hair and edge detail. Needs a dedicated GPU or 16 GB of memory', license: 'MIT' },
  modnet: { repo: 'Xenova/modnet', files: ['onnx/model.onnx'], size: 26e6, name: 'MODNet', use: 'Fast background removal for portraits', license: 'Apache-2.0' },
  sam: { repo: 'Xenova/slimsam-77-uniform', files: ['onnx/vision_encoder.onnx', 'onnx/prompt_encoder_mask_decoder.onnx'], size: 52e6, name: 'SlimSAM', use: 'Click to select objects', license: 'Apache-2.0' },
  detr: { repo: 'Xenova/detr-resnet-50', files: ['onnx/model.onnx'], size: 167e6, name: 'DETR ResNet-50', use: 'Finds people, animals, vehicles and products', license: 'Apache-2.0' },
  lama: { repo: 'Carve/LaMa-ONNX', files: ['lama.onnx'], url: 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama.onnx', size: 208e6, name: 'LaMa', use: 'Object removal and repair', license: 'Apache-2.0', raw: true },
  sr2: { repo: 'Xenova/swin2SR-classical-sr-x2-64', files: ['onnx/model.onnx'], size: 4.5e6, name: 'Swin2SR 2x', use: 'Upscale to twice the size', license: 'Apache-2.0' },
  sr4: { repo: 'Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr', files: ['onnx/model.onnx'], size: 17e6, name: 'Swin2SR 4x', use: 'Upscale to four times the size, for photos', license: 'Apache-2.0' }
}

const has = k => MODELS[k].files.every(f => fs.existsSync(path.join(DIR, MODELS[k].repo, f)))

export async function status() {
  const out = {}
  for (const k in MODELS) out[k] = { ...MODELS[k], installed: has(k) }
  return out
}

const SO = { enableCpuMemArena: false, enableMemPattern: false, graphOptimizationLevel: 'all' }
let gpu = !process.env.COCOA_AI_CPU
const devices = () => (gpu && process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'])
const loaded = new Map()

async function tryDevices(fn) {
  let err
  for (const d of devices()) { try { return await fn(d) } catch (e) { err = e } }
  throw err
}

async function download(k, progress) {
  const m = MODELS[k]
  if (m.raw) {
    const file = path.join(DIR, m.repo, m.files[0])
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const res = await fetch(m.url)
    if (!res.ok) throw new Error('Download failed: ' + res.status)
    const total = +res.headers.get('content-length') || m.size
    const tmp = file + '.part'
    const out = fs.createWriteStream(tmp)
    let got = 0, last = 0
    for await (const chunk of res.body) {
      out.write(chunk)
      got += chunk.length
      if (got - last > 2e6) { last = got; progress({ loaded: got, total }) }
    }
    await new Promise(r => out.end(r))
    await fsp.rename(tmp, file)
    return
  }
  {
    const cb = p => { if (p.status === 'progress') progress({ file: p.file, loaded: p.loaded, total: p.total }) }
    if (k === 'sam') { await SamModel.from_pretrained(m.repo, { dtype: 'fp32', progress_callback: cb }); await AutoProcessor.from_pretrained(m.repo) }
    else if (k === 'detr') await pipeline('object-detection', m.repo, { dtype: 'fp32', progress_callback: cb })
    else if (k === 'sr2' || k === 'sr4') await pipeline('image-to-image', m.repo, { dtype: 'fp32', progress_callback: cb })
    else { await AutoModel.from_pretrained(m.repo, { dtype: 'fp32', progress_callback: cb }); await AutoProcessor.from_pretrained(m.repo) }
  }
}

async function remove(k) {
  loaded.delete(k)
  await fsp.rm(path.join(DIR, MODELS[k].repo), { recursive: true, force: true })
}

async function get(k) {
  if (loaded.has(k)) return loaded.get(k)
  if (!has(k)) throw new Error('MODEL_MISSING:' + k)
  const m = MODELS[k]
  let v
  if (m.raw) {
    v = await tryDevices(d => ort.InferenceSession.create(path.join(DIR, m.repo, m.files[0]), { executionProviders: d === 'dml' ? ['dml', 'cpu'] : ['cpu'], graphOptimizationLevel: k === 'lama' ? 'basic' : 'all' }))
  } else if (k === 'detr') v = await tryDevices(d => pipeline('object-detection', m.repo, { dtype: 'fp32', device: d, local_files_only: true, session_options: SO }))
  else if (k === 'sr2' || k === 'sr4') v = await tryDevices(d => pipeline('image-to-image', m.repo, { dtype: 'fp32', device: d, local_files_only: true, session_options: SO }))
  else if (k === 'sam') v = { model: await tryDevices(d => SamModel.from_pretrained(m.repo, { dtype: 'fp32', device: d, local_files_only: true, session_options: SO })), proc: await AutoProcessor.from_pretrained(m.repo, { local_files_only: true }) }
  else v = { model: await tryDevices(d => AutoModel.from_pretrained(m.repo, { dtype: 'fp32', device: d, local_files_only: true, session_options: SO })), proc: await AutoProcessor.from_pretrained(m.repo, { local_files_only: true }) }
  loaded.set(k, v)
  return v
}

const img = a => new RawImage(new Uint8ClampedArray(a.data.buffer ? a.data.buffer : a.data, a.data.byteOffset || 0, a.w * a.h * 4), a.w, a.h, 4).rgb()

async function isnet(a) {
  const s = await get('isnet')
  const S = 1024, n = S * S
  const r = await new RawImage(new Uint8ClampedArray(a.data), a.w, a.h, 4).rgb().resize(S, S)
  let mx = 1
  for (let i = 0; i < r.data.length; i++) if (r.data[i] > mx) mx = r.data[i]
  const f = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) f[c * n + i] = r.data[i * 3 + c] / mx - 0.5
  const o = (await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', f, [1, 3, S, S]) }))[s.outputNames[0]].data
  let lo = Infinity, hi = -Infinity
  for (let i = 0; i < n; i++) { if (o[i] < lo) lo = o[i]; if (o[i] > hi) hi = o[i] }
  const m = new Uint8ClampedArray(n)
  for (let i = 0; i < n; i++) m[i] = ((o[i] - lo) / (hi - lo || 1)) * 255
  const out = await new RawImage(m, S, S, 1).resize(a.w, a.h)
  return { w: a.w, h: a.h, mask: new Uint8Array(out.data.buffer, out.data.byteOffset, a.w * a.h) }
}

export async function removeBg(a) {
  const k = a.model === 'modnet' ? 'modnet' : a.model === 'birefnet' ? 'birefnet' : 'isnet'
  if (k === 'isnet') return isnet(a)
  const { model, proc } = await get(k)
  const image = img(a)
  const { pixel_values } = await proc(image)
  let t
  if (k === 'birefnet') t = (await model({ input_image: pixel_values })).output_image[0].sigmoid()
  else t = (await model({ input: pixel_values })).output[0]
  const mask = await RawImage.fromTensor(t.mul(255).to('uint8')).resize(a.w, a.h)
  return { w: a.w, h: a.h, mask: new Uint8Array(mask.data.buffer, mask.data.byteOffset, a.w * a.h) }
}

let samCache = null
export async function samEmbed(a) {
  const { model, proc } = await get('sam')
  const image = img(a)
  const inputs = await proc(image)
  const emb = await model.get_image_embeddings(inputs)
  samCache = { image, inputs, emb, w: a.w, h: a.h }
  return true
}

export async function samMask(a) {
  if (!samCache) throw new Error('No image')
  const { model, proc } = await get('sam')
  const { image, emb, w, h } = samCache
  const opts = {}
  let pts = a.points || [], labels = a.labels || []
  if (a.box) { pts = [[a.box[0], a.box[1]], [a.box[2], a.box[3]], ...pts]; labels = [2, 3, ...labels] }
  opts.input_points = [[pts]]; opts.input_labels = [[labels]]
  const inputs = await proc(image, opts)
  const out = await model({ ...emb, input_points: inputs.input_points, input_labels: inputs.input_labels })
  const masks = await proc.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes)
  const scores = out.iou_scores.data
  let best = 0
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i
  const m = masks[0]
  const n = w * h
  const res = new Uint8Array(n)
  const d = m.data
  for (let i = 0; i < n; i++) res[i] = d[best * n + i] ? 255 : 0
  return { w, h, mask: res, score: scores[best] }
}

export async function detect(a) {
  const det = await get('detr')
  const r = await det(img(a), { threshold: a.threshold ?? 0.7, percentage: false })
  return r.map(x => ({ label: x.label, score: x.score, box: [x.box.xmin, x.box.ymin, x.box.xmax, x.box.ymax] }))
}

export async function inpaint(a) {
  const s = await get('lama')
  const S = 512, n = S * S
  const im = new Float32Array(3 * n), mk = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    im[i] = a.data[i * 4] / 255; im[n + i] = a.data[i * 4 + 1] / 255; im[2 * n + i] = a.data[i * 4 + 2] / 255
    mk[i] = a.mask[i] > 127 ? 1 : 0
  }
  const names = s.inputNames
  const feeds = { [names[0]]: new ort.Tensor('float32', im, [1, 3, S, S]), [names[1]]: new ort.Tensor('float32', mk, [1, 1, S, S]) }
  const out = (await s.run(feeds))[s.outputNames[0]].data
  let mx = 0
  for (let i = 0; i < out.length; i += 97) if (out[i] > mx) mx = out[i]
  const k = mx > 2 ? 1 : 255
  const res = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    res[i * 4] = Math.max(0, Math.min(255, out[i] * k))
    res[i * 4 + 1] = Math.max(0, Math.min(255, out[n + i] * k))
    res[i * 4 + 2] = Math.max(0, Math.min(255, out[2 * n + i] * k))
    res[i * 4 + 3] = 255
  }
  return res
}

export async function upscale(a, progress) {
  const k = a.scale === 4 ? 'sr4' : 'sr2'
  const sc = a.scale === 4 ? 4 : 2
  const up = await get(k)
  const T = 160, O = 12
  const W = a.w * sc, H = a.h * sc
  const out = new Uint8Array(W * H * 4)
  const src = img(a)
  const tiles = []
  for (let y = 0; y < a.h; y += T) for (let x = 0; x < a.w; x += T) tiles.push([x, y])
  let done = 0
  for (const [x, y] of tiles) {
    const x0 = Math.max(0, x - O), y0 = Math.max(0, y - O)
    const x1 = Math.min(a.w, x + T + O), y1 = Math.min(a.h, y + T + O)
    const tile = await src.crop([x0, y0, x1 - 1, y1 - 1])
    const r = await up(tile)
    const ch = r.channels, tw = r.width
    const cx0 = (x - x0) * sc, cy0 = (y - y0) * sc
    const cw = Math.min(T, a.w - x) * sc, chh = Math.min(T, a.h - y) * sc
    for (let yy = 0; yy < chh; yy++) for (let xx = 0; xx < cw; xx++) {
      const si = ((yy + cy0) * tw + (xx + cx0)) * ch, di = ((y * sc + yy) * W + (x * sc + xx)) * 4
      out[di] = r.data[si]; out[di + 1] = r.data[si + 1]; out[di + 2] = r.data[si + 2]; out[di + 3] = 255
    }
    progress({ loaded: ++done, total: tiles.length })
  }
  return { w: W, h: H, data: out }
}

export const OPS = { status, removeBg, samEmbed, samMask, detect, inpaint, upscale, download: (a, p) => download(a.key, p), remove: a => remove(a.key), setGpu: a => { gpu = !!a.on; loaded.clear(); return true } }

if (process.parentPort) {
  process.on('uncaughtException', e => console.error('Uncaught:', e?.stack || e))
  process.on('unhandledRejection', e => console.error('Unhandled:', e?.stack || e))
  process.parentPort.on('message', async e => {
    const { id, op, args } = e.data
    const progress = p => process.parentPort.postMessage({ id, progress: p })
    try {
      if (loadError && op !== 'status') throw new Error('The AI libraries could not load: ' + (loadError.message || loadError))
      let result
      try { result = await OPS[op](args || {}, progress) }
      catch (err) {
        if (!gpu || !/887A|DmlExecutionProvider|device instance|D3D12|DXGI|GPU/i.test(String(err?.message || err))) throw err
        console.error('GPU failed, switching to CPU:', err?.message || err)
        gpu = false
        loaded.clear()
        samCache = null
        result = await OPS[op](args || {}, progress)
      }
      process.parentPort.postMessage({ id, ok: true, result })
    } catch (err) {
      console.error(op, err?.stack || err)
      process.parentPort.postMessage({ id, ok: false, error: String(err?.message || err) })
    }
  })
}
