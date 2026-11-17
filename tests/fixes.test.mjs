import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, next) {
  if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/i.test(s)) { try { return await next(s + '.ts', c) } catch {} }
  return next(s, c)
}`))

// Just enough of a canvas for text measuring: 10 px per character.
globalThis.document ??= { createElement: () => ({ getContext: () => ({ font: '', measureText: t => ({ width: t.length * 10 }) }) }) }

const { makeLayer } = await import('../src/core/doc.ts')
const { History } = await import('../src/core/history.ts')
const { warpPerspective } = await import('../src/core/px.ts')
const { transformShape, shapeCenter, newShape } = await import('../src/core/shapes.ts')
const { fingerprint } = await import('../src/core/util.ts')

function fakeDoc() {
  const d = {
    w: 10, h: 10, layers: [], activeId: '', selection: null, original: { width: 10, height: 10 }, comp: { width: 10, height: 10 }, modified: false,
    emit() {}, structure() { this.modified = true }, layer(id) { return this.layers.find(l => l.id === id) }
  }
  const l = makeLayer('paint', 'a', 10, 10, false)
  l.canvas = { width: 100, height: 100 }
  d.layers.push(l); d.activeId = l.id
  return d
}

test('undoing back to the saved step clears "edited", and redoing past it sets it again', () => {
  const d = fakeDoc(), h = new History(d)
  const step = () => h.push({ label: 's', undo() {}, redo() {}, size: 1 })
  step(); h.markClean(); d.modified = false
  step(); d.modified = true
  h.undo(); assert.equal(d.modified, false)
  h.undo(); assert.equal(d.modified, true)
  h.redo(); assert.equal(d.modified, false)
})

test('a history that started unsaved is never clean by undoing', () => {
  const d = fakeDoc(); d.modified = true
  const h = new History(d)
  h.push({ label: 's', undo() {}, redo() {}, size: 1 })
  h.undo(); assert.equal(d.modified, true)
})

test('structural steps count the canvases they replace towards the memory limit', () => {
  const d = fakeDoc(), h = new History(d)
  const before = { w: 10, h: 10, active: d.activeId, selection: null, original: d.original, layers: d.layers.map(l => ({ ref: l, p: { ...l, maskOpts: { ...l.maskOpts } } })) }
  d.layers[0].canvas = { width: 100, height: 100 }
  h.structural('Crop', before)
  assert.ok(h.past[0].size >= 2 * 100 * 100 * 4, 'both the old and the new canvas are counted')
})

test('perspective warping does not darken edges next to transparent pixels', () => {
  // A red pixel beside a transparent black one, sampled halfway between them.
  const src = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0])
  const out = warpPerspective(src, 2, 1, [0.5, 0, 2.5, 0, 2.5, 1, 0.5, 1], 2, 1)
  assert.equal(out[0], 255)
  assert.equal(out[1], 0)
  assert.ok(out[3] > 100 && out[3] < 160)
})

test('flipping the image keeps text upright and centred on its mirrored place', () => {
  const s = newShape('text', 10, 20, '#000', 1)
  s.text = 'Hello'
  const c0 = shapeCenter(s)
  const W = 200
  transformShape(s, (x, y) => [W - x, y], 1, 0, true)
  const c1 = shapeCenter(s)
  assert.ok(Math.abs(c1.x - (W - c0.x)) < 1e-6)
  assert.ok(Math.abs(c1.y - c0.y) < 1e-6)
  assert.equal(s.rot, 0)
})

test('rotating the image turns rotatable shapes with it', () => {
  const s = newShape('rect', 0, 0, '#000', 1)
  s.x2 = 40; s.y2 = 20; s.rot = 10
  transformShape(s, (x, y) => [100 - y, x], 1, Math.PI / 2, false)
  assert.ok(Math.abs(s.rot - 100) < 1e-6)
  assert.deepEqual([s.x2 - s.x1, s.y2 - s.y1], [40, 20])
})

test('the image fingerprint changes when a pixel changes', () => {
  const a = new Uint8Array(4000).fill(7)
  const f = fingerprint(a)
  a[0] = 8
  assert.notEqual(fingerprint(a), f)
})
