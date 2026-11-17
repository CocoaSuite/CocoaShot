import type { App } from '../app'
import { h } from './dom'

/**
 * First launch: "hello" is written in one stroke over the blurred app, with the CocoaSuite hello sound,
 * then a short tour of the Classic interface that points at each part of the real window, ending with
 * the choice of Photoshop or SAI style. The same as CocoaCanvas's welcome, without its Safari limits:
 * the desktop app may play sound straight away.
 */

const SEEN = 'cocoashot.onb'
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches
const wait = (ms: number) => new Promise(r => setTimeout(r, RM() ? 0 : ms))

// The handwritten greeting, one continuous stroke in each language (the same lettering as CocoaCanvas).
const HELLO: Record<Lang, { vb: string; d: string }> = {
  en: { vb: '0 0 360 180', d: 'M14 132 C 34 112, 64 60, 64 34 C 64 14, 46 14, 41 38 C 36 68, 36 116, 34 148 C 41 114, 56 94, 74 94 C 91 94, 91 114, 89 134 C 88 149, 96 151, 108 144 C 121 137, 141 124, 141 109 C 141 97, 124 97, 118 111 C 111 129, 121 151, 141 149 C 161 147, 176 129, 186 109 C 201 79, 211 44, 206 29 C 201 17, 186 24, 184 54 C 182 89, 184 129, 196 147 C 206 157, 221 144, 231 124 C 246 89, 254 49, 248 29 C 242 17, 228 24, 227 54 C 225 89, 227 129, 239 147 C 249 157, 264 147, 274 131 C 281 111, 296 99, 311 101 C 331 104, 331 144, 308 149 C 288 153, 281 127, 296 109 C 304 101, 318 99, 334 104' },
  ru: { vb: '0 0 450 210', d: 'M10 142 C 18 124, 26 106, 32 96 C 31 116, 29 134, 28 150 C 33 122, 44 96, 58 96 C 72 96, 70 122, 69 150 C 74 132, 84 112, 94 96 C 93 130, 91 165, 89 192 C 88 160, 91 122, 101 106 C 111 94, 128 96, 128 116 C 128 140, 106 150, 96 138 C 108 146, 124 136, 134 116 C 137 108, 139 101, 141 96 C 139 120, 135 150, 151 150 C 167 150, 177 120, 183 96 C 181 120, 177 150, 193 150 C 203 150, 210 138, 216 122 C 222 102, 232 64, 228 44 C 224 26, 206 34, 208 64 C 210 94, 212 124, 216 146 C 222 156, 244 154, 248 136 C 251 122, 240 116, 228 120 C 244 114, 252 104, 248 94 C 244 84, 226 92, 218 104 C 232 128, 250 134, 264 128 C 282 122, 290 110, 288 102 C 286 92, 268 94, 263 110 C 257 128, 266 150, 284 150 C 298 150, 306 136, 312 120 C 316 108, 320 100, 324 96 C 322 118, 320 136, 319 150 C 323 122, 332 96, 344 96 C 356 96, 356 122, 354 150 C 358 122, 368 96, 380 96 C 392 96, 392 122, 390 150 C 394 152, 404 146, 412 132' }
}

type Lang = 'en' | 'ru'
/**
 * Languages the interface is translated into. The greeting follows the computer's language among these,
 * so adding 'ru' here (with the Russian interface) makes it write «Привет» on Russian systems.
 */
export const UI_LANGS: Lang[] = ['en']
/** The language to greet in: the first of the system's preferred languages that CocoaShot speaks, else English. */
export function uiLang(): Lang {
  const prefs = [...(navigator.languages || []), navigator.language].filter(Boolean)
  for (const l of prefs) { const k = l.slice(0, 2).toLowerCase() as Lang; if (UI_LANGS.includes(k)) return k }
  return 'en'
}

