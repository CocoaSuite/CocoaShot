import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// src/ imports drop the .ts extension (Vite resolves them); teach Node to do the same.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, next) {
  if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/i.test(s)) { try { return await next(s + '.ts', c) } catch {} }
  return next(s, c)
}`))
const { gridOver, warpAt, warpInfluence, splineWeights, quadMapper, convex, buildMesh, rasterMesh, locate } = await import('../src/core/warp.ts')
const { Steps } = await import('../src/core/steps.ts')

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`)

test('spline weights sum to one and hit the knots exactly', () => {
  for (const n of [1, 2, 3, 5]) for (const t of [0, 0.13, 0.5, 0.77, 1]) near(splineWeights(n, t).reduce((s, v) => s + v, 0), 1)
  const w = splineWeights(4, 0.5)
  assert.deepEqual([...w].map(v => Math.round(v * 1e9) / 1e9), [0, 0, 1, 0, 0])
})

test('an untouched warp grid leaves every point where it was', () => {
  const b = { x: 10, y: 20, w: 300, h: 150 }
  const g = gridOver(b, 3, 3)
  for (const [u, v] of [[0, 0], [0.2, 0.9], [0.5, 0.5], [1, 1], [0.95, 0.05]]) {
    const [x, y] = warpAt(g, 3, 3, u, v)
    near(x, b.x + b.w * u, 1e-6); near(y, b.y + b.h * v, 1e-6)
  }
})

test('the warp surface passes through moved grid points', () => {
  const g = gridOver({ x: 0, y: 0, w: 90, h: 90 }, 3, 3)
  g[(1 * 4 + 1) * 2] += 17; g[(1 * 4 + 1) * 2 + 1] -= 9
  const [x, y] = warpAt(g, 3, 3, 1 / 3, 1 / 3)
  near(x, 47, 1e-6); near(y, 21, 1e-6)
})

test('dragging the surface with influence weights moves the grabbed spot by exactly the drag', () => {
  const g = gridOver({ x: 0, y: 0, w: 100, h: 100 }, 3, 3)
  const u = 0.41, v = 0.63, d = [12, -7]
  const w = warpInfluence(3, 3, u, v)
  const ss = w.reduce((s, x) => s + x * x, 0)
  const before = warpAt(g, 3, 3, u, v)
  const moved = g.slice()
  for (let i = 0; i < w.length; i++) { moved[i * 2] += d[0] * w[i] / ss; moved[i * 2 + 1] += d[1] * w[i] / ss }
  const after = warpAt(moved, 3, 3, u, v)
  near(after[0] - before[0], d[0], 1e-6); near(after[1] - before[1], d[1], 1e-6)
})

test('distort corners map exactly, with perspective for convex quads', () => {
  const q = [0, 0, 100, 10, 90, 80, 5, 100]
  assert.ok(convex(q))
  const f = quadMapper(q)
  for (let i = 0; i < 4; i++) { const [x, y] = f([0, 1, 1, 0][i], [0, 0, 1, 1][i]); near(x, q[i * 2], 1e-6); near(y, q[i * 2 + 1], 1e-6) }
  assert.ok(!convex([0, 0, 100, 0, 20, 20, 0, 100]))
  const g = quadMapper([0, 0, 100, 0, 20, 20, 0, 100])
  near(g(1, 1)[0], 20, 1e-9)
})

test('rasterising through an identity mesh copies the pixels', () => {
  const w = 8, h = 6, src = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) src.set([i * 5, 255 - i * 3, (i * 37) % 256, 255], i * 4)
  const dst = new Uint8ClampedArray(w * h * 4)
  rasterMesh(src, w, h, dst, w, h, buildMesh({ x: 0, y: 0, w, h }, 4, 3, (u, v) => [u * w, v * h]))
  assert.deepEqual([...dst], [...src])
})

test('rasterising through a shifted mesh moves the content and leaves the rest alone', () => {
  const w = 10, h = 10, src = new Uint8ClampedArray(w * h * 4)
  for (let y = 2; y < 4; y++) for (let x = 2; x < 4; x++) src.set([255, 0, 0, 255], (y * w + x) * 4)
  const dst = new Uint8ClampedArray(w * h * 4).fill(7)
  rasterMesh(src, w, h, dst, w, h, buildMesh({ x: 2, y: 2, w: 2, h: 2 }, 2, 2, (u, v) => [5 + u * 2, 6 + v * 2]))
  assert.deepEqual([...dst.slice((6 * w + 5) * 4, (6 * w + 5) * 4 + 4)], [255, 0, 0, 255])
  assert.deepEqual([...dst.slice((7 * w + 6) * 4, (7 * w + 6) * 4 + 4)], [255, 0, 0, 255])
  assert.deepEqual([...dst.slice(0, 4)], [7, 7, 7, 7])
})

test('locate finds where a point sits on a mesh', () => {
  const m = buildMesh({ x: 0, y: 0, w: 200, h: 100 }, 8, 8, (u, v) => [u * 200, v * 100])
  const [u, v] = locate(m, 50, 75)
  near(u, 0.25, 1e-9); near(v, 0.75, 1e-9)
  assert.equal(locate(m, 250, 50), null)
})

test('tool steps undo and redo one action at a time', () => {
  let pts = []
  let changes = 0
  const s = new Steps(() => pts.slice(), v => { pts = v }, () => changes++)
  for (const p of [1, 2, 3]) { s.mark(); pts.push(p) }
  assert.ok(s.undo()); assert.deepEqual(pts, [1, 2])
  assert.ok(s.undo()); assert.deepEqual(pts, [1])
  assert.ok(s.redo()); assert.deepEqual(pts, [1, 2])
  s.mark(); pts.push(9)
  assert.ok(!s.redo())
  assert.ok(s.undo() && s.undo() && s.undo()); assert.deepEqual(pts, [])
  assert.ok(!s.undo())
  assert.ok(changes > 0)
})
