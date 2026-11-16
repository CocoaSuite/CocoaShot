// Writes electron/shell-id.json: a fingerprint of everything a code-only update cannot replace
// (the Electron side of the app and its packages). A code update is offered only to installs
// whose fingerprint matches the one it was built with.
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')

export function shellId() {
  const h = createHash('sha256')
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  h.update(JSON.stringify({ deps: pkg.dependencies || {}, electron: pkg.devDependencies?.electron || '', overrides: pkg.overrides || {} }))
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).filter(e => e.name !== 'shell-id.json').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const name = rel + e.name
      if (e.isDirectory()) { walk(join(dir, e.name), name + '/'); continue }
      h.update(name + '\0')
      // Scripts are hashed as text so a checkout's line endings don't change the id; icons as bytes.
      if (/\.(c|m)?js$|\.json$/i.test(e.name)) h.update(readFileSync(join(dir, e.name), 'utf8').replace(/\r\n/g, '\n'))
      else h.update(readFileSync(join(dir, e.name)))
    }
  }
  walk(join(root, 'electron'), '')
  return h.digest('hex').slice(0, 16)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = shellId()
  writeFileSync(join(root, 'electron', 'shell-id.json'), JSON.stringify({ shell: id }) + '\n')
  console.log('shell id', id)
}