const A = 'var(--brand)'
const F = '<circle class="oF" r="9" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-width="2"/>'
const key = (x: number, y: number, t: string, w = 34, d = 0) => `<g class="oKey" style="animation-delay:${d}s"><rect x="${x}" y="${y}" width="${w}" height="34" rx="7" fill="#262626" stroke="#555" stroke-width="1.5"/><text x="${x + w / 2}" y="${y + 22}" text-anchor="middle" fill="#ddd" font-size="${t.length > 2 ? 12 : 15}" font-weight="600" font-family="Inter,system-ui,sans-serif">${t}</text></g>`

/** Small animated pictures for each step, drawn in a 240 × 120 box. */
const ILL: Record<string, string> = {
  tools: `<rect x="30" y="10" width="86" height="100" rx="10" fill="#1c1c1c" stroke="#444" stroke-width="1.5"/>${[0, 1, 2, 3, 4].map(i => `<rect x="40" y="${20 + i * 18}" width="${[52, 60, 44, 56, 48][i]}" height="8" rx="4" fill="${i === 2 ? A : '#555'}"/>`).join('')}<g class="oSub"><rect x="48" y="${20 + 2 * 18 + 12}" width="34" height="5" rx="2.5" fill="#888"/></g>${key(140, 26, 'B', 34, 0)}${key(180, 26, 'M', 34, .45)}${key(140, 66, 'C', 34, .9)}${key(180, 66, 'T', 34, 1.35)}`,
  canvas: `<rect x="20" y="12" width="200" height="96" rx="10" fill="#1c1c1c" stroke="#444" stroke-width="1.5"/><g class="oZoom"><rect x="92" y="38" width="56" height="44" rx="6" fill="rgba(138,167,217,.18)" stroke="${A}" stroke-width="2.5"/><path d="M100 74l14-16 10 10 8-8 10 14" fill="none" stroke="${A}" stroke-width="2" stroke-linejoin="round"/></g><g class="oPan">${F}</g>`,
  props: `<rect x="60" y="8" width="120" height="104" rx="10" fill="#1c1c1c" stroke="#444" stroke-width="1.5"/>${[0, 1, 2, 3].map(i => `<rect x="74" y="${26 + i * 22}" width="92" height="4" rx="2" fill="#444"/><circle class="oKnob" style="animation-delay:${i * .35}s" cx="${96 + i * 14}" cy="${28 + i * 22}" r="6" fill="#fff" stroke="${A}" stroke-width="2"/>`).join('')}`,
  layers: `${[0, 1, 2].map(i => `<g class="${i === 1 ? 'oLift' : ''}"><rect x="62" y="${22 + i * 28}" width="116" height="22" rx="6" fill="${i === 1 ? 'rgba(138,167,217,.22)' : '#262626'}" stroke="${i === 1 ? A : '#555'}" stroke-width="1.5"/><rect x="70" y="${28 + i * 28}" width="18" height="10" rx="2" fill="#666"/><rect x="96" y="${31 + i * 28}" width="${[48, 40, 56][i]}" height="5" rx="2.5" fill="#999"/></g>`).join('')}`,
  save: `<g class="oUp"><path d="M120 22v52M100 54l20 20 20-20" fill="none" stroke="${A}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></g>${['PNG', 'JPG', 'PDF', 'PSD'].map((t, i) => `<g class="oChip" style="animation-delay:${i * .3}s"><rect x="${32 + i * 46}" y="86" width="40" height="22" rx="6" fill="#262626" stroke="#555"/><text x="${52 + i * 46}" y="101" text-anchor="middle" fill="#ddd" font-size="10" font-weight="600" font-family="Inter,system-ui,sans-serif">${t}</text></g>`).join('')}`,
  styles: [0, 1, 2].map(i => {
    const x = 18 + i * 74
    const body = i === 0
      ? `<rect x="${x + 6}" y="22" width="16" height="76" rx="3" fill="#444"/><rect x="${x + 50}" y="22" width="12" height="76" rx="3" fill="#444"/>`
      : i === 1
        ? `<rect x="${x + 6}" y="22" width="6" height="76" rx="2" fill="#444"/><rect x="${x + 6}" y="14" width="56" height="5" rx="2" fill="#555"/><rect x="${x + 46}" y="22" width="16" height="76" rx="3" fill="#444"/>`
        : `<rect x="${x + 6}" y="22" width="12" height="76" rx="3" fill="#444"/><rect x="${x + 20}" y="22" width="12" height="76" rx="3" fill="#444"/>`
    return `<g class="oStyle" style="animation-delay:${i * .8}s"><rect x="${x}" y="8" width="68" height="96" rx="8" fill="#1c1c1c" stroke="#555" stroke-width="1.5"/>${body}</g>`
  }).join('')
}

