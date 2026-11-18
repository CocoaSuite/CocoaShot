import { h, icon, tip } from './dom'
import { clamp, hex2rgb, rgb2hex } from '../core/util'
import { tr } from '../i18n'

export function rgb2hsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let hh = 0
  if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx]
}
export function hsv2rgb(hh: number, s: number, v: number) {
  const c = v * s, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

export interface ColorState { hex: string; alpha: number }

const RECENT_KEY = 'cocoashot.colors'
export function recentColors(): string[] { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
export function pushRecent(hex: string) {
  const l = [hex, ...recentColors().filter(c => c !== hex)].slice(0, 14)
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(l)) } catch {}
}

const PRESETS = ['#000000', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#30b0ff', '#8AA7D9', '#5856d6', '#af52de', '#ff2d55']

export function colorWheel(st: ColorState, onChange: (s: ColorState, final: boolean) => void, opts: { alpha?: boolean; pick?: () => void; size?: number } = {}) {
  const S = opts.size || 236
  const dpr = devicePixelRatio || 1
  const cv = h('canvas', { width: S * dpr, height: S * dpr, style: { width: S + 'px', height: S + 'px' } }) as HTMLCanvasElement
  const x = cv.getContext('2d')!
  let [hh, s, v] = rgb2hsv(...(hex2rgb(st.hex) as [number, number, number]))
  const R = S / 2, ring = 18, sq = (R - ring - 6) * Math.SQRT2
  const ring0 = R - ring
  let ringImg: ImageData | null = null

  const draw = () => {
    x.setTransform(dpr, 0, 0, dpr, 0, 0)
    x.clearRect(0, 0, S, S)
    if (!ringImg) {
      for (let a = 0; a < 360; a += 0.5) {
        x.beginPath()
        x.strokeStyle = `hsl(${a},100%,50%)`
        x.lineWidth = ring
        x.arc(R, R, R - ring / 2, ((a - 90.6) * Math.PI) / 180, ((a - 89.4) * Math.PI) / 180)
        x.stroke()
      }
      ringImg = x.getImageData(0, 0, S * dpr, S * dpr)
    } else x.putImageData(ringImg, 0, 0)
    const l = R - sq / 2
    const gx = x.createLinearGradient(l, 0, l + sq, 0)
    gx.addColorStop(0, '#fff'); gx.addColorStop(1, `hsl(${hh},100%,50%)`)
    x.fillStyle = gx; x.fillRect(l, l, sq, sq)
    const gy = x.createLinearGradient(0, l, 0, l + sq)
    gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(1, '#000')
    x.fillStyle = gy; x.fillRect(l, l, sq, sq)
    const a = ((hh - 90) * Math.PI) / 180
    const mark = (px: number, py: number, r: number) => {
      x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2)
      x.lineWidth = 3; x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke()
      x.lineWidth = 1.5; x.strokeStyle = '#fff'; x.stroke()
    }
    mark(R + Math.cos(a) * (R - ring / 2), R + Math.sin(a) * (R - ring / 2), ring / 2 - 2)
    mark(l + s * sq, l + (1 - v) * sq, 6)
  }

  let mode: 'ring' | 'sq' | null = null
  const handle = (e: PointerEvent, final = false) => {
    const b = cv.getBoundingClientRect()
    const px = e.clientX - b.left, py = e.clientY - b.top
    const l = R - sq / 2
    if (!mode) {
      const d = Math.hypot(px - R, py - R)
      mode = d >= ring0 - 4 ? 'ring' : 'sq'
    }
    if (mode === 'ring') hh = ((Math.atan2(py - R, px - R) * 180) / Math.PI + 90 + 360) % 360
    else { s = clamp((px - l) / sq, 0, 1); v = clamp(1 - (py - l) / sq, 0, 1) }
    emit(final)
  }
  const emit = (final: boolean) => {
    st.hex = rgb2hex(...(hsv2rgb(hh, s, v) as [number, number, number]))
    draw(); syncFields()
    onChange(st, final)
  }
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); mode = null; handle(e) })
  cv.addEventListener('pointermove', e => { if (cv.hasPointerCapture(e.pointerId)) handle(e) })
  cv.addEventListener('pointerup', e => { if (cv.hasPointerCapture(e.pointerId)) { handle(e, true); mode = null; pushRecent(st.hex); drawChips() } })

  const hexIn = h('input', { type: 'text', value: st.hex, style: { width: '86px', fontVariantNumeric: 'tabular-nums' }, 'aria-label': tr('Hex colour') }) as HTMLInputElement
  const nums = [0, 1, 2].map(i => h('input', { type: 'number', min: 0, max: 255, 'aria-label': 'RGB'[i] }) as HTMLInputElement)
  const syncFields = () => {
    hexIn.value = st.hex
    hex2rgb(st.hex).forEach((c, i) => (nums[i].value = String(c)))
    if (abar) { abar.style.background = `linear-gradient(to right, transparent, ${st.hex}), repeating-conic-gradient(#999 0 25%, #ddd 0 50%) 0 0/10px 10px`; knob.style.left = st.alpha * 100 + '%' }
  }
  const setHex = (hx: string) => {
    if (!/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hx)) { syncFields(); return }
    st.hex = rgb2hex(...(hex2rgb(hx) as [number, number, number]))
    ;[hh, s, v] = rgb2hsv(...(hex2rgb(st.hex) as [number, number, number]))
    draw(); syncFields(); onChange(st, true); pushRecent(st.hex); drawChips()
  }
  hexIn.addEventListener('change', () => setHex(hexIn.value.startsWith('#') ? hexIn.value : '#' + hexIn.value))
  nums.forEach(n => n.addEventListener('change', () => setHex(rgb2hex(+nums[0].value, +nums[1].value, +nums[2].value))))

  let abar: HTMLDivElement | null = null
  const knob = h('i')
  if (opts.alpha) {
    abar = h('div', { class: 'alphabar', role: 'slider', 'aria-label': tr('Opacity') }, knob)
    const ah = (e: PointerEvent, fin: boolean) => {
      const b = abar!.getBoundingClientRect()
      st.alpha = clamp((e.clientX - b.left) / b.width, 0, 1)
      syncFields(); onChange(st, fin)
    }
    abar.addEventListener('pointerdown', e => { abar!.setPointerCapture(e.pointerId); ah(e, false) })
    abar.addEventListener('pointermove', e => { if (abar!.hasPointerCapture(e.pointerId)) ah(e, false) })
    abar.addEventListener('pointerup', e => ah(e, true))
  }

  const chips = h('div', { class: 'cwchips' })
  const drawChips = () => {
    chips.innerHTML = ''
    const rc = recentColors()
    for (const c of [...rc, ...PRESETS.filter(p => !rc.includes(p))].slice(0, 20)) {
      const b = h('button', { style: { background: c }, onclick: () => setHex(c) })
      tip(b, c)
      chips.appendChild(b)
    }
  }

  draw(); syncFields(); drawChips()
  const el = h('div', { class: 'cw' },
    h('div', { style: { display: 'flex', justifyContent: 'center' } }, cv),
    abar,
    h('div', { class: 'cwrow' }, hexIn, ...nums,
      opts.pick && tip(h('button', { class: 'ic', onclick: opts.pick }, icon('dropper')), tr('Pick a colour from the image'))),
    chips)
  ;(el as any).set = (hx: string) => { st.hex = hx; [hh, s, v] = rgb2hsv(...(hex2rgb(hx) as [number, number, number])); draw(); syncFields() }
  return el
}
