import type { App } from '../app'
import type { Tool } from './types'
import type { Layer } from '../core/doc'
import { touch } from '../core/compose'
import { cropDoc } from '../core/transform'
import { alphaOf, canvas, ctx2d, getData, mkID, putData, scaled } from '../core/util'
import { native } from '../native'
import { h, icon, tip, toast } from '../ui/dom'
import { btn, hint, numField, sec, seg } from '../ui/controls'
import { ai, jobBox } from './common'
import { targetLayer } from './background'
import { tr, tx } from '../i18n'

export type FillMethod = 'ai' | 'edge' | 'color' | 'none'
export interface Sides { t: number; r: number; b: number; l: number }

type Prog = (p: number | null, d?: string) => void

/**
 * Fills the parts of layer l the old image did not cover (known: alpha mask of the covered area) with
 * the AI model, a smooth stretch of the edges, or a colour. One undo step.
 */
export async function fillOutside(app: App, l: Layer, known: HTMLCanvasElement, method: FillMethod, prog: Prog, color = '#ffffff') {
  if (method === 'none' || !l.canvas) return
  const doc = app.doc!
  const W = doc.w, H = doc.h
  const before = getData(l.canvas)
  const ka = alphaOf(known)
  // Unknown: not covered by the old image (anti-aliased edges of a turned crop count as unknown).
  const unknown = new Uint8Array(W * H)
  let any = false
  for (let i = 0; i < ka.length; i++) if (ka[i] < 250) { unknown[i] = 1; any = true }
  if (!any) return
  const unknownCanvas = () => { const c = canvas(W, H), d = new ImageData(W, H); for (let i = 0; i < unknown.length; i++) if (unknown[i]) { d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = d.data[i * 4 + 3] = 255 } putData(c, d); return c }
  const x = ctx2d(l.canvas)
  if (method === 'color') {
    const m = unknownCanvas(), mx = ctx2d(m)
    mx.globalCompositeOperation = 'source-in'; mx.fillStyle = color; mx.fillRect(0, 0, W, H)
    x.drawImage(m, 0, 0)
  } else if (method === 'edge') {
    x.drawImage(stretchEdges(l.canvas, unknown, W, H), 0, 0)
  } else {
    await aiFill(app, l, unknown, W, H, prog)
  }
  touch(l)
  app.hist!.raster(tr('Fill new area'), l, 'canvas', { x: 0, y: 0, w: W, h: H }, before)
  doc.changed()
}

/**
 * Smoothly continues the image into the unknown area (pull-push: averages spread outward level by level),
 * worked out at a reduced size and returned as a layer holding only the new pixels.
 */
