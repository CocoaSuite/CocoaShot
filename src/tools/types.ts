import type { Pt, Viewport } from '../view/viewport'

export interface Tool {
  id: string
  label: string
  icon: string
  cursor?(p?: Pt): string
  down?(p: Pt): void
  move?(p: Pt, pressed: boolean): void
  up?(p: Pt): void
  dbl?(p: Pt): void
  overlay?(x: CanvasRenderingContext2D, v: Viewport): void
  panel(): HTMLElement
  activate?(): void
  deactivate?(): void
  key?(e: KeyboardEvent): boolean
}

export interface Group { id: string; name: string; icon: string; tools: string[] }

export const GROUPS: Group[] = [
  { id: 'select', name: 'Select', icon: 'select', tools: ['move', 'marquee', 'ellipse-sel', 'lasso', 'wand', 'obj-sel', 'subject'] },
  { id: 'crop', name: 'Crop & Resize', icon: 'crop', tools: ['crop', 'resize', 'persp'] },
  { id: 'bg', name: 'Background', icon: 'bg', tools: ['bg-remove', 'bg-refine', 'bg-replace'] },
  { id: 'hl', name: 'Highlight & Outline', icon: 'outline', tools: ['highlight', 'spotlight', 'outline'] },
  { id: 'paint', name: 'Paint & Erase', icon: 'paint', tools: ['brush', 'pencil', 'eraser', 'fill', 'picker', 'clone', 'blur', 'sharpen', 'smudge'] },
  { id: 'adjust', name: 'Adjustments', icon: 'adjust', tools: ['adjust'] },
  { id: 'ai', name: 'AI Tools', icon: 'ai', tools: ['ai-remove', 'ai-cleanup', 'ai-upscale', 'ai-enhance', 'ai-detect'] },
  { id: 'text', name: 'Text & Annotations', icon: 'text', tools: ['text', 'arrow', 'line', 'rect', 'ellipse', 'callout', 'label', 'marker'] }
]

export const groupOf = (tool: string) => GROUPS.find(g => g.tools.includes(tool))
