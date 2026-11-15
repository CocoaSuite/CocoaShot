import { Adjust, LV0 } from './doc'
import { canvas, ctx2d, getData, putData, Rect } from './util'
import { gauss, levelsIdentity, levelsLUT } from './px'

const lvNorm = (a: Adjust) => (a.lv || LV0).map((v, i) => (i % 5 === 2 ? v : v / 255))

const VS = `#version 300 es
in vec2 p; out vec2 uv;
void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float;
in vec2 uv; out vec4 o;
uniform sampler2D t; uniform vec2 px;
uniform float exposure, brightness, contrast, highlights, shadows, whites, blacks, gam, temperature, tint, saturation, vibrance, hue, sharpness, clarity;
uniform float grayscale, sepia, invert;
uniform vec3 lvLo, lvHi;
uniform float lv[25];
float lev(float x, int k){
  float t = clamp((x - lv[k]) / max(lv[k + 1] - lv[k], 0.004), 0.0, 1.0);
  return lv[k + 3] + (lv[k + 4] - lv[k + 3]) * pow(t, 1.0 / max(lv[k + 2], 0.01));
}
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 blurAt(float r){
  vec3 s = vec3(0.0);
  for (int i = 0; i < 8; i++) { float a = float(i) * 0.785398; s += texture(t, uv + vec2(cos(a), sin(a)) * px * r).rgb; }
  return s / 8.0;
}
void main(){
  vec4 src = texture(t, uv);
  vec3 c = src.rgb;
  if (sharpness > 0.0) c += (c - blurAt(1.2)) * sharpness * 1.6;
  if (clarity != 0.0) { vec3 b = blurAt(14.0); float l = lum(c); c += (c - b) * clarity * 0.9 * (1.0 - pow(abs(l - 0.5) * 2.0, 2.0)); }
  c = (c - lvLo) / max(lvHi - lvLo, vec3(0.01));
  c = vec3(lev(c.r, 5), lev(c.g, 10), lev(c.b, 15));
  c = vec3(lev(c.r, 0), lev(c.g, 0), lev(c.b, 0));
  c *= exp2(exposure * 2.0);
  c.r *= 1.0 + temperature * 0.22; c.b *= 1.0 - temperature * 0.22;
  c.g *= 1.0 + tint * 0.18;
  c += brightness * 0.25;
  c = (c - 0.5) * (1.0 + contrast * (contrast > 0.0 ? 1.0 : 0.85)) + 0.5;
  float l = lum(clamp(c, 0.0, 1.0));
  c += highlights * 0.35 * smoothstep(0.45, 1.0, l);
  c += shadows * 0.35 * (1.0 - smoothstep(0.0, 0.55, l));
  float bl = blacks * -0.12, wh = 1.0 - whites * 0.15;
  c = (c - bl) / max(wh - bl, 0.05);
  c = pow(max(c, 0.0), vec3(1.0 / exp2(gam * 1.4)));
  if (hue != 0.0) {
    float ang = hue * 3.14159265; float cs = cos(ang), sn = sin(ang);
    mat3 m = mat3(0.299,0.587,0.114, 0.299,0.587,0.114, 0.299,0.587,0.114)
      + mat3(0.701,-0.587,-0.114, -0.299,0.413,-0.114, -0.3,-0.588,0.886) * cs
      + mat3(0.168,0.330,-0.497, -0.328,0.035,0.292, 1.25,-1.05,-0.203) * sn;
    c = c * m;
  }
  l = lum(c);
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = mx - mn;
  c = mix(vec3(l), c, 1.0 + saturation + vibrance * (1.0 - sat) * 1.2);
  if (grayscale > 0.5) c = vec3(lum(c));
  if (sepia > 0.5) { float g = lum(c); c = vec3(g * 1.07 + 0.08, g * 0.9 + 0.04, g * 0.7); }
  if (invert > 0.5) c = 1.0 - c;
  o = vec4(clamp(c, 0.0, 1.0), lev(src.a, 20));
}`

export const isIdentity = (a: Adjust) =>
  !a.grayscale && !a.sepia && !a.invert &&
  ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'gamma', 'temperature', 'tint', 'saturation', 'vibrance', 'hue', 'sharpness', 'clarity'].every(k => !(a as any)[k]) &&
  a.levels.join() === '0,255,0,255,0,255' &&
  [0, 5, 10, 15, 20].every(o => levelsIdentity(a.lv || LV0, o))