type Step = { ill: string; title: string; text: string; at?: string }
const STEPS: Step[] = [
  { ill: 'tools', at: '#left #tools', title: 'Tools, grouped by task', text: 'Pick what you want to do, like Background or Crop & Resize, then the tool under it. Keys work too: B brush, M select, C crop, T text.' },
  { ill: 'canvas', at: '#desk', title: 'Your image', text: 'Drop an image here or paste one. Hold Space and drag to move around, Ctrl and scroll to zoom, and Ctrl+Z steps back.' },
  { ill: 'props', at: '#right', title: 'Everything the tool can do', text: 'The selected tool’s settings appear here. History, next to Properties, takes you back to any step.' },
  { ill: 'layers', at: '#layersBox', title: 'Layers', text: 'Edits can live on their own layers. Drag to reorder, Ctrl- or Shift-click to pick several, and right-click for more.' },
  { ill: 'save', at: '#top .topc, #top > .pri', title: 'Save and export', text: 'Save project keeps layers, masks and text editable. Export makes a PNG, JPG, PDF, PSD and more. Everything stays on this computer.' },
  { ill: 'styles', title: 'Make it yours', text: 'This is the Classic layout. Prefer something familiar? Switch to Photoshop style or SAI style now, or any time in Settings, General.' }
]

let running = false

