import type { App } from '../app'
import type { Tool } from './types'
import { cropDoc, flip, perspectiveDoc, resizeDoc, rotate90 } from '../core/transform'
import { h, icon, tip, toast } from '../ui/dom'
import { btn, hint, numField, sec, seg, select, slider, toggle } from '../ui/controls'
import { selectionBBox } from './select'
import { jobBox } from './common'
import type { Viewport } from '../view/viewport'
import { toolSteps } from '../core/steps'

const RATIOS: [string, string, number | null, number?, number?][] = [
  ['free', 'Free', null], ['orig', 'Original', -1], ['1:1', 'Square', 1], ['16:9', '16:9', 16 / 9], ['4:3', '4:3', 4 / 3], ['3:2', '3:2', 3 / 2], ['9:16', '9:16', 9 / 16],
  ['ig', 'Instagram post 1080 × 1350', 4 / 5, 1080, 1350], ['igs', 'Instagram story 1080 × 1920', 9 / 16, 1080, 1920],
  ['yt', 'YouTube thumbnail 1280 × 720', 16 / 9, 1280, 720], ['x', 'X post 1600 × 900', 16 / 9, 1600, 900],
  ['fb', 'Facebook cover 1640 × 624', 1640 / 624, 1640, 624], ['li', 'LinkedIn banner 1584 × 396', 4, 1584, 396], ['custom', 'Custom size', 0]
]