class GL {
  c = canvas(1, 1)
  gl: WebGL2RenderingContext
  prog: WebGLProgram
  tex: WebGLTexture
  u: Record<string, WebGLUniformLocation | null> = {}
  tmp = canvas(1, 1)

  constructor() {
    const gl = this.c.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true })
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader')
      return s
    }
    const p = gl.createProgram()!
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p)
    this.prog = p
    gl.useProgram(p)
    const b = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, b)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(p, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    this.tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    for (const n of ['t', 'px', 'exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'gam', 'temperature', 'tint', 'saturation', 'vibrance', 'hue', 'sharpness', 'clarity', 'grayscale', 'sepia', 'invert', 'lvLo', 'lvHi', 'lv'])
      this.u[n] = gl.getUniformLocation(p, n)
  }

  apply(target: HTMLCanvasElement, r: Rect, a: Adjust) {
    const pad = a.clarity ? 16 : a.sharpness ? 2 : 0
    const x0 = Math.max(0, r.x - pad), y0 = Math.max(0, r.y - pad)
    const x1 = Math.min(target.width, r.x + r.w + pad), y1 = Math.min(target.height, r.y + r.h + pad)
    const w = x1 - x0, h = y1 - y0
    if (w <= 0 || h <= 0) return
    const gl = this.gl
    if (this.c.width !== w || this.c.height !== h) { this.c.width = w; this.c.height = h }
    if (this.tmp.width !== w || this.tmp.height !== h) { this.tmp.width = w; this.tmp.height = h }
    const tx = ctx2d(this.tmp)
    tx.clearRect(0, 0, w, h)
    tx.drawImage(target, x0, y0, w, h, 0, 0, w, h)
    gl.viewport(0, 0, w, h)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.bindTexture(gl.TEXTURE_2D, this.tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.tmp)
    const U = this.u, f = (n: string, v: number) => gl.uniform1f(U[n], v)
    gl.uniform1i(U.t, 0)
    gl.uniform2f(U.px, 1 / w, 1 / h)
    f('exposure', a.exposure / 100); f('brightness', a.brightness / 100); f('contrast', a.contrast / 100)
    f('highlights', a.highlights / 100); f('shadows', a.shadows / 100); f('whites', a.whites / 100); f('blacks', a.blacks / 100)
    f('gam', a.gamma / 100); f('temperature', a.temperature / 100); f('tint', a.tint / 100); f('saturation', a.saturation / 100)
    f('vibrance', a.vibrance / 100); f('hue', a.hue / 180); f('sharpness', a.sharpness / 100); f('clarity', a.clarity / 100)
    f('grayscale', a.grayscale ? 1 : 0); f('sepia', a.sepia ? 1 : 0); f('invert', a.invert ? 1 : 0)
    const L = a.levels
    gl.uniform3f(U.lvLo, L[0] / 255, L[2] / 255, L[4] / 255)
    gl.uniform3f(U.lvHi, L[1] / 255, L[3] / 255, L[5] / 255)
    gl.uniform1fv(U.lv, lvNorm(a))
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    const ix = r.x - x0, iy = r.y - y0
    const out = ctx2d(target)
    out.save()
    out.globalCompositeOperation = 'copy'
    out.beginPath(); out.rect(r.x, r.y, r.w, r.h); out.clip()
    out.drawImage(this.c, ix, iy, r.w, r.h, r.x, r.y, r.w, r.h)
    out.restore()
  }
}

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

function adjustCPU(target: HTMLCanvasElement, r: Rect, a: Adjust) {
  const pad = a.clarity ? 30 : a.sharpness ? 3 : 0
  const x0 = Math.max(0, r.x - pad), y0 = Math.max(0, r.y - pad)
  const x1 = Math.min(target.width, r.x + r.w + pad), y1 = Math.min(target.height, r.y + r.h + pad)
  const w = x1 - x0, h = y1 - y0
  if (w <= 0 || h <= 0) return
  const R = { x: x0, y: y0, w, h }
  const id = getData(target, R), d = id.data, n = w * h
  const ch = [0, 1, 2].map(c => { const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = d[i * 4 + c] / 255; return f })
  const sb = a.sharpness ? ch.map(f => gauss(f, w, h, 1)) : null
  const cb = a.clarity ? ch.map(f => gauss(f, w, h, 10)) : null
  const L = a.levels, P = (k: keyof Adjust) => (a[k] as number) / 100
  const ex = Math.pow(2, P('exposure') * 2), t = P('temperature'), ti = P('tint'), br = P('brightness'), co = P('contrast')
  const hl = P('highlights'), sh = P('shadows'), bl = P('blacks') * -0.12, wh = 1 - P('whites') * 0.15, gm = 1 / Math.pow(2, P('gamma') * 1.4)
  const hue = (a.hue / 180) * Math.PI, cs = Math.cos(hue), sn = Math.sin(hue), sat = P('saturation'), vib = P('vibrance')
  const M = [
    0.299 + 0.701 * cs + 0.168 * sn, 0.587 - 0.587 * cs + 0.33 * sn, 0.114 - 0.114 * cs - 0.497 * sn,
    0.299 - 0.299 * cs - 0.328 * sn, 0.587 + 0.413 * cs + 0.035 * sn, 0.114 - 0.114 * cs + 0.292 * sn,
    0.299 - 0.3 * cs + 1.25 * sn, 0.587 - 0.588 * cs - 1.05 * sn, 0.114 + 0.886 * cs - 0.203 * sn]
  const lum = (c: number[]) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114
  const N = lvNorm(a)
  const lev = (x: number, k: number) => { const t = Math.min(1, Math.max(0, (x - N[k]) / Math.max(0.004, N[k + 1] - N[k]))); return N[k + 3] + (N[k + 4] - N[k + 3]) * Math.pow(t, 1 / Math.max(0.01, N[k + 2])) }
  const aLut = levelsLUT(a.lv || LV0, 20)
  for (let i = 0; i < n; i++) {
    let c = [ch[0][i], ch[1][i], ch[2][i]]
    if (sb) c = c.map((v, k) => v + (v - sb[k][i]) * P('sharpness') * 1.6)
    if (cb) { const l0 = lum(c), k = P('clarity') * 0.9 * (1 - Math.pow(Math.abs(l0 - 0.5) * 2, 2)); c = c.map((v, j) => v + (v - cb[j][i]) * k) }
    c = c.map((v, k) => lev(lev((v - L[k * 2] / 255) / Math.max(0.01, (L[k * 2 + 1] - L[k * 2]) / 255), 5 + k * 5), 0) * ex)
    c[0] *= 1 + t * 0.22; c[2] *= 1 - t * 0.22; c[1] *= 1 + ti * 0.18
    c = c.map(v => (v + br * 0.25 - 0.5) * (1 + co * (co > 0 ? 1 : 0.85)) + 0.5)
    const l = lum(c.map(v => Math.min(1, Math.max(0, v))))
    const hs = hl * 0.35 * sstep(0.45, 1, l) + sh * 0.35 * (1 - sstep(0, 0.55, l))
    c = c.map(v => Math.pow(Math.max(0, (v + hs - bl) / Math.max(0.05, wh - bl)), gm))
    if (a.hue) c = [c[0] * M[0] + c[1] * M[1] + c[2] * M[2], c[0] * M[3] + c[1] * M[4] + c[2] * M[5], c[0] * M[6] + c[1] * M[7] + c[2] * M[8]]
    const l2 = lum(c), s0 = Math.max(...c) - Math.min(...c), k = 1 + sat + vib * (1 - s0) * 1.2
    c = c.map(v => l2 + (v - l2) * k)
    if (a.grayscale) { const g = lum(c); c = [g, g, g] }
    if (a.sepia) { const g = lum(c); c = [g * 1.07 + 0.08, g * 0.9 + 0.04, g * 0.7] }
    if (a.invert) c = c.map(v => 1 - v)
    d[i * 4] = c[0] * 255; d[i * 4 + 1] = c[1] * 255; d[i * 4 + 2] = c[2] * 255; d[i * 4 + 3] = aLut[d[i * 4 + 3]] * 255
  }
  const ix = r.x - x0, iy = r.y - y0
  const out = new ImageData(r.w, r.h)
  for (let y = 0; y < r.h; y++) out.data.set(d.subarray(((y + iy) * w + ix) * 4, ((y + iy) * w + ix + r.w) * 4), y * r.w * 4)
  putData(target, out, r.x, r.y)
}

let inst: GL | null = null
let failed = false
export function adjustGL(): { apply: (t: HTMLCanvasElement, r: Rect, a: Adjust) => void } {
  if (!inst && !failed) { try { inst = new GL() } catch { failed = true } }
  if (inst && inst.gl.isContextLost()) { inst = null; try { inst = new GL() } catch { failed = true } }
  return inst && !failed ? inst : { apply: adjustCPU }
}
