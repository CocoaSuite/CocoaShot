import type { App } from '../app'
import type { Tool } from './types'
import { h } from '../ui/dom'
import { btn, hint, sec, slider, toggle } from '../ui/controls'

export function viewTools(app: App): Tool[] {
  const viewPanel = (title: string, help: string) => h('div', { class: 'ib' },
    sec(title), hint(help),
    sec('View'),
    slider('Rotate', () => app.view.angle, v => app.view.setAngle(v), { min: -180, max: 180, def: 0, unit: '°' }),
    toggle('Flip view horizontally', () => app.view.flip, v => app.view.setFlip(v)),
    h('div', { class: 'g2' }, btn('Fit to screen', () => app.view.fit()), btn('Actual pixels', () => app.view.setZoom(1))))
  const hand: Tool = {
    id: 'hand', label: 'Hand', icon: 'hand',
    cursor: () => 'grab',
    panel: () => viewPanel('Hand', 'Drag to move around the image. Hold Space with any tool to do the same.')
  }
  const zoom: Tool = {
    id: 'zoom', label: 'Zoom', icon: 'zoom',
    cursor: p => (p?.e.altKey ? 'zoom-out' : 'zoom-in'),
    down(p) { app.view.zoomAt(app.view.zoom * (p.e.altKey ? 1 / 1.5 : 1.5), p.rx, p.ry) },
    panel: () => viewPanel('Zoom', 'Click to zoom in, Alt-click to zoom out. Ctrl and the scroll wheel zoom with any tool.')
  }
  return [hand, zoom]
}
