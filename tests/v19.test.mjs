import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, next) {
  if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/i.test(s)) { try { return await next(s + '.ts', c) } catch {} }
  return next(s, c)
}`))

const { curveLUT, curvesTable, gradientTable, rng } = await import('../src/core/px.ts')
const { cloneAdjust, freshAdjust, curveIdentity } = await import('../src/core/doc.ts')
const { snapBox, snapValue } = await import('../src/core/snap.ts')

test('a straight curve leaves every value as it is', () => {
  const lut = curveLUT([0, 0, 255, 255])
  for (let i = 0; i < 256; i++) assert.ok(Math.abs(lut[i] * 255 - i) < 1e-3)
})

test('curves pass through their points and stay in range', () => {
  const pts = [0, 0, 64, 40, 192, 216, 255, 255]
  const lut = curveLUT(pts)
  assert.ok(Math.abs(lut[64] * 255 - 40) < 0.5)
  assert.ok(Math.abs(lut[192] * 255 - 216) < 0.5)
  assert.ok(lut.every(v => v >= 0 && v <= 1))
  // An S-curve darkens shadows and lightens highlights.
  assert.ok(lut[32] * 255 < 32 && lut[224] * 255 > 224)
})

test('curve points out of order give the same curve', () => {
  assert.deepEqual([...curveLUT([255, 255, 0, 0, 128, 180])], [...curveLUT([0, 0, 128, 180, 255, 255])])
})

test('a negative curve inverts, and the channel curves apply after RGB', () => {
  const t = curvesTable([[0, 255, 255, 0], [0, 0, 255, 255], [0, 0, 255, 255], [0, 0, 255, 255]])
  assert.equal(t[0], 255); assert.equal(t[255 * 4], 0)
  const t2 = curvesTable([[0, 0, 255, 255], [0, 255, 255, 0], [0, 0, 255, 255], [0, 0, 255, 255]])
  assert.equal(t2[0], 255); assert.equal(t2[1], 0)
})

test('gradient tables reach their end colours, and reverse swaps them', () => {
  const stops = [{ p: 0, c: '#000000' }, { p: 1, c: '#ff8000' }]
  const t = gradientTable(stops)
  assert.deepEqual([...t.slice(0, 3)], [0, 0, 0])
  assert.deepEqual([...t.slice(255 * 4, 255 * 4 + 3)], [255, 128, 0])
  const r = gradientTable(stops, true)
  assert.deepEqual([...r.slice(0, 3)], [255, 128, 0])
})

test('the seeded random numbers repeat for the same seed', () => {
  const a = rng(42), b = rng(42), c = rng(43)
  const A = [a(), a(), a()], B = [b(), b(), b()], C = [c(), c(), c()]
  assert.deepEqual(A, B)
  assert.notDeepEqual(A, C)
  assert.ok(A.every(v => v >= 0 && v < 1))
})

test('older projects get default curves and gradient map', () => {
  const old = { ...freshAdjust() }
  delete old.curves; delete old.gmap
  const a = cloneAdjust(old)
  assert.equal(a.curves.length, 4)
  assert.ok(a.curves.every(curveIdentity))
  assert.equal(a.gmap.on, false)
  // A copy shares nothing with the original.
  const b = cloneAdjust(a)
  b.curves[0][1] = 9; b.gmap.stops[0].c = '#123456'
  assert.equal(a.curves[0][1], 0); assert.equal(a.gmap.stops[0].c, '#000000')
})

test('a moved box snaps its nearest edge or centre to a target', () => {
  const box = { x: 100, y: 100, w: 200, h: 100 }
  const t = { x: [0, 500, 1000], y: [0, 300, 600] }
  // Centre x 200 + 296 = 496, close to 500.
  const s = snapBox(box, 296, 0, t, 6)
  assert.equal(s.dx, 300)
  assert.deepEqual(s.lines, [{ x: 500 }])
  // Too far from anything: no snap.
  const n = snapBox(box, 50, 50, t, 6)
  assert.equal(n.dx, 50); assert.equal(n.dy, 50); assert.equal(n.lines.length, 0)
  // Bottom edge 200 + 97 = 297, close to 300.
  assert.equal(snapBox(box, 0, 97, t, 6).dy, 100)
})

test('a single value snaps only within the tolerance', () => {
  assert.equal(snapValue(497, [0, 500], 5), 500)
  assert.equal(snapValue(490, [0, 500], 5), 490)
})
