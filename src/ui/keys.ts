import { isMac } from '../native'
import { tr } from '../i18n'

export interface Action { id: string; label: string; key: string }

export const ACTIONS: Action[] = [
  { id: 'newImage', label: tr('New image'), key: 'Mod+N' },
  { id: 'open', label: tr('Open'), key: 'Mod+O' },
  { id: 'save', label: tr('Save project'), key: 'Mod+S' },
  { id: 'saveAs', label: tr('Save project as'), key: 'Mod+Shift+S' },
  { id: 'openProject', label: tr('Open project'), key: 'Mod+Shift+O' },
  { id: 'close', label: tr('Close image'), key: 'Mod+W' },
  { id: 'export', label: tr('Export'), key: 'Mod+E' },
  { id: 'undo', label: tr('Undo'), key: 'Mod+Z' },
  { id: 'redo', label: tr('Redo'), key: 'Mod+Shift+Z' },
  { id: 'cut', label: tr('Cut'), key: 'Mod+X' },
  { id: 'copy', label: tr('Copy'), key: 'Mod+C' },
  { id: 'paste', label: tr('Paste'), key: 'Mod+V' },
  { id: 'newPaste', label: tr('Paste as new image'), key: 'Mod+Alt+V' },
  { id: 'selectAll', label: tr('Select all'), key: 'Mod+A' },
  { id: 'deselect', label: tr('Deselect'), key: 'Mod+D' },
  { id: 'invert', label: tr('Invert selection'), key: 'Mod+Shift+I' },
  { id: 'delete', label: tr('Delete selection or layer'), key: 'Delete' },
  { id: 'zoomIn', label: tr('Zoom in'), key: 'Mod+=' },
  { id: 'zoomOut', label: tr('Zoom out'), key: 'Mod+-' },
  { id: 'fit', label: tr('Fit to screen'), key: 'Mod+0' },
  { id: 'actual', label: tr('Actual pixels'), key: 'Mod+1' },
  { id: 'fullscreen', label: tr('Full screen'), key: 'F11' },
  { id: 'panels', label: tr('Show or hide panels'), key: 'Tab' },
  { id: 'compare', label: tr('Before and after'), key: '\\' },
  { id: 'swap', label: tr('Swap colours'), key: 'X' },
  { id: 'settings', label: tr('Settings'), key: 'Mod+,' },
  { id: 'actions', label: tr('Actions'), key: 'Alt+F9' },
  { id: 'rulers', label: tr('Show or hide rulers'), key: 'Mod+R' },
  { id: 'guides', label: tr('Show or hide guides'), key: 'Mod+;' },
  { id: 'snap', label: tr('Snap on or off'), key: 'Mod+Alt+;' },
  { id: 'newLayer', label: tr('New layer'), key: 'Mod+Shift+N' },
  { id: 'dupLayer', label: tr('Duplicate layer'), key: 'Mod+J' },
  { id: 'mergeDown', label: tr('Merge down'), key: 'Mod+Alt+E' },
  { id: 'mergeVisible', label: tr('Merge visible'), key: 'Mod+Shift+Alt+E' },
  { id: 'newFolder', label: tr('New folder'), key: '' },
  { id: 'groupLayer', label: tr('Put layer in a folder'), key: 'Mod+G' },
  { id: 'ungroup', label: tr('Remove folder, keep layers'), key: 'Mod+Shift+G' },
  { id: 'effects', label: tr('Layer effects'), key: '' },
  { id: 'lastFilter', label: tr('Repeat last filter'), key: 'Mod+F' },
  { id: 'transform', label: tr('Free transform'), key: 'Mod+T' },
  { id: 'distort', label: tr('Distort'), key: '' },
  { id: 'warp', label: tr('Warp'), key: 'Mod+Alt+T' },
  { id: 'gradient', label: tr('Gradient'), key: 'Shift+G' },
  { id: 'flipLayerH', label: tr('Flip selected layers horizontally'), key: 'Shift+H' },
  { id: 'flipLayerV', label: tr('Flip selected layers vertically'), key: 'Shift+V' },
  { id: 'tool:move', label: tr('Move tool'), key: 'V' },
  { id: 'tool:marquee', label: tr('Rectangle select'), key: 'M' },
  { id: 'tool:lasso', label: tr('Lasso'), key: 'L' },
  { id: 'tool:poly', label: tr('Polygon select'), key: 'P' },
  { id: 'tool:wand', label: tr('Magic wand'), key: 'W' },
  { id: 'tool:crop', label: tr('Crop'), key: 'C' },
  { id: 'tool:brush', label: tr('Brush'), key: 'B' },
  { id: 'tool:pencil', label: tr('Pencil'), key: 'N' },
  { id: 'tool:eraser', label: tr('Eraser'), key: 'E' },
  { id: 'tool:fill', label: tr('Fill'), key: 'G' },
  { id: 'tool:picker', label: tr('Colour picker'), key: 'I' },
  { id: 'tool:clone', label: tr('Clone'), key: 'S' },
  { id: 'tool:highlight', label: tr('Highlight'), key: 'H' },
  { id: 'tool:text', label: tr('Text'), key: 'T' },
  { id: 'tool:arrow', label: tr('Arrow'), key: 'A' },
  { id: 'tool:adjust', label: tr('Adjustments'), key: 'J' },
  { id: 'tool:levels', label: tr('Levels'), key: 'Mod+L' },
  { id: 'tool:curves', label: tr('Curves'), key: 'Mod+M' },
  { id: 'tool:gmap', label: tr('Gradient map'), key: '' },
  { id: 'tool:alpha', label: tr('Layer alpha'), key: 'Mod+Shift+A' },
  { id: 'tool:redact', label: tr('Redact'), key: '' },
  { id: 'tool:expand', label: tr('Expand canvas'), key: '' },
  { id: 'tool:bg-remove', label: tr('Remove background'), key: 'K' },
  { id: 'tool:hand', label: tr('Hand'), key: '' },
  { id: 'tool:zoom', label: tr('Zoom'), key: 'Z' },
  { id: 'tool:ai-remove', label: tr('Remove object'), key: 'R' },
  { id: 'tool:outline', label: tr('Outline'), key: 'O' }
]

