import { homography } from './px'

/**
 * Freeform transforms: a layer's box mapped through a free quad (Distort) or a smooth grid (Warp).
 *
 * Both are turned into the same thing, a fine mesh of matching source and destination points,
 * which is drawn quickly as textured triangles while dragging and rasterised exactly on apply.
 */

/** A rectangle in image pixels: the part of the layer being reshaped. */
export interface Box { x: number; y: number; w: number; h: number }

/** A fine mesh: (nx + 1) × (ny + 1) points, row by row, in source and destination pixels. */
export interface Mesh { nx: number; ny: number; src: Float64Array; dst: Float64Array }

/** Points of a cols × rows grid of cells over a box, row by row: (cols + 1) × (rows + 1) x, y pairs. */
export function gridOver(b: Box, cols: number, rows: number): number[] {
  const out: number[] = []
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) out.push(b.x + (b.w * i) / cols, b.y + (b.h * j) / rows)
  return out
}

/** Whether four corners (top left, top right, bottom right, bottom left) make a convex quad. */
export function convex(q: number[]): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const ax = q[i * 2], ay = q[i * 2 + 1], bx = q[((i + 1) % 4) * 2], by = q[((i + 1) % 4) * 2 + 1], cx = q[((i + 2) % 4) * 2], cy = q[((i + 2) % 4) * 2 + 1]
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (Math.abs(z) < 1e-9) return false
    const s = Math.sign(z)
    if (sign && s !== sign) return false
    sign = s
  }
  return true
}

/**
 * Catmull-Rom weights of the n + 1 knots of a line at t in [0, 1]. The ends are extended in a straight line,
 * so an evenly spaced row of knots maps evenly and an untouched grid leaves the image exactly as it was.
 */
export function splineWeights(n: number, t: number): Float64Array {
  const w = new Float64Array(n + 1)
  const s = Math.min(Math.max(t, 0), 1) * n
  const i = Math.min(Math.floor(s), n - 1), f = s - i
  const f2 = f * f, f3 = f2 * f
  const k = [(-f3 + 2 * f2 - f) / 2, (3 * f3 - 5 * f2 + 2) / 2, (-3 * f3 + 4 * f2 + f) / 2, (f3 - f2) / 2]
  for (let m = 0; m < 4; m++) {
    const j = i - 1 + m
    if (j < 0) { w[0] += 2 * k[m]; w[1] -= k[m] }
    else if (j > n) { w[n] += 2 * k[m]; w[n - 1] -= k[m] }
    else w[j] += k[m]
  }
  return w
}

/** Where (u, v) in [0, 1]² lands on a smooth warp grid. */
export function warpAt(g: ArrayLike<number>, cols: number, rows: number, u: number, v: number): [number, number] {
  const wu = splineWeights(cols, u), wv = splineWeights(rows, v)
  let x = 0, y = 0
  for (let j = 0; j <= rows; j++) {
    if (!wv[j]) continue
    for (let i = 0; i <= cols; i++) {
      const w = wu[i] * wv[j]
      if (!w) continue
      const o = (j * (cols + 1) + i) * 2
      x += g[o] * w; y += g[o + 1] * w
    }
  }
  return [x, y]
}

/** How much each grid point pulls on the surface at (u, v): used to drag the surface itself rather than a point. */
export function warpInfluence(cols: number, rows: number, u: number, v: number): Float64Array {
  const wu = splineWeights(cols, u), wv = splineWeights(rows, v)
  const out = new Float64Array((cols + 1) * (rows + 1))
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) out[j * (cols + 1) + i] = wu[i] * wv[j]
  return out
}

/** Where (u, v) in [0, 1]² lands inside a four-corner quad: true perspective when the quad is convex, a bilinear blend otherwise. */
export function quadMapper(q: number[]): (u: number, v: number) => [number, number] {
  if (convex(q)) {
    const H = homography([0, 0, 1, 0, 1, 1, 0, 1], q)
    return (u, v) => { const z = H[6] * u + H[7] * v + H[8]; return [(H[0] * u + H[1] * v + H[2]) / z, (H[3] * u + H[4] * v + H[5]) / z] }
  }
  return (u, v) => {
    const tx = q[0] + (q[2] - q[0]) * u, ty = q[1] + (q[3] - q[1]) * u
    const bx = q[6] + (q[4] - q[6]) * u, by = q[7] + (q[5] - q[7]) * u
    return [tx + (bx - tx) * v, ty + (by - ty) * v]
  }
}

