import { denoise, gray, guided, inpaint, resizeLanczos, warpPerspective } from './px'

self.onmessage = (e: MessageEvent) => {
  const { id, op, a } = e.data
  try {
    let out: any
    if (op === 'lanczos') out = resizeLanczos(a.data, a.w, a.h, a.dw, a.dh)
    else if (op === 'inpaint') out = inpaint(a.data, a.mask, a.w, a.h)
    else if (op === 'denoise') out = denoise(a.data, a.w, a.h, a.strength)
    else if (op === 'warp') out = warpPerspective(a.data, a.w, a.h, a.quad, a.dw, a.dh)
    else if (op === 'refine') {
      const n = a.w * a.h
      const I = gray(a.data, n)
      const p = new Float32Array(n)
      for (let i = 0; i < n; i++) p[i] = a.mask[i] / 255
      const q = guided(I, p, a.w, a.h, a.r, a.eps)
      out = new Uint8Array(n)
      for (let i = 0; i < n; i++) out[i] = Math.max(0, Math.min(255, q[i] * 255))
    }
    ;(self as any).postMessage({ id, ok: true, out }, [out.buffer])
  } catch (err: any) {
    ;(self as any).postMessage({ id, ok: false, err: String(err?.message || err) })
  }
}