export function cropTools(app: App): Tool[] {
  const st = { r: { x: 0, y: 0, w: 0, h: 0 }, ratio: 'free', angle: 0, cw: 1080, ch: 1080, drag: null as any }
  const ratioVal = () => {
    const d = app.doc!
    const it = RATIOS.find(r => r[0] === st.ratio)!
    if (it[2] === -1) return d.w / d.h
    if (it[2] === 0) return st.cw / st.ch
    return it[2]
  }
  // Every box drag, ratio or straighten change is an undo step until the crop is applied.
  const cropSteps = toolSteps(app, () => ({ r: { ...st.r }, angle: st.angle, ratio: st.ratio }), v => { st.r = v.r; st.angle = v.angle; st.ratio = v.ratio; app.emit('crop-rect') })
  const reset = () => { const d = app.doc; if (d) st.r = { x: 0, y: 0, w: d.w, h: d.h }; st.angle = 0; fitRatio(); cropSteps.reset(); app.view.draw() }
  const fitRatio = () => {
    const d = app.doc, k = ratioVal()
    if (!d || !k) return
    const cx = st.r.x + st.r.w / 2, cy = st.r.y + st.r.h / 2
    let w = st.r.w, hh = w / k
    if (hh > d.h || hh > st.r.h * 1.0001) { hh = Math.min(st.r.h, d.h); w = hh * k }
    if (w > d.w) { w = d.w; hh = w / k }
    st.r = { x: Math.max(0, Math.min(d.w - w, cx - w / 2)), y: Math.max(0, Math.min(d.h - hh, cy - hh / 2)), w, h: hh }
  }
  const out = () => {
    const it = RATIOS.find(r => r[0] === st.ratio)!
    if (it[2] === 0) return [st.cw, st.ch]
    return it[3] ? [it[3], it[4]] : [undefined, undefined]
  }
  const handlesOf = (v: Viewport) => {
    const a = v.toScreen(st.r.x, st.r.y), b = v.toScreen(st.r.x + st.r.w, st.r.y + st.r.h)
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    return [[a.x, a.y, 'nw'], [mx, a.y, 'n'], [b.x, a.y, 'ne'], [b.x, my, 'e'], [b.x, b.y, 'se'], [mx, b.y, 's'], [a.x, b.y, 'sw'], [a.x, my, 'w']] as [number, number, string][]
  }
  const apply = () => {
    const d = app.doc!
    if (st.r.w < 1 || st.r.h < 1) return
    const [ow, oh] = out()
    cropDoc(d, app.hist!, st.r, st.angle, ow as number | undefined, oh as number | undefined)
    reset()
    app.view.fit()
  }
  app.on('crop-to-selection', () => {
    const d = app.doc
    const b = d && selectionBBox(d)
    if (!b) { toast('Make a selection first'); return }
    cropDoc(d!, app.hist!, b)
    reset(); app.view.fit()
  })
  app.on('doc', reset)

  let straightening = false
  const crop: Tool = {
    id: 'crop', label: 'Crop', icon: 'crop', steps: cropSteps,
    activate: reset,
    cursor(p) {
      if (!p) return 'crosshair'
      const hd = handlesOf(app.view).find(([x, y]) => Math.hypot(x - p.sx, y - p.sy) < 9)
      if (hd) return hd[2] + '-resize'
      const r = st.r
      return p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h ? 'move' : 'crosshair'
    },
    down(p) {
      const hd = handlesOf(app.view).find(([x, y]) => Math.hypot(x - p.sx, y - p.sy) < 9)
      const r = st.r
      const inside = p.x > r.x && p.y > r.y && p.x < r.x + r.w && p.y < r.y + r.h
      st.drag = { kind: hd ? hd[2] : inside ? 'move' : 'new', x: p.x, y: p.y, r: { ...r } }
      cropSteps.mark()
    },
    move(p, pressed) {
      if (!pressed || !st.drag) return
      const d = app.doc!, g = st.drag, o = g.r
      const dx = p.x - g.x, dy = p.y - g.y
      let { x, y, w, h: hh } = o
      const k = ratioVal()
      if (g.kind === 'move') { x = Math.max(0, Math.min(d.w - w, o.x + dx)); y = Math.max(0, Math.min(d.h - hh, o.y + dy)) }
      else if (g.kind === 'new') {
        x = Math.min(g.x, p.x); y = Math.min(g.y, p.y); w = Math.abs(dx); hh = Math.abs(dy)
        if (k) { hh = w / k; if (p.y < g.y) y = g.y - hh }
      } else {
        const K = g.kind
        if (K.includes('e')) w = o.w + dx
        if (K.includes('w')) { w = o.w - dx; x = o.x + dx }
        if (K.includes('s')) hh = o.h + dy
        if (K.includes('n')) { hh = o.h - dy; y = o.y + dy }
        if (k) {
          if (K === 'n' || K === 's') { w = hh * k; x = o.x + (o.w - w) / 2 }
          else { const nh = w / k; if (K.includes('n')) y = o.y + o.h - nh; else if (K === 'e' || K === 'w') y = o.y + (o.h - nh) / 2; hh = nh }
        }
      }
      if (w < 1 || hh < 1) return
      x = Math.max(0, x); y = Math.max(0, y)
      w = Math.min(w, d.w - x); hh = Math.min(hh, d.h - y)
      st.r = { x, y, w, h: hh }
      app.emit('crop-rect')
    },
    up() {
      const g = st.drag
      st.drag = null
      if (g && g.r.x === st.r.x && g.r.y === st.r.y && g.r.w === st.r.w && g.r.h === st.r.h) cropSteps.unmark()
    },
    dbl: apply,
    key(e) { if (e.key === 'Enter') { apply(); return true } if (e.key === 'Escape') { reset(); return true } return false },
    overlay(x, v) {
      const d = app.doc
      if (!d) return
      const a = v.toScreen(st.r.x, st.r.y), w = st.r.w * v.zoom, hh = st.r.h * v.zoom
      x.save()
      if (st.angle) {
        const c = v.toScreen(st.r.x + st.r.w / 2, st.r.y + st.r.h / 2)
        const o = v.toScreen(0, 0)
        x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--desk')
        x.fillRect(o.x - 1, o.y - 1, d.w * v.zoom + 2, d.h * v.zoom + 2)
        x.translate(c.x, c.y); x.rotate((-st.angle * Math.PI) / 180); x.translate(-c.x, -c.y)
        x.drawImage(d.comp, o.x, o.y, d.w * v.zoom, d.h * v.zoom)
        x.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      }
      x.fillStyle = 'rgba(0,0,0,.55)'
      const o = v.toScreen(0, 0), W = d.w * v.zoom, H = d.h * v.zoom
      x.beginPath(); x.rect(o.x - 4000, o.y - 4000, W + 8000, H + 8000); x.rect(a.x, a.y, w, hh); x.fill('evenodd')
      x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(a.x + 0.5, a.y + 0.5, w, hh)
      x.strokeStyle = 'rgba(255,255,255,.35)'
      x.beginPath()
      for (const f of [1 / 3, 2 / 3]) { x.moveTo(a.x + w * f, a.y); x.lineTo(a.x + w * f, a.y + hh); x.moveTo(a.x, a.y + hh * f); x.lineTo(a.x + w, a.y + hh * f) }
      x.stroke()
      x.fillStyle = '#fff'
      for (const [hx, hy] of handlesOf(v)) x.fillRect(hx - 4, hy - 4, 8, 8)
      x.restore()
    },
    panel() {
      const d = app.doc!
      const [ow, oh] = out()
      const size = h('span', { class: 'hint' }, `${Math.round(st.r.w)} × ${Math.round(st.r.h)} px` + (ow ? `, saved as ${ow} × ${oh}` : ''))
      app.on('crop-rect', () => { size.textContent = `${Math.round(st.r.w)} × ${Math.round(st.r.h)} px` + (out()[0] ? `, saved as ${out()[0]} × ${out()[1]}` : '') })
      const cw = numField('Width', () => st.cw, v => { st.cw = v; fitRatio(); app.view.draw() })
      const ch = numField('Height', () => st.ch, v => { st.ch = v; fitRatio(); app.view.draw() })
      const custom = h('div', { class: 'g2', hidden: st.ratio !== 'custom' }, cw.el, ch.el)
      return h('div', { class: 'ib' },
        sec('Crop'),
        select('Ratio', RATIOS.map(r => [r[0], r[1]] as [string, string]), () => st.ratio, v => { cropSteps.mark(); st.ratio = v; custom.hidden = v !== 'custom'; fitRatio(); app.view.draw(); app.emit('crop-rect') }),
        custom, size,
        slider('Straighten', () => st.angle, v => { if (!straightening) { straightening = true; cropSteps.mark() } st.angle = v; app.view.draw() }, { min: -45, max: 45, step: 0.1, def: 0, onEnd: () => { straightening = false } }),
        h('div', { class: 'g2' }, btn('Reset', reset), h('button', { class: 'pri', onclick: apply }, 'Apply crop')),
        sec('Rotate and flip'),
        h('div', { class: 'g2' },
          h('button', { onclick: () => { rotate90(d, app.hist!, -1); reset(); app.view.fit() } }, icon('rotl'), 'Rotate left'),
          h('button', { onclick: () => { rotate90(d, app.hist!, 1); reset(); app.view.fit() } }, icon('rotr'), 'Rotate right'),
          h('button', { onclick: () => { flip(d, app.hist!, true); reset() } }, icon('fliph'), 'Flip horizontal'),
          h('button', { onclick: () => { flip(d, app.hist!, false); reset() } }, icon('flipv'), 'Flip vertical')))
    }
  }

  const rs = { w: 0, h: 0, pct: 100, keep: true, unit: 'px' as 'px' | '%', method: 'lanczos' }
  const resize: Tool = {
    id: 'resize', label: 'Resize', icon: 'resize',
    activate() { const d = app.doc; if (d) { rs.w = d.w; rs.h = d.h; rs.pct = 100 } },
    panel() {
      const d = app.doc!
      if (!rs.w) { rs.w = d.w; rs.h = d.h }
      const W = numField('Width', () => rs.w, v => { rs.w = v; if (rs.keep) rs.h = Math.max(1, Math.round(v * d.h / d.w)); H.input.value = String(rs.h); rs.pct = Math.round(rs.w / d.w * 100); P.input.value = String(rs.pct) })
      const H = numField('Height', () => rs.h, v => { rs.h = v; if (rs.keep) rs.w = Math.max(1, Math.round(v * d.w / d.h)); W.input.value = String(rs.w); rs.pct = Math.round(rs.h / d.h * 100); P.input.value = String(rs.pct) })
      const P = numField('Percent', () => rs.pct, v => { rs.pct = v; rs.w = Math.max(1, Math.round(d.w * v / 100)); rs.h = Math.max(1, Math.round(d.h * v / 100)); W.input.value = String(rs.w); H.input.value = String(rs.h) }, 1, 1000)
      const go = () => app.run('Resizing', async p => {
        if (rs.w * rs.h > 400e6) throw new Error('That size is too large')
        await resizeDoc(d, app.hist!, rs.w, rs.h, rs.method, p)
        app.view.fit()
      })
      return h('div', { class: 'ib' },
        sec('Resize image'), hint(`Currently ${d.w} × ${d.h} px.`),
        h('div', { class: 'g3' }, W.el, H.el, P.el),
        toggle('Keep aspect ratio', () => rs.keep, v => (rs.keep = v)),
        select('Quality', [['lanczos', 'Best (Lanczos)'], ['bilinear', 'Smooth'], ['nearest', 'Pixel art']], () => rs.method as any, v => (rs.method = v)),
        h('div', { class: 'g3' }, ...[50, 200, 300].map(p => btn(p + '%', () => { P.input.value = String(p); P.input.dispatchEvent(new Event('change')) }))),
        jobBox(app),
        h('button', { class: 'pri big wide', onclick: go }, 'Apply resize'),
        hint('To add detail when enlarging photos, use Upscale in AI Tools.'))
    }
  }

  let quad: number[] = []
  let dragI = -1, moved = false
  const perspSteps = toolSteps(app, () => quad.slice(), v => { quad = v })
  const persp: Tool = {
    id: 'persp', label: 'Perspective', icon: 'persp', steps: perspSteps,
    activate() { const d = app.doc; if (d) quad = [0, 0, d.w, 0, d.w, d.h, 0, d.h]; perspSteps.reset() },
    cursor: () => 'crosshair',
    down(p) {
      dragI = -1; moved = false
      for (let i = 0; i < 4; i++) { const s = app.view.toScreen(quad[i * 2], quad[i * 2 + 1]); if (Math.hypot(s.x - p.sx, s.y - p.sy) < 12) dragI = i }
      if (dragI >= 0) perspSteps.mark()
    },
    move(p, pressed) { if (pressed && dragI >= 0) { quad[dragI * 2] = p.x; quad[dragI * 2 + 1] = p.y; moved = true } },
    up() { if (dragI >= 0 && !moved) perspSteps.unmark(); dragI = -1 },
    overlay(x, v) {
      if (quad.length < 8) return
      x.save()
      x.strokeStyle = '#8AA7D9'; x.lineWidth = 1.5
      x.beginPath()
      for (let i = 0; i < 4; i++) { const s = v.toScreen(quad[i * 2], quad[i * 2 + 1]); i ? x.lineTo(s.x, s.y) : x.moveTo(s.x, s.y) }
      x.closePath(); x.stroke()
      x.strokeStyle = 'rgba(138,167,217,.4)'; x.lineWidth = 1
      for (const f of [1 / 3, 2 / 3]) {
        const L = (a: number, b: number) => [quad[a * 2] + (quad[b * 2] - quad[a * 2]) * f, quad[a * 2 + 1] + (quad[b * 2 + 1] - quad[a * 2 + 1]) * f]
        for (const [p, q] of [[L(0, 1), L(3, 2)], [L(0, 3), L(1, 2)]]) { const s1 = v.toScreen(p[0], p[1]), s2 = v.toScreen(q[0], q[1]); x.beginPath(); x.moveTo(s1.x, s1.y); x.lineTo(s2.x, s2.y); x.stroke() }
      }
      for (let i = 0; i < 4; i++) { const s = v.toScreen(quad[i * 2], quad[i * 2 + 1]); x.fillStyle = '#fff'; x.beginPath(); x.arc(s.x, s.y, 6, 0, Math.PI * 2); x.fill(); x.stroke() }
      x.restore()
    },
    panel: () => h('div', { class: 'ib' }, sec('Perspective correction'),
      hint('Drag the four corners onto the edges of something that should be rectangular, like a document, sign or screen. Apply straightens it.'),
      jobBox(app),
      h('div', { class: 'g2' }, btn('Reset', () => { persp.activate!(); app.view.draw() }),
        h('button', { class: 'pri', onclick: () => app.run('Correcting perspective', async () => { await perspectiveDoc(app.doc!, app.hist!, quad); persp.activate!(); app.view.fit() }) }, 'Apply')))
  }
  return [crop, resize, persp]
}
