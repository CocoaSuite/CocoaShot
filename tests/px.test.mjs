import test from 'node:test'
import assert from 'node:assert/strict'
import { boxBlur, morph, contours, flood, inpaint, resizeLanczos, homography, histogramStats, maskPipeline, blackToAlpha } from '../src/core/px.ts'

test('box blur keeps a flat image flat', () => {
  const a = new Float32Array(100).fill(0.5)
  assert.ok(boxBlur(a, 10, 10, 2).every(v => Math.abs(v - 0.5) < 1e-6))
})

test('morph grows and shrinks a square', () => {
  const w = 20, a = new Float32Array(w * w)
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) a[y * w + x] = 1
  const sum = f => f.reduce((s, v) => s + v, 0)
  assert.equal(sum(morph(a, w, w, 2)), 64)
  assert.equal(sum(morph(a, w, w, -1)), 4)
})

test('contours trace one closed loop around a blob', () => {
  const w = 16, a = new Uint8Array(w * w)
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) a[y * w + x] = 255
  const l = contours(a, w, w)
  assert.equal(l.length, 1)
  const xs = l[0].filter((_, i) => i % 2 === 0)
  assert.ok(Math.min(...xs) >= 3 && Math.max(...xs) <= 12)
})

test('flood fill respects tolerance and connectivity', () => {
  const w = 4, d = new Uint8ClampedArray(w * w * 4).fill(255)
  for (let y = 0; y < 4; y++) d.set([0, 0, 0, 255], (y * w + 2) * 4)
  const m = flood(d, w, w, 0, 0, 10, true)
  assert.equal(m.filter(v => v).length, 8)
  assert.equal(flood(d, w, w, 0, 0, 10, false).filter(v => v).length, 12)
})

test('inpaint fills the hole from its surroundings', () => {
  const w = 10, d = new Uint8ClampedArray(w * w * 4)
  for (let i = 0; i < w * w; i++) d.set([200, 100, 50, 255], i * 4)
  const m = new Uint8Array(w * w)
  for (let y = 3; y < 7; y++) for (let x = 3; x < 7; x++) { m[y * w + x] = 255; d.set([0, 0, 0, 255], (y * w + x) * 4) }
  const o = inpaint(d, m, w, w)
  const c = (5 * w + 5) * 4
  assert.deepEqual([o[c], o[c + 1], o[c + 2]], [200, 100, 50])
})

test('lanczos resize keeps solid colour and alpha', () => {
  const d = new Uint8ClampedArray(8 * 8 * 4)
  for (let i = 0; i < 64; i++) d.set([10, 20, 30, 255], i * 4)
  const o = resizeLanczos(d, 8, 8, 3, 5)
  assert.equal(o.length, 60)
  for (let i = 0; i < 15; i++) assert.deepEqual([...o.slice(i * 4, i * 4 + 4)], [10, 20, 30, 255])
})

test('homography maps corners', () => {
  const H = homography([0, 0, 10, 0, 10, 10, 0, 10], [1, 1, 20, 2, 18, 15, 2, 12])
  const map = (x, y) => { const z = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / z, (H[3] * x + H[4] * y + H[5]) / z] }
  const [u, v] = map(10, 10)
  assert.ok(Math.abs(u - 18) < 1e-6 && Math.abs(v - 15) < 1e-6)
})

test('histogram stats find levels', () => {
  const d = new Uint8ClampedArray(64 * 64 * 4)
  for (let i = 0; i < 64 * 64; i++) { const v = 40 + (i % 160); d.set([v, v, v, 255], i * 4) }
  const s = histogramStats(d)
  assert.ok(s.llo >= 40 && s.lhi <= 200)
})

test('mask pipeline feathers edges', () => {
  const w = 20, a = new Float32Array(w * w)
  for (let i = 0; i < w * w; i++) a[i] = i % w < 10 ? 1 : 0
  const m = maskPipeline(a, w, w, { feather: 2, smooth: 0, shift: 0 })
  assert.ok(m[10 * w + 9] < 1 && m[10 * w + 9] > 0.3 && m[10 * w + 10] > 0 && m[10 * w + 10] < 0.7)
})

import { levelsLUT, levelsIdentity, histograms, autoRange, editAlpha, ALPHA0 } from '../src/core/px.ts'

test('levels map input and output ranges with gamma', () => {
  const id = levelsLUT([0, 255, 1, 0, 255])
  assert.ok(Math.abs(id[128] - 128 / 255) < 1e-6)
  assert.ok(levelsIdentity([0, 255, 1, 0, 255]) && !levelsIdentity([10, 255, 1, 0, 255]))
  const lut = levelsLUT([50, 200, 1, 0, 255])
  assert.equal(lut[50], 0); assert.equal(lut[200], 1); assert.equal(lut[10], 0); assert.equal(lut[250], 1)
  const out = levelsLUT([0, 255, 1, 64, 191])
  assert.ok(Math.abs(out[0] - 64 / 255) < 1e-6 && Math.abs(out[255] - 191 / 255) < 1e-6)
  assert.ok(levelsLUT([0, 255, 2, 0, 255])[128] > 0.6)
})

test('histograms count alpha for every pixel and colour only for visible ones', () => {
  const d = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0])
  const [l, r, , , a] = histograms(d, 1)
  assert.equal(a[255], 1); assert.equal(a[0], 1); assert.equal(r[255], 1); assert.equal(r[0], 0)
  assert.equal(l.reduce((s, v) => s + v, 0), 1)
  const h = new Uint32Array(256); h[20] = 50; h[230] = 50
  assert.deepEqual(autoRange(h), [20, 230])
})

test('alpha edits apply levels, hard edges, invert and selection limits', () => {
  const a = new Uint8Array([0, 64, 128, 255])
  assert.deepEqual([...editAlpha(a, 4, 1, ALPHA0)], [0, 64, 128, 255])
  assert.deepEqual([...editAlpha(a, 4, 1, { ...ALPHA0, invert: true })], [255, 191, 127, 0])
  assert.deepEqual([...editAlpha(a, 4, 1, { ...ALPHA0, hard: true })], [0, 0, 255, 255])
  assert.deepEqual([...editAlpha(a, 4, 1, { ...ALPHA0, lv: [0, 128, 1, 0, 255] })], [0, 128, 255, 255])
  assert.deepEqual([...editAlpha(a, 4, 1, { ...ALPHA0, lv: [0, 255, 1, 255, 255] }, new Uint8Array([255, 0, 255, 0]))], [255, 64, 255, 255])
})

test('black to transparency keeps hue and turns black clear', () => {
  const d = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 64, 0, 255])
  assert.deepEqual([...blackToAlpha(d)], [0, 0, 0, 0, 255, 255, 255, 255, 255, 128, 0, 128])
  assert.deepEqual([...blackToAlpha(d, new Uint8Array([0, 0, 0]))], [...d])
})
