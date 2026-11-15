type Attrs = Record<string, any>
type Child = Node | string | number | null | undefined | false | Child[]

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, a?: Attrs | Child, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  if (a && (typeof a !== 'object' || a instanceof Node || Array.isArray(a))) kids.unshift(a as Child)
  else if (a) for (const k in a as Attrs) {
    const v = (a as Attrs)[k]
    if (v == null || v === false) continue
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
    else if (k === 'class') el.className = v
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
    else if (k in el && k !== 'list' && k !== 'form') (el as any)[k] = v
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  add(el, kids)
  return el
}

function add(el: Node, kids: Child[]) {
  for (const c of kids) {
    if (c == null || c === false) continue
    if (Array.isArray(c)) add(el, c)
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)))
  }
}

const P: Record<string, string> = {
  open: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  save: 'M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 21v-7h10v7M7 3v5h8',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  minus: 'M5 12h14',
  plus: 'M12 5v14M5 12h14',
  fit: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  compare: 'M4 4h16v16H4zM12 2v20',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  select: 'M5 3l6 17 2.2-7 6.8-2.2z',
  crop: 'M6 2v14h14M2 6h14v14',
  bg: 'M3 21l11-11M14 4l1 3 3 1-3 1-1 3-1-3-3-1 3-1zM19 13l.6 1.4L21 15l-1.4.6L19 17l-.6-1.4L17 15l1.4-.6z',
  outline: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18',
  paint: 'M18 3l3 3-10 10-3-3zM7 14c-3 0-4 2-4 4 0 1.5-1 2.5-1 2.5s5 0 7-2c1.2-1.2.8-3.5-2-4.5',
  adjust: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  ai: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  text: 'M4 7V4h16v3M9 20h6M12 4v16',
  eye: 'M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6',
  eyeoff: 'M3 3l18 18M10.6 5.1A10.5 10.5 0 0 1 12 5c7 0 11 7 11 7a18 18 0 0 1-3.2 3.9M6.6 6.6C3.4 8.6 1 12 1 12s4 7 11 7a10.6 10.6 0 0 0 5.4-1.5M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.8-1.2',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21',
  layers: 'M12 2l10 5-10 5L2 7zM2 17l10 5 10-5M2 12l10 5 10-5',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  shape: 'M3 3h8v8H3zM17 7a4 4 0 1 0 0 .01M7 14l4 7H3z',
  dropper: 'M2 22l1-4L14.5 6.5l3 3L6 21zM14 4l2-2 6 6-2 2',
  bucket: 'M19 11l-8-8-8.5 8.5a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0zM5 2l5 5M2 13h15M22 20a2 2 0 1 1-4 0c0-1.6 2-4 2-4s2 2.4 2 4z',
  swap: 'M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8',
  x: 'M18 6L6 18M6 6l12 12',
  check: 'M20 6L9 17l-5-5',
  chev: 'M6 9l6 6 6-6',
  link: 'M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8',
  rotl: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5',
  rotr: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  fliph: 'M12 3v18M16 7l4 5-4 5zM8 7l-4 5 4 5z',
  flipv: 'M3 12h18M7 8l5-4 5 4zM7 16l5 4 5-4z',
  clip: 'M7 4v10a5 5 0 0 0 5 5h8M17 15l3 4-3 4',
  alpha: 'M4 4h16v16H4zM4 12h16M12 4v16',
  wand: 'M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5',
  lasso: 'M7 22a5 5 0 0 1-2-4M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 5c5 0 9 3.1 9 7s-4 7-9 7-9-3.1-9-7 4-7 9-7z',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  arrow: 'M5 19L19 5M10 5h9v9',
  line: 'M5 19L19 5',
  callout: 'M4 4h16v12H9l-5 4z',
  label: 'M3 7h13l5 5-5 5H3z',
  marker: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18M10 9l2-1v8',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  folder: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  spot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  hl: 'M9 11l-6 6v3h9l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4',
  persp: 'M6 4h12l3 16H3z',
  resize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  pencil: 'M17 3l4 4L7 21H3v-4z',
  eraser: 'M20 20H8l-5-5a2 2 0 0 1 0-2.8L13.2 2a2 2 0 0 1 2.8 0L21 7a2 2 0 0 1 0 2.8L11 20M6 11l7 7',
  clone: 'M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 2v4M12 18v4M2 12h4M18 12h4',
  blur: 'M12 2.7C12 2.7 5 10 5 14a7 7 0 0 0 14 0c0-4-7-11.3-7-11.3z',
  sharpen: 'M12 2l9 18H3z',
  smudge: 'M8 13V4.5a1.5 1.5 0 0 1 3 0V12M11 11.5V3a1.5 1.5 0 0 1 3 0v8.5M14 10.5a1.5 1.5 0 0 1 3 0V12M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15',
  brush: 'M18 3l3 3-10 10-3-3zM7 14c-3 0-4 2-4 4 0 1.5-1 2.5-1 2.5s5 0 7-2c1.2-1.2.8-3.5-2-4.5',
  heal: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  up: 'M12 19V5M5 12l7-7 7 7',
  sparkle: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  download: 'M12 3v12M7 10l5 5 5-5M5 21h14'
}