/** Shows the hello and the tour. Resolves when it closes. */
export function onboard(app: App): Promise<void> {
  if (running) return Promise.resolve()
  running = true
  return new Promise(done => {
    // The tour points at the Classic layout; another style comes back afterwards unless one is picked at the end.
    const prevStyle = app.settings.uiStyle || 'classic'
    let picked: string | null = null
    const setStyle = (s: string) => { if ((app.settings.uiStyle || 'classic') === s) return; app.settings.uiStyle = s as any; app.saveSettings(); app.emit('style') }

    const O = h('div', { id: 'onb', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Welcome to CocoaShot' })
    const W = HELLO[uiLang()]
    O.innerHTML = `<div class="onbHi" hidden></div><div class="onbH"><svg viewBox="${W.vb}" aria-hidden="true"><path d="${W.d}"/></svg><div class="onbTap">Click or press any key</div></div>
      <div class="onbC" hidden><div class="onbS"><div class="onbIll"><svg viewBox="0 0 240 120"></svg></div><h3></h3><p></p><div class="onbSt" hidden></div></div><div class="onbD">${STEPS.map(() => '<i></i>').join('')}</div><div class="onbR"><button class="onbSk">Skip</button><span class="sp"></span><button class="onbBk">Back</button><button class="pri onbNx"></button></div></div>`
    document.body.appendChild(O)
    const H = O.querySelector('.onbH') as HTMLElement, P = H.querySelector('path') as SVGPathElement
    const C = O.querySelector('.onbC') as HTMLElement, SS = C.querySelector('.onbS') as HTMLElement
    const HI = O.querySelector('.onbHi') as HTMLElement, ST = C.querySelector('.onbSt') as HTMLElement
    const tap = H.querySelector('.onbTap') as HTMLElement
    let i = -1, phase = -1

    const au = new Audio('/sounds/hello.mp3')
    au.volume = 0.85
    au.preload = 'auto'

    const len = P.getTotalLength()
    P.style.strokeDasharray = String(len)
    P.style.strokeDashoffset = String(RM() ? 0 : len)
    requestAnimationFrame(() => requestAnimationFrame(() => O.classList.add('on')))

    let goRes: () => void
    const going = new Promise<void>(r => (goRes = r))
    /** Writes "hello"; snd 1 = started by a click or key (play now), 2 = the sound is already playing. */
    const begin = (snd: 0 | 1 | 2) => {
      if (phase !== -1) return
      phase = 0
      tap.classList.remove('on')
      if (snd === 1) { try { au.currentTime = 0; au.play()?.catch(() => {}) } catch {} }
      P.style.transition = RM() ? '' : `stroke-dashoffset 2.9s cubic-bezier(.55,.1,.35,1) ${snd ? '.12s' : '.45s'}`
      P.style.strokeDashoffset = '0'
      goRes()
    }
    // The desktop app may play sound without a click first; a browser that refuses waits for one.
    setTimeout(() => {
      let pr: Promise<void> | undefined
      try { pr = au.play() } catch {}
      if (pr?.then) { let ok = false; pr.then(() => { if (phase !== -1) { au.pause(); return } ok = true; begin(2) }).catch(() => begin(0)); setTimeout(() => { if (!ok) begin(0) }, 250) }
      else begin(0)
    }, 450)

    /** Rings the part of the window a step is about (several parts make one ring), and puts the card beside it. */
    const point = (st: Step) => {
      let r: { left: number; top: number; right: number; bottom: number } | null = null
      if (st.at) for (const el of document.querySelectorAll(st.at) as NodeListOf<HTMLElement>) {
        if (el.offsetParent === null) continue
        const b = el.getBoundingClientRect()
        if (b.width < 4 || b.height < 4) continue
        r = r ? { left: Math.min(r.left, b.left), top: Math.min(r.top, b.top), right: Math.max(r.right, b.right), bottom: Math.max(r.bottom, b.bottom) } : { left: b.left, top: b.top, right: b.right, bottom: b.bottom }
      }
      O.classList.toggle('tour', !!r)
      if (!r) { HI.hidden = true; C.style.left = C.style.top = ''; C.classList.remove('side'); return }
      // The ring stays inside the window, even for panels that touch its edges.
      const pad = 6, L = Math.max(3, r.left - pad), T = Math.max(3, r.top - pad), R = Math.min(innerWidth - 3, r.right + pad), B = Math.min(innerHeight - 3, r.bottom + pad)
      HI.hidden = false
      Object.assign(HI.style, { left: L + 'px', top: T + 'px', width: R - L + 'px', height: B - T + 'px' })
      C.classList.add('side')
      const box = r
      // Placed once the card has its new text, so its real height is known.
      requestAnimationFrame(() => {
        const cw = C.offsetWidth || 400, ch = C.offsetHeight || 380, gap = 18, M = 12
        let x: number, y: number
        if (box.right + gap + cw < innerWidth - M) x = box.right + gap
        else if (box.left - gap - cw > M) x = box.left - gap - cw
        else x = (innerWidth - cw) / 2
        if (x === (innerWidth - cw) / 2) {
          // Below or above the part; a part that fills the window (the image area) gets the card inside, at its foot.
          if (box.bottom + gap + ch < innerHeight - M) y = box.bottom + gap
          else if (box.top - gap - ch > M) y = box.top - gap - ch
          else { x = (box.left + box.right) / 2 - cw / 2; y = box.bottom - ch - 28 }
        }
        else y = (box.top + box.bottom) / 2 - ch / 2
        C.style.left = Math.min(Math.max(M, x), innerWidth - cw - M) + 'px'
        C.style.top = Math.min(Math.max(M, y), innerHeight - ch - M) + 'px'
      })
    }

    const show = (n: number, dir: number) => {
      const st = STEPS[n]
      const fill = () => {
        ;(SS.querySelector('svg') as SVGElement).innerHTML = ILL[st.ill]
        SS.querySelector('h3')!.textContent = st.title
        SS.querySelector('p')!.textContent = st.text
        // The last step offers the three layouts right here.
        ST.hidden = st.ill !== 'styles'
        if (!ST.hidden) {
          ST.innerHTML = ''
          const cur = picked || 'classic'
          for (const [v, t] of [['classic', 'Classic'], ['ps', 'Photoshop style'], ['sai', 'SAI style']] as const) {
            const b = h('button', { class: v === cur ? 'on' : '', onclick: () => { picked = v; ST.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)) } }, t)
            ST.appendChild(b)
          }
        }
        C.querySelectorAll('.onbD i').forEach((d, k) => d.classList.toggle('on', k === n))
        ;(C.querySelector('.onbBk') as HTMLElement).style.visibility = n ? 'visible' : 'hidden'
        C.querySelector('.onbNx')!.textContent = n === STEPS.length - 1 ? 'Start editing' : 'Next'
        point(st)
      }
      if (i < 0 || RM()) { fill(); i = n; return }
      SS.style.setProperty('--sx', (dir > 0 ? -18 : 18) + 'px')
      SS.classList.add('sw')
      setTimeout(() => {
        fill()
        SS.style.setProperty('--sx', (dir > 0 ? 18 : -18) + 'px')
        SS.style.transition = 'none'; void SS.offsetWidth; SS.style.transition = ''
        SS.classList.remove('sw')
      }, 200)
      i = n
    }

    async function toCard() {
      if (phase) return
      phase = 1
      H.classList.add('out')
      if (prevStyle !== 'classic') setStyle('classic')
      await wait(380)
      H.remove()
      C.hidden = false
      show(0, 1)
      void C.offsetWidth
      C.classList.add('in')
      setTimeout(() => (C.querySelector('.onbNx') as HTMLElement).focus(), 300)
    }
    async function finish() {
      if (phase === 2) return
      phase = 2
      try { localStorage.setItem(SEEN, '1') } catch {}
      C.classList.remove('in'); C.classList.add('out')
      HI.hidden = true
      O.classList.remove('tour')
      await wait(300)
      setStyle(picked || prevStyle)
      O.classList.add('clear')
      await wait(950)
      O.remove()
      removeEventListener('keydown', onKey, true)
      removeEventListener('resize', onResize)
      running = false
      done()
    }
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation(); e.preventDefault()
      if (phase === -1) return begin(1)
      if (!phase) return void toCard()
      if (phase !== 1) return
      if (e.key === 'Escape') void finish()
      else if (e.key === 'ArrowRight' || e.key === 'Enter' || e.key === ' ') i < STEPS.length - 1 ? show(i + 1, 1) : void finish()
      else if (e.key === 'ArrowLeft' && i > 0) show(i - 1, -1)
    }
    const onResize = () => { if (phase === 1 && i >= 0) point(STEPS[i]) }
    addEventListener('keydown', onKey, true)
    addEventListener('resize', onResize)
    O.addEventListener('pointerdown', e => e.stopPropagation())
    O.addEventListener('click', e => {
      const t = e.target as HTMLElement
      if (phase === -1) return begin(1)
      if (!phase) return void toCard()
      if (t.closest('.onbSk')) return void finish()
      if (t.closest('.onbNx')) return i < STEPS.length - 1 ? show(i + 1, 1) : void finish()
      if (t.closest('.onbBk') && i > 0) show(i - 1, -1)
    })
    ;(async () => {
      await going
      await wait(3700)
      if (!phase) tap.classList.add('on')
      await wait(2600)
      if (!phase) void toCard()
    })()
  })
}

// Read when this module loads, before the app first saves its settings: no settings yet means a first launch.
const FRESH = (() => { try { return !localStorage.getItem('cocoashot.settings') } catch { return false } })()

/** Runs the welcome on the very first launch. People who already used CocoaShot are not shown it. */
export function firstLaunch(app: App) {
  let seen = false
  try { seen = !!localStorage.getItem(SEEN) } catch {}
  if (seen) return
  if (!FRESH) { try { localStorage.setItem(SEEN, '1') } catch {} return }
  setTimeout(() => void onboard(app), 300)
}
