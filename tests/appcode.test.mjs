import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const user = mkdtempSync(join(tmpdir(), 'cocoa-'))
let installed = '1.2.0'
const load = Module._load
Module._load = function (r, ...a) { return r === 'electron' ? { app: { getPath: () => user, getVersion: () => installed } } : load.call(this, r, ...a) }
const shellFile = fileURLToPath(new URL('../electron/shell-id.json', import.meta.url))
const hadShell = existsSync(shellFile) && readFileSync(shellFile, 'utf8')
writeFileSync(shellFile, JSON.stringify({ shell: 'abc' }))
const ac = require('../electron/appcode.cjs')
test.after(() => { if (hadShell) writeFileSync(shellFile, hadShell); else rmSync(shellFile); rmSync(user, { recursive: true, force: true }) })

const pack = (version, shell, files) => {
  const buf = gzipSync(Buffer.from(JSON.stringify({ app: 'CocoaShot', version, shell, files })))
  return { buf, m: { version, shell, sha256: createHash('sha256').update(buf).digest('hex') } }
}
const b64 = s => Buffer.from(s).toString('base64')

test('code updates install, run, and survive a confirmed start', async () => {
  const builtin = '/builtin'
  assert.equal(ac.chooseDist(builtin).dir, builtin)
  const { buf, m } = pack('1.3.0', 'abc', { 'index.html': b64('<p>new</p>'), 'assets/a.js': b64('x') })
  await ac.installBundle(buf, m)
  const c = ac.chooseDist(builtin)
  assert.equal(c.version, '1.3.0')
  assert.equal(readFileSync(join(c.dir, 'index.html'), 'utf8'), '<p>new</p>')
  ac.confirmStarted()
  assert.equal(ac.chooseDist(builtin).version, '1.3.0')
})

test('code that never confirms its start is dropped on the next start', async () => {
  const { buf, m } = pack('1.4.0', 'abc', { 'index.html': b64('broken') })
  await ac.installBundle(buf, m)
  assert.equal(ac.chooseDist('/b').version, '1.4.0')
  assert.equal(ac.chooseDist('/b').dir, '/b')
})

test('tampered, mismatched or unsafe bundles are refused', async () => {
  const good = pack('1.5.0', 'abc', { 'index.html': b64('ok') })
  await assert.rejects(ac.installBundle(good.buf, { ...good.m, sha256: '0'.repeat(64) }), /did not match/)
  const other = pack('1.5.0', 'zzz', { 'index.html': b64('ok') })
  await assert.rejects(ac.installBundle(other.buf, other.m), /does not fit/)
  const evil = pack('1.5.0', 'abc', { 'index.html': b64('ok'), '../../evil.js': b64('x') })
  await assert.rejects(ac.installBundle(evil.buf, evil.m), /unexpected file/)
})

test('a newer full install wins over older downloaded code', async () => {
  const { buf, m } = pack('1.6.0', 'abc', { 'index.html': b64('ok') })
  await ac.installBundle(buf, m)
  installed = '1.7.0'
  assert.equal(ac.chooseDist('/b').dir, '/b')
  assert.equal(existsSync(join(user, 'app-code')), false)
})