export function icon(name: string, cls = 'i') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('class', cls)
  s.setAttribute('aria-hidden', 'true')
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  p.setAttribute('d', P[name] || P.x)
  if (name === 'outline') p.setAttribute('stroke-dasharray', '3 3')
  s.appendChild(p)
  return s
}

export function logo(): SVGElement {
  const t = document.createElement('template')
  t.innerHTML = `<svg viewBox="-2 -2 56 60" aria-hidden="true"><path d="M44 6C39.5 1.9 34.5 0 28 0C12.5 0 0 12.5 0 28C0 43.5 12.5 56 28 56C34.5 56 39.5 54.1 44 50L36 40C33.8 42 31.3 43 28 43C19.7 43 13 36.3 13 28C13 19.7 19.7 13 28 13C31.3 13 33.8 14 36 16L44 6Z" fill="#8AA7D9"/><circle cx="28" cy="28" r="7.5" fill="none" stroke="#8AA7D9" stroke-width="5"/><circle cx="46" cy="28" r="4" fill="#8AA7D9"/></svg>`
  return t.content.firstChild as SVGElement
}

let tipEl: HTMLDivElement | null = null
let tipT = 0
export function tip<T extends HTMLElement>(el: T, text: string): T {
  el.setAttribute('aria-label', text)
  el.addEventListener('mouseenter', () => {
    clearTimeout(tipT)
    tipT = window.setTimeout(() => {
      tipEl?.remove()
      const r = el.getBoundingClientRect()
      tipEl = h('div', { class: 'tip' }, text)
      document.body.appendChild(tipEl)
      const tw = tipEl.offsetWidth
      tipEl.style.left = Math.max(6, Math.min(innerWidth - tw - 6, r.left + r.width / 2 - tw / 2)) + 'px'
      tipEl.style.top = (r.bottom + 6 > innerHeight - 30 ? r.top - 30 : r.bottom + 6) + 'px'
    }, 450)
  })
  const hide = () => { clearTimeout(tipT); tipEl?.remove(); tipEl = null }
  el.addEventListener('mouseleave', hide)
  el.addEventListener('mousedown', hide)
  return el
}

export function toast(msg: string, opts: { err?: boolean; action?: string; onAction?: () => void; ms?: number } = {}) {
  let box = document.getElementById('toasts')
  if (!box) { box = h('div', { id: 'toasts' }); document.body.appendChild(box) }
  const t = h('div', { class: 'toast' + (opts.err ? ' err' : '') }, h('span', { class: 'sp' }, msg),
    opts.action && h('button', { onclick: () => { opts.onAction?.(); t.remove() } }, opts.action))
  box.appendChild(t)
  setTimeout(() => t.remove(), opts.ms || (opts.action ? 8000 : 3200))
}

export function modal(build: (close: () => void) => HTMLElement, wide = false, onClose?: () => void) {
  const m = h('div', { class: 'modal' })
  const close = () => { m.remove(); document.removeEventListener('keydown', key, true); onClose?.() }
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
  const box = h('div', { class: 'box' + (wide ? ' wide' : ''), role: 'dialog' }, build(close))
  m.appendChild(box)
  m.addEventListener('mousedown', e => { if (e.target === m) close() })
  document.addEventListener('keydown', key, true)
  document.body.appendChild(m)
  return close
}

export function confirmBox(title: string, text: string, yes: string, no = 'Cancel', extra?: string): Promise<'yes' | 'no' | 'extra'> {
  return new Promise(res => {
    let v: 'yes' | 'no' | 'extra' = 'no'
    modal(close => h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
      h('h2', title), h('p', { class: 'hint', style: { fontSize: '13px' } }, text),
      h('div', { class: 'row' },
        extra && h('button', { class: 'danger', onclick: () => { v = 'extra'; close() } }, extra), h('span', { class: 'sp' }),
        h('button', { onclick: () => { v = 'no'; close() } }, no),
        h('button', { class: 'pri', onclick: () => { v = 'yes'; close() } }, yes))), false, () => res(v))
  })
}