function stretchEdges(src: HTMLCanvasElement, unknown: Uint8Array, W: number, H: number) {
  const s = Math.min(1, 1024 / Math.max(W, H))
  const w = Math.max(1, Math.round(W * s)), hh = Math.max(1, Math.round(H * s))
  const small = scaled(src, W, H, w, hh)
  const um = canvas(W, H)
  { const d = new ImageData(W, H); for (let i = 0; i < unknown.length; i++) d.data[i * 4 + 3] = unknown[i] ? 0 : 255; putData(um, d) }
  const km = alphaOf(scaled(um, W, H, w, hh))
  const sd = getData(small).data
  // Level 0: known colours weighted by how known each pixel is (and by its own opacity).
  let lw = w, lh = hh
  let col = new Float32Array(w * hh * 3), wt = new Float32Array(w * hh)
  for (let i = 0; i < w * hh; i++) {
    const k = (km[i] / 255) * (km[i] > 200 ? 1 : 0) * (sd[i * 4 + 3] / 255)
    wt[i] = k
    col[i * 3] = sd[i * 4] * k; col[i * 3 + 1] = sd[i * 4 + 1] * k; col[i * 3 + 2] = sd[i * 4 + 2] * k
  }
  const levels: { w: number; h: number; col: Float32Array; wt: Float32Array }[] = [{ w, h: hh, col, wt }]
  while (lw > 1 || lh > 1) {
    const nw = Math.max(1, Math.ceil(lw / 2)), nh = Math.max(1, Math.ceil(lh / 2))
    const nc = new Float32Array(nw * nh * 3), nwt = new Float32Array(nw * nh)
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) {
      const i = y * lw + x, j = (y >> 1) * nw + (x >> 1)
      nwt[j] += wt[i]; nc[j * 3] += col[i * 3]; nc[j * 3 + 1] += col[i * 3 + 1]; nc[j * 3 + 2] += col[i * 3 + 2]
    }
    levels.push({ w: nw, h: nh, col: nc, wt: nwt })
    lw = nw; lh = nh; col = nc; wt = nwt
  }
  // Push: each level fills its gaps from the smoothly scaled-up level above it.
  for (let k = levels.length - 2; k >= 0; k--) {
    const f = levels[k], c = levels[k + 1]
    const at = (x: number, y: number, ch: number) => {
      const X = Math.min(c.w - 1, Math.max(0, x)), Y = Math.min(c.h - 1, Math.max(0, y))
      const j = Y * c.w + X
      return ch < 3 ? c.col[j * 3 + ch] / Math.max(1e-6, c.wt[j]) : 1
    }
    for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
      const i = y * f.w + x
      const a = Math.min(1, f.wt[i])
      if (a >= 1) continue
      // Bilinear position in the coarser level.
      const cx = (x + 0.5) / 2 - 0.5, cy = (y + 0.5) / 2 - 0.5
      const x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0
      for (let ch = 0; ch < 3; ch++) {
        const v = (at(x0, y0, ch) * (1 - fx) + at(x0 + 1, y0, ch) * fx) * (1 - fy) + (at(x0, y0 + 1, ch) * (1 - fx) + at(x0 + 1, y0 + 1, ch) * fx) * fy
        const own = f.wt[i] > 1e-6 ? f.col[i * 3 + ch] / f.wt[i] : 0
        f.col[i * 3 + ch] = (own * a + v * (1 - a))
      }
      f.wt[i] = 1
    }
    // Normalise this level so its colours are plain values.
    for (let i = 0; i < f.w * f.h; i++) if (f.wt[i] !== 1) { const ww = Math.max(1e-6, f.wt[i]); f.col[i * 3] /= ww; f.col[i * 3 + 1] /= ww; f.col[i * 3 + 2] /= ww; f.wt[i] = 1 }
  }
  const L0 = levels[0]
  const out = new ImageData(w, hh)
  for (let i = 0; i < w * hh; i++) { out.data[i * 4] = L0.col[i * 3]; out.data[i * 4 + 1] = L0.col[i * 3 + 1]; out.data[i * 4 + 2] = L0.col[i * 3 + 2]; out.data[i * 4 + 3] = 255 }
  const sc = canvas(w, hh)
  putData(sc, out)
  // Back at full size, a light blur hides the coarse levels, then only the unknown area is kept.
  const full = canvas(W, H), fx = ctx2d(full)
  fx.imageSmoothingQuality = 'high'
  fx.drawImage(sc, 0, 0, W, H)
  fx.filter = `blur(${Math.max(1, Math.round(2 / s))}px)`
  fx.drawImage(sc, 0, 0, W, H)
  fx.filter = 'none'
  fx.globalCompositeOperation = 'destination-out'
  fx.drawImage(um, 0, 0)
  return full
}

/**
 * Fills the unknown area with LaMa, one square window at a time. Windows with the most known image in
 * them go first, so each later window builds on what is already there.
 */
