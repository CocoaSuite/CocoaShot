import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// src/ imports drop the .ts extension (Vite resolves them); teach Node to do the same.
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(s, c, next) {
  if (/^\\.\\.?\\//.test(s) && !/\\.[a-z]+$/i.test(s)) { try { return await next(s + '.ts', c) } catch {} }
  return next(s, c)
}`))
const { makeLayer, normalizeTree, moveLayer, subtree, shownVisible, childrenOf, normFx, fxActive } = await import('../src/core/doc.ts')
const { distanceTo } = await import('../src/core/px.ts')

/** A document with just what the folder code uses, so no canvas is needed. */
function fakeDoc(names) {
  const layers = names.map(([name, kind = 'paint']) => { const l = makeLayer(kind, name, 1, 1, false); l.id = name; return l })
  return { layers, layer(id) { return this.layers.find(l => l.id === id) } }
}
const order = d => d.layers.map(l => l.id + (l.parent ? '<' + l.parent : '')).join(' ')

test('folders sit directly above their contents after normalizing', () => {
  const d = fakeDoc([['F', 'group'], ['a'], ['b'], ['c']])
  d.layer('a').parent = 'F'; d.layer('c').parent = 'F'
  normalizeTree(d)
  assert.equal(order(d), 'a<F c<F F b')
})

test('broken and circular parent links fall back to the top level', () => {
  const d = fakeDoc([['a'], ['G', 'group'], ['H', 'group']])
  d.layer('a').parent = 'missing'
  d.layer('G').parent = 'H'; d.layer('H').parent = 'G'
  normalizeTree(d)
  assert.equal(d.layer('a').parent, null)
  assert.ok(d.layer('G').parent === null || d.layer('H').parent === null)
  assert.equal(d.layers.length, 3)
})

test('moving into, above and below folders, and a folder never into itself', () => {
  const d = fakeDoc([['bg'], ['x'], ['F', 'group']])
  assert.ok(moveLayer(d, 'x', 'F', 'into'))
  assert.equal(order(d), 'bg x<F F')
  d.layers.push(Object.assign(makeLayer('group', 'G', 1, 1, false), { id: 'G' }))
  assert.ok(moveLayer(d, 'G', 'x', 'above'))
  assert.equal(order(d), 'bg x<F G<F F')
  assert.equal(moveLayer(d, 'F', 'G', 'into'), false)
  assert.ok(moveLayer(d, 'F', 'bg', 'below'))
  assert.equal(order(d), 'x<F G<F F bg')
  assert.deepEqual(subtree(d, d.layer('F')).map(l => l.id), ['x', 'G', 'F'])
})

test('a hidden folder hides what is inside it', () => {
  const d = fakeDoc([['a'], ['F', 'group']])
  d.layer('a').parent = 'F'
  d.layer('F').visible = false
  assert.equal(shownVisible(d, d.layer('a')), false)
  assert.deepEqual(childrenOf(d, 'F').map(l => l.id), ['a'])
})

test('effects from older projects get every setting filled in', () => {
  const f = normFx({ stroke: { on: true, size: 3 } })
  assert.equal(f.stroke.size, 3)
  assert.equal(f.stroke.position, 'outside')
  assert.equal(f.shadow.on, false)
  assert.ok(fxActive(f))
  assert.equal(normFx(null), null)
})

test('distance transform measures straight-line distance to the nearest seed', () => {
  const w = 9, h = 7
  const d = distanceTo(i => i === 3 * w + 4, w, h)
  assert.equal(d[3 * w + 4], 0)
  assert.equal(d[3 * w + 7], 3)
  assert.ok(Math.abs(d[0] - 5) < 1e-6)
  assert.ok(distanceTo(() => false, 4, 4).every(v => v > 1e5))
})