/** A fine mesh over box b whose destination is given by map(u, v). */
export function buildMesh(b: Box, nx: number, ny: number, map: (u: number, v: number) => [number, number]): Mesh {
  const n = (nx + 1) * (ny + 1)
  const src = new Float64Array(n * 2), dst = new Float64Array(n * 2)
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const o = (j * (nx + 1) + i) * 2, u = i / nx, v = j / ny
    src[o] = b.x + b.w * u; src[o + 1] = b.y + b.h * v
    const [x, y] = map(u, v)
    dst[o] = x; dst[o + 1] = y
  }
  return { nx, ny, src, dst }
}

/** Each cell of the mesh split into two triangles, as point indices. */
function* triangles(m: Mesh) {
  const r = m.nx + 1
  for (let j = 0; j < m.ny; j++) for (let i = 0; i < m.nx; i++) {
    const a = j * r + i, b = a + 1, c = a + r + 1, d = a + r
    yield [a, b, c] as const
    yield [a, c, d] as const
  }
}

/** Affine map taking triangle (p0, p1, p2) to (q0, q1, q2), as [a, b, c, d, e, f] with x' = a x + c y + e, y' = b x + d y + f. */
function triAffine(p: number[], q: number[]): number[] | null {
  const [x0, y0, x1, y1, x2, y2] = p, [u0, v0, u1, v1, u2, v2] = q
  const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
  if (Math.abs(det) < 1e-12) return null
  const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det
  const c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det
  const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det
  const d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det
  return [a, b, c, d, u0 - a * x0 - c * y0, v0 - b * x0 - d * y0]
}

/**
 * Rasterises src (RGBA, sw × sh) through the mesh into dst (RGBA, dw × dh), replacing the pixels the mesh covers.
 * Sampling is bilinear on premultiplied colour, so transparent edges don't darken. Outside the source,
 * edge 'clear' reads transparent pixels (layers) and 'clamp' repeats the border (masks).
 */
export function rasterMesh(src: Uint8ClampedArray, sw: number, sh: number, dst: Uint8ClampedArray, dw: number, dh: number, m: Mesh, edge: 'clear' | 'clamp' = 'clear') {
  const S = m.src, D = m.dst
  for (const t of triangles(m)) {
    const P = [D[t[0] * 2], D[t[0] * 2 + 1], D[t[1] * 2], D[t[1] * 2 + 1], D[t[2] * 2], D[t[2] * 2 + 1]]
    const Q = [S[t[0] * 2], S[t[0] * 2 + 1], S[t[1] * 2], S[t[1] * 2 + 1], S[t[2] * 2], S[t[2] * 2 + 1]]
    const A = triAffine(P, Q)
    if (!A) continue
    const x0 = Math.max(0, Math.floor(Math.min(P[0], P[2], P[4]))), x1 = Math.min(dw - 1, Math.ceil(Math.max(P[0], P[2], P[4])))
    const y0 = Math.max(0, Math.floor(Math.min(P[1], P[3], P[5]))), y1 = Math.min(dh - 1, Math.ceil(Math.max(P[1], P[3], P[5])))
    if (x0 > x1 || y0 > y1) continue
    // Edge functions, oriented so the inside is positive whichever way the triangle winds.
    const area = (P[2] - P[0]) * (P[5] - P[1]) - (P[4] - P[0]) * (P[3] - P[1])
    const sg = area < 0 ? -1 : 1
    const E = [[0, 2], [2, 4], [4, 0]].map(([i, j]) => [P[i], P[i + 1], P[j] - P[i], P[j + 1] - P[i + 1]])
    const eps = -1e-7
    for (let y = y0; y <= y1; y++) {
      const Y = y + 0.5
      for (let x = x0; x <= x1; x++) {
        const X = x + 0.5
        let inside = true
        for (const [ex, ey, dx, dy] of E) if (sg * (dx * (Y - ey) - dy * (X - ex)) < eps) { inside = false; break }
        if (!inside) continue
        const u = A[0] * X + A[2] * Y + A[4] - 0.5, v = A[1] * X + A[3] * Y + A[5] - 0.5
        const ix = Math.floor(u), iy = Math.floor(v), fx = u - ix, fy = v - iy
        let r = 0, g = 0, b = 0, a = 0
        for (let k = 0; k < 4; k++) {
          let px = ix + (k & 1), py = iy + (k >> 1)
          const w = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy)
          if (!w) continue
          if (px < 0 || py < 0 || px >= sw || py >= sh) {
            if (edge === 'clear') continue
            px = Math.min(sw - 1, Math.max(0, px)); py = Math.min(sh - 1, Math.max(0, py))
          }
          const o = (py * sw + px) * 4, al = src[o + 3] * w
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al
        }
        const o = (y * dw + x) * 4
        if (a > 0) { dst[o] = r / a; dst[o + 1] = g / a; dst[o + 2] = b / a; dst[o + 3] = a + 0.5 }
        else { dst[o] = dst[o + 1] = dst[o + 2] = dst[o + 3] = 0 }
      }
    }
  }
}

