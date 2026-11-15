export type F = Float32Array

export function boxBlur(src: F, w: number, h: number, r: number): F {
  r = Math.round(r)
  if (r < 1) return src.slice()
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  const n = r * 2 + 1
  for (let y = 0; y < h; y++) {
    const o = y * w
    let s = 0
    for (let i = -r; i <= r; i++) s += src[o + Math.min(w - 1, Math.max(0, i))]
    for (let x = 0; x < w; x++) {
      tmp[o + x] = s / n
      s += src[o + Math.min(w - 1, x + r + 1)] - src[o + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0
    for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, i)) * w + x]
    for (let y = 0; y < h; y++) {
      out[y * w + x] = s / n
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
  return out
}

export function gauss(src: F, w: number, h: number, sigma: number): F {
  if (sigma < 0.5) return src.slice()
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2))
  return boxBlur(boxBlur(boxBlur(src, w, h, r), w, h, r), w, h, r)
}

function minmax1(src: F, dst: F, n: number, stride: number, off: number, r: number, max: boolean) {
  const k = 2 * r + 1
  const g = new Float32Array(n + k), hh = new Float32Array(n + k)
  const get = (i: number) => src[off + Math.min(n - 1, Math.max(0, i - r)) * stride]
  const L = n + 2 * r
  const op = max ? Math.max : Math.min
  for (let i = 0; i < L; i++) g[i] = i % k === 0 ? get(i) : op(g[i - 1], get(i))
  for (let i = L - 1; i >= 0; i--) hh[i] = i % k === k - 1 || i === L - 1 ? get(i) : op(hh[i + 1], get(i))
  for (let i = 0; i < n; i++) dst[off + i * stride] = op(hh[i], g[i + 2 * r])
}

export function morph(src: F, w: number, h: number, r: number): F {
  r = Math.round(r)
  if (!r) return src.slice()
  const max = r > 0
  r = Math.abs(r)
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) minmax1(src, tmp, w, 1, y * w, r, max)
  for (let x = 0; x < w; x++) minmax1(tmp, out, h, w, x, r, max)
  return out
}

export function guided(I: F, p: F, w: number, h: number, r: number, eps: number): F {
  const mI = boxBlur(I, w, h, r), mp = boxBlur(p, w, h, r)
  const n = w * h
  const Ip = new Float32Array(n), II = new Float32Array(n)
  for (let i = 0; i < n; i++) { Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i] }
  const mIp = boxBlur(Ip, w, h, r), mII = boxBlur(II, w, h, r)
  const a = new Float32Array(n), b = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const v = mII[i] - mI[i] * mI[i]
    a[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps)
    b[i] = mp[i] - a[i] * mI[i]
  }
  const ma = boxBlur(a, w, h, r), mb = boxBlur(b, w, h, r)
  const q = new Float32Array(n)
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i]
  return q
}

export function gray(rgba: Uint8ClampedArray, n: number): F {
  const g = new Float32Array(n)
  for (let i = 0; i < n; i++) g[i] = (rgba[i * 4] * 0.299 + rgba[i * 4 + 1] * 0.587 + rgba[i * 4 + 2] * 0.114) / 255
  return g
}

export function maskPipeline(a: F, w: number, h: number, o: { feather: number; smooth: number; shift: number }): F {
  let m = a
  if (o.shift) m = morph(m, w, h, o.shift)
  if (o.smooth > 0) {
    m = gauss(m, w, h, o.smooth / 10 * 3)
    for (let i = 0; i < m.length; i++) { const t = Math.min(1, Math.max(0, (m[i] - 0.5) * 3 + 0.5)); m[i] = t * t * (3 - 2 * t) }
  }
  if (o.feather > 0) m = gauss(m, w, h, o.feather)
  return m
}

export type Loop = number[]

