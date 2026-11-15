// Packs dist/ into a small code-only update: release/cocoashot-app-<version>.json.gz plus
// release/cocoashot-app.json describing it. Run after `npm run build`.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { shellId } from './shell-id.mjs'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const dist = join(root, 'dist')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const files = {}
const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walk(p); else files[relative(dist, p).split(sep).join('/')] = readFileSync(p).toString('base64') } }
walk(dist)
const shell = shellId()
const data = gzipSync(Buffer.from(JSON.stringify({ app: 'CocoaShot', version, shell, files })), { level: 9 })
const name = `cocoashot-app-${version}.json.gz`
mkdirSync(join(root, 'release'), { recursive: true })
writeFileSync(join(root, 'release', name), data)
const manifest = { version, shell, file: name, size: data.length, sha256: createHash('sha256').update(data).digest('hex') }
writeFileSync(join(root, 'release', 'cocoashot-app.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(manifest)