/**
 * Draws src through the mesh with canvas triangles, for a quick preview while dragging.
 * Each triangle is grown by a fraction of a pixel so neighbours overlap and no hairline seams show.
 */
export function drawMesh(x: CanvasRenderingContext2D, src: CanvasImageSource, m: Mesh) {
  const S = m.src, D = m.dst
  for (const t of triangles(m)) {
    const P = [D[t[0] * 2], D[t[0] * 2 + 1], D[t[1] * 2], D[t[1] * 2 + 1], D[t[2] * 2], D[t[2] * 2 + 1]]
    const Q = [S[t[0] * 2], S[t[0] * 2 + 1], S[t[1] * 2], S[t[1] * 2 + 1], S[t[2] * 2], S[t[2] * 2 + 1]]
    const A = triAffine(Q, P)
    if (!A) continue
    const cx = (P[0] + P[2] + P[4]) / 3, cy = (P[1] + P[3] + P[5]) / 3
    x.save()
    x.beginPath()
    for (let k = 0; k < 3; k++) {
      const dx = P[k * 2] - cx, dy = P[k * 2 + 1] - cy, l = Math.hypot(dx, dy) || 1
      const px = P[k * 2] + (dx / l) * 0.6, py = P[k * 2 + 1] + (dy / l) * 0.6
      k ? x.lineTo(px, py) : x.moveTo(px, py)
    }
    x.closePath()
    x.clip()
    x.setTransform(A[0], A[1], A[2], A[3], A[4], A[5])
    const sx = Math.max(0, Math.floor(Math.min(Q[0], Q[2], Q[4])) - 1), sy = Math.max(0, Math.floor(Math.min(Q[1], Q[3], Q[5])) - 1)
    const ex = Math.ceil(Math.max(Q[0], Q[2], Q[4])) + 1, ey = Math.ceil(Math.max(Q[1], Q[3], Q[5])) + 1
    const iw = (src as HTMLCanvasElement).width, ih = (src as HTMLCanvasElement).height
    const w = Math.min(iw, ex) - sx, h = Math.min(ih, ey) - sy
    if (w > 0 && h > 0) x.drawImage(src, sx, sy, w, h, sx, sy, w, h)
    x.restore()
  }
}

/** The (u, v) in [0, 1]² of the mesh under destination point (x, y), or null when it is outside the mesh. */
export function locate(m: Mesh, x: number, y: number): [number, number] | null {
  const D = m.dst, r = m.nx + 1
  let best: [number, number] | null = null
  for (const t of triangles(m)) {
    const [a, b, c] = t
    const x0 = D[a * 2], y0 = D[a * 2 + 1], x1 = D[b * 2], y1 = D[b * 2 + 1], x2 = D[c * 2], y2 = D[c * 2 + 1]
    const det = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
    if (Math.abs(det) < 1e-12) continue
    const l0 = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / det
    const l1 = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / det
    const l2 = 1 - l0 - l1
    if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue
    const uv = (k: number) => [(k % r) / m.nx, Math.floor(k / r) / m.ny]
    const [ua, va] = uv(a), [ub, vb] = uv(b), [uc, vc] = uv(c)
    // A folded mesh can cover a point twice; the later (upper) triangle wins, as it does when drawing.
    best = [l0 * ua + l1 * ub + l2 * uc, l0 * va + l1 * vb + l2 * vc]
  }
  return best
}