export function contours(a: Uint8Array | Uint8ClampedArray, w: number, h: number, thr = 128): Loop[] {
  const W = w + 2, H = h + 2
  const v = (x: number, y: number) => (x < 1 || y < 1 || x > w || y > h ? 0 : a[(y - 1) * w + (x - 1)] >= thr ? 1 : 0)
  const next = new Map<number, number>()
  const key = (x2: number, y2: number) => y2 * (W * 2 + 2) + x2
  const seg = (ax: number, ay: number, bx: number, by: number) => next.set(key(ax, ay), key(bx, by))
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const c = v(x, y) | (v(x + 1, y) << 1) | (v(x + 1, y + 1) << 2) | (v(x, y + 1) << 3)
    if (c === 0 || c === 15) continue
    const T = [x * 2 + 1, y * 2], R = [x * 2 + 2, y * 2 + 1], B = [x * 2 + 1, y * 2 + 2], Lf = [x * 2, y * 2 + 1]
    const s = (p: number[], q: number[]) => seg(p[0], p[1], q[0], q[1])
    switch (c) {
      case 1: s(Lf, T); break
      case 2: s(T, R); break
      case 3: s(Lf, R); break
      case 4: s(R, B); break
      case 5: s(Lf, T); s(R, B); break
      case 6: s(T, B); break
      case 7: s(Lf, B); break
      case 8: s(B, Lf); break
      case 9: s(B, T); break
      case 10: s(T, R); s(B, Lf); break
      case 11: s(B, R); break
      case 12: s(R, Lf); break
      case 13: s(R, T); break
      case 14: s(T, Lf); break
    }
  }
  const K = W * 2 + 2
  const loops: Loop[] = []
  for (const start of next.keys()) {
    if (!next.has(start)) continue
    const pts: number[] = []
    let k = start
    while (next.has(k)) {
      const n = next.get(k)!
      next.delete(k)
      pts.push((k % K) / 2 - 0.5, Math.floor(k / K) / 2 - 0.5)
      k = n
    }
    if (pts.length >= 6) loops.push(simplify(pts, 0.6))
  }
  return loops
}

export function simplify(pts: number[], tol: number): number[] {
  const n = pts.length / 2
  if (n < 4) return pts
  const keep = new Uint8Array(n)
  keep[0] = keep[n - 1] = 1
  const stack = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a * 2], ay = pts[a * 2 + 1], bx = pts[b * 2], by = pts[b * 2 + 1]
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1
    let md = 0, mi = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i * 2] - ax) * dy - (pts[i * 2 + 1] - ay) * dx) / L
      if (d > md) { md = d; mi = i }
    }
    if (md > tol && mi > 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]) }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 2], pts[i * 2 + 1])
  return out
}

export function flood(rgba: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tol: number, contiguous: boolean): Uint8Array {
  const m = new Uint8Array(w * h)
  const i0 = (sy * w + sx) * 4
  const r0 = rgba[i0], g0 = rgba[i0 + 1], b0 = rgba[i0 + 2], a0 = rgba[i0 + 3]
  const t = tol * tol * 4
  const near = (i: number) => {
    const j = i * 4, dr = rgba[j] - r0, dg = rgba[j + 1] - g0, db = rgba[j + 2] - b0, da = rgba[j + 3] - a0
    return dr * dr + dg * dg + db * db + da * da <= t
  }
  if (!contiguous) { for (let i = 0; i < w * h; i++) if (near(i)) m[i] = 255; return m }
  const st = new Int32Array(w * h)
  let sp = 0
  st[sp++] = sy * w + sx
  m[sy * w + sx] = 255
  while (sp) {
    const i = st[--sp], x = i % w, y = (i / w) | 0
    const tryp = (j: number) => { if (!m[j] && near(j)) { m[j] = 255; st[sp++] = j } }
    if (x > 0) tryp(i - 1)
    if (x < w - 1) tryp(i + 1)
    if (y > 0) tryp(i - w)
    if (y < h - 1) tryp(i + w)
  }
  return m
}

export function inpaint(rgba: Uint8ClampedArray, mask: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba)
  const known = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) known[i] = mask[i] > 127 ? 0 : 1
  let front: number[] = []
  const isFront = (i: number) => {
    if (known[i]) return false
    const x = i % w, y = (i / w) | 0
    return (x > 0 && known[i - 1] === 1) || (x < w - 1 && known[i + 1] === 1) || (y > 0 && known[i - w] === 1) || (y < h - 1 && known[i + w] === 1)
  }
  for (let i = 0; i < w * h; i++) if (isFront(i)) front.push(i)
  const R = 3
  while (front.length) {
    const vals: number[][] = []
    for (const i of front) {
      const x = i % w, y = (i / w) | 0
      let r = 0, g = 0, b = 0, a = 0, ws = 0
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx, yy = y + dy
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const j = yy * w + xx
        if (known[j] !== 1) continue
        const wt = 1 / (dx * dx + dy * dy + 0.5)
        r += out[j * 4] * wt; g += out[j * 4 + 1] * wt; b += out[j * 4 + 2] * wt; a += out[j * 4 + 3] * wt; ws += wt
      }
      vals.push(ws ? [r / ws, g / ws, b / ws, a / ws] : [0, 0, 0, 0])
    }
    front.forEach((i, k) => { out.set(vals[k], i * 4); known[i] = 2 })
    const nf = new Set<number>()
    for (const i of front) {
      known[i] = 1
      const x = i % w, y = (i / w) | 0
      const n = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of n) if (j >= 0 && !known[j]) nf.add(j)
    }
    front = [...nf]
  }
  return out
}

