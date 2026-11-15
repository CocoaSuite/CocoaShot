let w: Worker | null = null
let seq = 0
const pending = new Map<number, { res: (v: any) => void; rej: (e: any) => void }>()

function worker() {
  if (w) return w
  w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = e => {
    const p = pending.get(e.data.id)
    if (!p) return
    pending.delete(e.data.id)
    e.data.ok ? p.res(e.data.out) : p.rej(new Error(e.data.err))
  }
  return w
}

export function job<T = any>(op: string, a: any, transfer: Transferable[] = []): Promise<T> {
  const id = ++seq
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    worker().postMessage({ id, op, a }, transfer)
  })
}

export function cancelJobs() {
  if (!w) return
  w.terminate()
  w = null
  for (const p of pending.values()) p.rej(new Error('Cancelled'))
  pending.clear()
}
