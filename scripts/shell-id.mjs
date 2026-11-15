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
  for (const f of readdirSync(join(root, 'electron')).filter(f => f !== 'shell-id.json').sort()) {
    h.update(f + '\0')
    h.update(readFileSync(join(root, 'electron', f), 'utf8').replace(/\r\n/g, '\n'))
  }
  return h.digest('hex').slice(0, 16)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const id = shellId()
  writeFileSync(join(root, 'electron', 'shell-id.json'), JSON.stringify({ shell: id }) + '\n')
  console.log('shell id', id)
}