export function denoise(rgba: Uint8ClampedArray, w: number, h: number, strength: number): Uint8ClampedArray {
  const n = w * h, r = Math.max(1, Math.round(1 + strength * 3)), eps = 0.0005 + strength * strength * 0.01
  const out = new Uint8ClampedArray(rgba)
  for (let c = 0; c < 3; c++) {
    const ch = new Float32Array(n)
    for (let i = 0; i < n; i++) ch[i] = rgba[i * 4 + c] / 255
    const q = guided(ch, ch, w, h, r, eps)
    for (let i = 0; i < n; i++) out[i * 4 + c] = q[i] * 255
  }
  return out
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
const lanczos = (x: number) => (Math.abs(x) < 3 ? sinc(x) * sinc(x / 3) : 0)

function resize1(src: Float32Array, sw: number, sh: number, dw: number, horiz: boolean): Float32Array {
  const lines = horiz ? sh : sw, sn = horiz ? sw : sh
  const out = new Float32Array((horiz ? dw * sh : sw * dw) * 4)
  const scale = sn / dw, fs = Math.max(1, scale), sup = 3 * fs
  for (let d = 0; d < dw; d++) {
    const c = (d + 0.5) * scale - 0.5
    const i0 = Math.max(0, Math.ceil(c - sup)), i1 = Math.min(sn - 1, Math.floor(c + sup))
    const ws: number[] = []
    let tot = 0
    for (let i = i0; i <= i1; i++) { const wv = lanczos((i - c) / fs); ws.push(wv); tot += wv }
    for (let l = 0; l < lines; l++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let i = i0, k = 0; i <= i1; i++, k++) {
        const j = (horiz ? l * sw + i : i * sw + l) * 4, wv = ws[k]
        r += src[j] * wv; g += src[j + 1] * wv; b += src[j + 2] * wv; a += src[j + 3] * wv
      }
      const o = (horiz ? l * dw + d : d * sw + l) * 4
      out[o] = r / tot; out[o + 1] = g / tot; out[o + 2] = b / tot; out[o + 3] = a / tot
    }
  }
  return out
}

export function resizeLanczos(rgba: Uint8ClampedArray, sw: number, sh: number, dw: number, dh: number): Uint8ClampedArray {
  const n = sw * sh, f = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255
    f[i * 4] = rgba[i * 4] * a; f[i * 4 + 1] = rgba[i * 4 + 1] * a; f[i * 4 + 2] = rgba[i * 4 + 2] * a; f[i * 4 + 3] = a
  }
  const hz = resize1(f, sw, sh, dw, true)
  const v = resize1(hz, dw, sh, dh, false)
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let i = 0; i < dw * dh; i++) {
    const a = Math.min(1, Math.max(0, v[i * 4 + 3]))
    out[i * 4 + 3] = a * 255
    if (a > 0) { out[i * 4] = v[i * 4] / a; out[i * 4 + 1] = v[i * 4 + 1] / a; out[i * 4 + 2] = v[i * 4 + 2] / a }
  }
  return out
}

export function warpPerspective(rgba: Uint8ClampedArray, sw: number, sh: number, quad: number[], dw: number, dh: number): Uint8ClampedArray {
  const H = homography([0, 0, dw, 0, dw, dh, 0, dh], quad)
  const out = new Uint8ClampedArray(dw * dh * 4)
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const X = x + 0.5, Y = y + 0.5
    const z = H[6] * X + H[7] * Y + H[8]
    const u = (H[0] * X + H[1] * Y + H[2]) / z - 0.5, v = (H[3] * X + H[4] * Y + H[5]) / z - 0.5
    const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0
    const o = (y * dw + x) * 4
    for (let c = 0; c < 4; c++) {
      const p = (xx: number, yy: number) => (xx < 0 || yy < 0 || xx >= sw || yy >= sh ? 0 : rgba[(yy * sw + xx) * 4 + c])
      out[o + c] = (p(x0, y0) * (1 - fx) + p(x0 + 1, y0) * fx) * (1 - fy) + (p(x0, y0 + 1) * (1 - fx) + p(x0 + 1, y0 + 1) * fx) * fy
    }
  }
  return out
}

