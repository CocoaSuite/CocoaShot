import { isMac } from '../native'

export interface Action { id: string; label: string; key: string }

export const ACTIONS: Action[] = [
  { id: 'open', label: 'Open', key: 'Mod+O' },
  { id: 'save', label: 'Save project', key: 'Mod+S' },
  { id: 'saveAs', label: 'Save project as', key: 'Mod+Shift+S' },
  { id: 'export', label: 'Export', key: 'Mod+E' },
  { id: 'undo', label: 'Undo', key: 'Mod+Z' },
  { id: 'redo', label: 'Redo', key: 'Mod+Shift+Z' },
  { id: 'copy', label: 'Copy', key: 'Mod+C' },
  { id: 'paste', label: 'Paste', key: 'Mod+V' },
  { id: 'selectAll', label: 'Select all', key: 'Mod+A' },
  { id: 'deselect', label: 'Deselect', key: 'Mod+D' },
  { id: 'invert', label: 'Invert selection', key: 'Mod+Shift+I' },
  { id: 'delete', label: 'Delete selection or layer', key: 'Delete' },
  { id: 'zoomIn', label: 'Zoom in', key: 'Mod+=' },
  { id: 'zoomOut', label: 'Zoom out', key: 'Mod+-' },
  { id: 'fit', label: 'Fit to screen', key: 'Mod+0' },
  { id: 'actual', label: 'Actual pixels', key: 'Mod+1' },
  { id: 'compare', label: 'Before and after', key: '\\' },
  { id: 'swap', label: 'Swap colours', key: 'X' },
  { id: 'tool:move', label: 'Move tool', key: 'V' },
  { id: 'tool:marquee', label: 'Rectangle select', key: 'M' },
  { id: 'tool:lasso', label: 'Lasso', key: 'L' },
  { id: 'tool:wand', label: 'Magic wand', key: 'W' },
  { id: 'tool:crop', label: 'Crop', key: 'C' },
  { id: 'tool:brush', label: 'Brush', key: 'B' },
  { id: 'tool:pencil', label: 'Pencil', key: 'N' },
  { id: 'tool:eraser', label: 'Eraser', key: 'E' },
  { id: 'tool:fill', label: 'Fill', key: 'G' },
  { id: 'tool:picker', label: 'Colour picker', key: 'I' },
  { id: 'tool:clone', label: 'Clone', key: 'S' },
  { id: 'tool:highlight', label: 'Highlight', key: 'H' },
  { id: 'tool:text', label: 'Text', key: 'T' },
  { id: 'tool:arrow', label: 'Arrow', key: 'A' },
  { id: 'tool:adjust', label: 'Adjustments', key: 'J' },
  { id: 'tool:bg-remove', label: 'Remove background', key: 'K' }
]

export function comboOf(e: KeyboardEvent) {
  const p: string[] = []
  if (e.ctrlKey || e.metaKey) p.push('Mod')
  if (e.shiftKey) p.push('Shift')
  if (e.altKey) p.push('Alt')
  let k = e.key
  if (k === '+') k = '='
  if (k === '_') k = '-'
  if (k.length === 1) k = k.toUpperCase()
  if (k === ' ') k = 'Space'
  if (k === 'Backspace') k = 'Delete'
  p.push(k)
  return p.join('+')
}

export function fmtCombo(c: string) {
  return c.split('+').map(k => (k === 'Mod' ? (isMac ? 'Cmd' : 'Ctrl') : k === '=' ? 'Plus' : k === '-' ? 'Minus' : k)).join(' + ')
}