// Physical keys we bind to, keyed by KeyboardEvent.code (US layout positions).
const CODE_KEYS: Record<string, string> = {
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  NumpadAdd: '=', NumpadSubtract: '-'
}

// The key a shortcut should match, independent of the active keyboard layout.
// Latin layouts (QWERTY, AZERTY, QWERTZ, Dvorak...) keep their own letters so mnemonics
// still fit; non-Latin layouts (Cyrillic, Greek, Hebrew...) and characters altered by
// Option on macOS fall back to the physical key, so Ctrl+Z is Ctrl+Z on a Russian layout.
export function keyOf(e: KeyboardEvent) {
  const k = e.key, c = e.code || ''
  // Digits: AZERTY gives '&', 'é'... on the number row without Shift.
  const d = /^(?:Digit|Numpad)(\d)$/.exec(c)
  if (d) return d[1]
  if (k.length !== 1 || k === ' ') return k
  if (/^[a-z]$/i.test(k)) return k
  if (c.startsWith('Key')) return c.slice(3).toLowerCase()
  // Punctuation the layout already types in ASCII stays as typed (Shift-friendly);
  // anything else falls back to its physical position.
  if (k.charCodeAt(0) < 128 && !(e.altKey && isMac)) return k
  return CODE_KEYS[c] ?? k
}

export function comboOf(e: KeyboardEvent) {
  const p: string[] = []
  if (e.ctrlKey || e.metaKey) p.push('Mod')
  if (e.shiftKey) p.push('Shift')
  if (e.altKey) p.push('Alt')
  let k = keyOf(e)
  if (k === '+') k = '='
  if (k === '_') k = '-'
  if (k.length === 1) k = k.toUpperCase()
  if (k === ' ') k = 'Space'
  if (k === 'Backspace') k = tr('Delete')
  p.push(k)
  return p.join('+')
}

export function fmtCombo(c: string) {
  return c.split('+').map(k => (k === 'Mod' ? (isMac ? 'Cmd' : 'Ctrl') : k === '=' ? 'Plus' : k === '-' ? 'Minus' : k)).join(' + ')
}