export function homography(s: number[], d: number[]): number[] {
  const A: number[][] = []
  for (let i = 0; i < 4; i++) {
    const [x, y, u, v] = [s[i * 2], s[i * 2 + 1], d[i * 2], d[i * 2 + 1]]
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u])
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v])
  }
  for (let c = 0; c < 8; c++) {
    let p = c
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    for (let r = 0; r < 8; r++) if (r !== c) {
      const f = A[r][c] / A[c][c]
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k]
    }
  }
  const h = A.map((r, i) => r[8] / r[i])
  return [...h, 1]
}

export function histogramStats(rgba: Uint8ClampedArray) {
  const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256), hl = new Uint32Array(256)
  let n = 0, sr = 0, sg = 0, sb = 0
  for (let i = 0; i < rgba.length; i += 16) {
    if (rgba[i + 3] < 128) continue
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
    hr[r]++; hg[g]++; hb[b]++; hl[(r * 0.299 + g * 0.587 + b * 0.114) | 0]++
    sr += r; sg += g; sb += b; n++
  }
  const pct = (h: Uint32Array, p: number) => { let c = 0; const t = n * p; for (let i = 0; i < 256; i++) { c += h[i]; if (c >= t) return i } return 255 }
  return { n, mean: [sr / n, sg / n, sb / n], lo: [pct(hr, 0.004), pct(hg, 0.004), pct(hb, 0.004)], hi: [pct(hr, 0.996), pct(hg, 0.996), pct(hb, 0.996)], llo: pct(hl, 0.004), lhi: pct(hl, 0.996), lmid: pct(hl, 0.5) }
}

export function levelsLUT(p: ArrayLike<number>, o = 0): Float32Array {
  const lo = p[o] / 255, hi = p[o + 1] / 255, g = Math.max(0.01, p[o + 2]), olo = p[o + 3] / 255, ohi = p[o + 4] / 255
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    const t = Math.min(1, Math.max(0, (i / 255 - lo) / Math.max(1 / 255, hi - lo)))
    lut[i] = olo + (ohi - olo) * Math.pow(t, 1 / g)
  }
  return lut
}

export const levelsIdentity = (p: ArrayLike<number>, o = 0) => p[o] === 0 && p[o + 1] === 255 && p[o + 2] === 1 && p[o + 3] === 0 && p[o + 4] === 255

export function histograms(rgba: Uint8ClampedArray, step = 4) {
  const H = [0, 1, 2, 3, 4].map(() => new Uint32Array(256))
  const [hl, hr, hg, hb, ha] = H
  for (let i = 0; i < rgba.length; i += 4 * step) {
    const a = rgba[i + 3]
    ha[a]++
    if (!a) continue
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2]
    hr[r]++; hg[g]++; hb[b]++; hl[(r * 0.299 + g * 0.587 + b * 0.114) | 0]++
  }
  return H
}

export function autoRange(h: Uint32Array, clip = 0.002): [number, number] {
  let n = 0
  for (let i = 0; i < 256; i++) n += h[i]
  if (!n) return [0, 255]
  let lo = 0, hi = 255, c = 0
  for (let i = 0; i < 256; i++) { c += h[i]; if (c > n * clip) { lo = i; break } }
  c = 0
  for (let i = 255; i >= 0; i--) { c += h[i]; if (c > n * clip) { hi = i; break } }
  return hi - lo < 2 ? [0, 255] : [lo, hi]
}

export interface AlphaOpts { lv: number[]; grow: number; feather: number; hard: boolean; invert: boolean }
export const ALPHA0: AlphaOpts = { lv: [0, 255, 1, 0, 255], grow: 0, feather: 0, hard: false, invert: false }

export function editAlpha(alpha: Uint8Array | Uint8ClampedArray, w: number, h: number, o: AlphaOpts, limit?: Uint8Array | Uint8ClampedArray | null): Uint8Array {
  const n = w * h
  let f: F = new Float32Array(n)
  for (let i = 0; i < n; i++) f[i] = alpha[i] / 255
  if (o.grow) f = morph(f, w, h, o.grow)
  if (o.feather > 0) f = gauss(f, w, h, o.feather)
  const lut = levelsLUT(o.lv)
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    let a = lut[Math.round(Math.min(1, Math.max(0, f[i])) * 255)]
    if (o.hard) a = a >= 0.5 ? 1 : 0
    if (o.invert) a = 1 - a
    const v = a * 255
    out[i] = limit ? Math.round(alpha[i] + (v - alpha[i]) * (limit[i] / 255)) : Math.round(v)
  }
  return out
}