async function aiFill(app: App, l: Layer, unknown: Uint8Array, W: number, H: number, prog: Prog) {
  if (!native) throw new Error(tr('AI fill runs in the CocoaShot desktop app. Use Stretch edges here.'))
  // How deep the new area reaches from the image, for the window size.
  let x0 = W, y0 = H, x1 = -1, y1 = -1
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!unknown[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y }
  if (x1 < 0) throw new Error(tr('There is no image to continue from'))
  const depth = Math.max(x0, y0, W - 1 - x1, H - 1 - y1)
  // Smaller windows keep more of LaMa's detail (it works at 512 px); enough room is left for the image beside the new area.
  const S = Math.round(Math.min(Math.max(W, H), Math.max(512, Math.min(1536, depth * 1.6))))
  const step = Math.max(64, Math.round(S / 2))
  const xs: number[] = [], ys: number[] = []
  for (let x = 0; ; x += step) { xs.push(Math.min(x, Math.max(0, W - S))); if (x + S >= W) break }
  for (let y = 0; ; y += step) { ys.push(Math.min(y, Math.max(0, H - S))); if (y + S >= H) break }
  const wins = [...new Set(ys.flatMap(y => xs.map(x => x + ',' + y)))].map(k => k.split(',').map(Number))
  const sw = Math.min(S, W), sh = Math.min(S, H)
  const count = (wx: number, wy: number) => {
    let u = 0
    for (let y = wy; y < wy + sh; y += 4) for (let x = wx; x < wx + sw; x += 4) u += unknown[y * W + x]
    return u / (Math.ceil(sh / 4) * Math.ceil(sw / 4))
  }
  let left = 0
  for (let i = 0; i < unknown.length; i++) left += unknown[i]
  const total = left
  const lx = ctx2d(l.canvas!)
  let guard = 0
  while (left > 0 && guard++ < 400) {
    // Next window: some unknown, as much known as possible.
    let best: number[] | null = null, bk = -1
    for (const [wx, wy] of wins) {
      const u = count(wx, wy)
      if (u <= 0) continue
      const k = 1 - u
      if (k > bk) { bk = k; best = [wx, wy] }
    }
    if (!best) break
    const [wx, wy] = best
    const N = 512
    const img = canvas(N, N), ix = ctx2d(img)
    ix.imageSmoothingQuality = 'high'
    ix.drawImage(l.canvas!, wx, wy, sw, sh, 0, 0, N, N)
    const wm = new ImageData(sw, sh)
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (unknown[(y + wy) * W + x + wx]) wm.data[(y * sw + x) * 4 + 3] = 255
    const wmc = canvas(sw, sh); putData(wmc, wm)
    const mk = canvas(N, N), mx = ctx2d(mk); mx.drawImage(wmc, 0, 0, N, N)
    const md = getData(mk).data, m1 = new Uint8Array(N * N)
    // The mask reaches a little into the known image so the seam is rebuilt too.
    for (let i = 0; i < m1.length; i++) m1[i] = md[i * 4 + 3] > 8 ? 255 : 0
    const out: Uint8Array = await ai(app, 'inpaint', { data: new Uint8Array(getData(img).data.buffer), mask: m1 }, () => {})
    const oc = canvas(N, N); putData(oc, mkID(out, N, N))
    const patch = canvas(sw, sh), px = ctx2d(patch)
    px.imageSmoothingQuality = 'high'
    px.drawImage(oc, 0, 0, sw, sh)
    px.globalCompositeOperation = 'destination-in'
    px.drawImage(wmc, 0, 0)
    lx.drawImage(patch, wx, wy)
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = (y + wy) * W + x + wx; if (unknown[i]) { unknown[i] = 0; left-- } }
    prog(1 - left / total, tr('Filling the new area'))
  }
}

/** Grows the canvas by the given sides and fills the new area. */
export async function expandCanvas(app: App, sides: Sides, method: FillMethod, prog: Prog, color = app.bgc) {
  const doc = app.doc!
  const l = targetLayer(app)
  const W = doc.w + sides.l + sides.r, H = doc.h + sides.t + sides.b
  if (W * H > 400e6) throw new Error(tr('That size is too large'))
  const cover = cropDoc(doc, app.hist!, { x: -sides.l, y: -sides.t, w: W, h: H }, 0, undefined, undefined, tr('Expand canvas'))
  if (l && method !== 'none') await fillOutside(app, l, cover, method, prog, color)
  app.view.fit()
}

/** Sides to add so a w × h image reaches the given ratio, split evenly. */
export function sidesForRatio(w: number, hh: number, k: number): Sides {
  const s: Sides = { t: 0, r: 0, b: 0, l: 0 }
  if (w / hh < k) { const add = Math.round(hh * k) - w; s.l = Math.floor(add / 2); s.r = add - s.l }
  else { const add = Math.round(w / k) - hh; s.t = Math.floor(add / 2); s.b = add - s.t }
  return s
}

const RATIOS: [string, number][] = [['1:1', 1], ['4:5', 4 / 5], ['16:9', 16 / 9], ['9:16', 9 / 16], ['3:2', 3 / 2], ['4:3', 4 / 3]]

export function expandTools(app: App): Tool[] {
  const st = { t: 0, r: 0, b: 0, l: 0, method: (native ? 'ai' : 'edge') as FillMethod, ratio: null as [string, number] | null }
  const sides = () => ({ t: st.t, r: st.r, b: st.b, l: st.l })
  const reset = () => { st.t = st.r = st.b = st.l = 0; st.ratio = null }
  const apply = () => {
    const d = app.doc
    if (!d) return
    if (!st.t && !st.r && !st.b && !st.l) { toast(tr('Set how far to expand first')); return }
    const s = sides(), m = st.method
    // Expanding to a ratio is recorded as that, so the action fits any image.
    app.record(st.ratio ? { kind: 'expandRatio', ratio: st.ratio[1], label: st.ratio[0], method: m } : { kind: 'expand', s, method: m })
    app.run(tr('Expanding the canvas'), async p => { await expandCanvas(app, s, m, p); reset(); app.emit('panel') })
  }
  const expand: Tool = {
    id: 'expand', label: tr('Expand'), icon: 'expand',
    activate: reset,
    overlay(x, v) {
      const d = app.doc
      if (!d) return
      const a = v.toScreen(-st.l, -st.t), b = v.toScreen(d.w + st.r, d.h + st.b)
      const o = v.toScreen(0, 0), e = v.toScreen(d.w, d.h)
      x.save()
      x.fillStyle = 'rgba(138,167,217,.18)'
      x.beginPath(); x.rect(a.x, a.y, b.x - a.x, b.y - a.y); x.rect(o.x, o.y, e.x - o.x, e.y - o.y); x.fill('evenodd')
      x.strokeStyle = '#8AA7D9'; x.lineWidth = 1.5; x.setLineDash([6, 4])
      x.strokeRect(a.x + 0.5, a.y + 0.5, b.x - a.x, b.y - a.y)
      x.restore()
    },
    key(e) { if (e.key === 'Enter') { apply(); return true } return false },
    panel() {
      const d = app.doc!
      const f = (label: string, k: 't' | 'r' | 'b' | 'l') => numField(label, () => st[k], v => { st[k] = v; st.ratio = null; size.textContent = sizeText(); app.view.draw() }, 0, 20000)
      const sizeText = () => tr('New size {0} × {1} px', d.w + st.l + st.r, d.h + st.t + st.b)
      const size = h('span', { class: 'hint' }, sizeText())
      const T = f(tx('side', 'Top'), 't'), R = f(tx('side', 'Right'), 'r'), B = f(tx('side', 'Bottom'), 'b'), L = f(tx('side', 'Left'), 'l')
      const all = (pct: number) => { const k = Math.round(Math.max(d.w, d.h) * pct / 100); st.t = st.r = st.b = st.l = k; st.ratio = null; app.emit('panel'); app.view.draw() }
      // Grow only the side that is short for the ratio, evenly on both ends.
      const toRatio = (n: string, k: number) => { Object.assign(st, sidesForRatio(d.w, d.h, k)); st.ratio = [n, k]; app.emit('panel'); app.view.draw() }
      return h('div', { class: 'ib' },
        sec(tr('Expand canvas')),
        hint(tr('Adds room around the image and fills it in, so a photo fits a wider or taller frame.')),
        h('div', { class: 'g2' }, T.el, B.el, L.el, R.el),
        size,
        sec(tr('Quick sizes')),
        h('div', { class: 'g3' }, ...[10, 25, 50].map(p => tip(btn('+' + p + '%', () => all(p)), tr('{0}% of the longer side on every side', p)))),
        h('div', { class: 'g3' }, ...RATIOS.map(([n, k]) => btn(tr('To {0}', n), () => toRatio(n, k), st.ratio?.[0] === n ? 'on' : ''))),
        sec(tr('Fill new area with')),
        seg<FillMethod>([['ai', tr('AI')], ['edge', tr('Stretch edges')], ['color', tr('Colour')], ['none', tr('Nothing')]], () => st.method, v => { st.method = v; app.emit('panel') }),
        hint(st.method === 'ai' ? (native ? tr('Continues the scene with the AI model, as if the photo had been taken wider. Best for backgrounds, sky, walls and landscapes.') : tr('AI fill runs in the CocoaShot desktop app. Use Stretch edges here.'))
          : st.method === 'edge' ? tr('Spreads the colours at the edges outward, softly. Good for plain or blurred backgrounds.')
          : st.method === 'color' ? tr('Fills with the background colour.') : tr('The new area stays transparent.')),
        jobBox(app),
        h('div', { class: 'g2' }, btn(tr('Reset'), () => { reset(); app.emit('panel'); app.view.draw() }), h('button', { class: 'pri', disabled: !!app.job, onclick: apply }, icon('expand'), tr('Expand'))))
    }
  }
  return [expand]
}
