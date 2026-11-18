import type { Pt, Viewport } from '../view/viewport'
import type { BrushOpts } from '../core/brush'
import type { StepLike } from '../core/steps'
import { tr } from '../i18n'

export interface BrushHandle {
  getSize(): number
  setSize(v: number): void
  getOpacity?(): number
  setOpacity?(v: number): void
  color?(): string | undefined
  minSize?: number
  maxSize?: number
  minOpacity?: number
  altClick?: boolean
  opts?: BrushOpts
}

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
  brush?(): BrushHandle | null
  /** Alt+click samples the colour under the cursor instead of using the tool. */
  altPick?: boolean
  /** Work in progress inside the tool (polygon corners, handle drags). Undo and redo step through it before the document history. */
  steps?: StepLike
}

export interface Group { id: string; name: string; icon: string; tools: string[] }

export const GROUPS: Group[] = [
  { id: 'select', name: tr('Select'), icon: 'select', tools: ['move', 'transform', 'marquee', 'ellipse-sel', 'lasso', 'poly', 'sel-brush', 'wand', 'obj-sel', 'subject'] },
  { id: 'crop', name: tr('Crop & Resize'), icon: 'crop', tools: ['crop', 'resize', 'persp'] },
  { id: 'bg', name: tr('Background'), icon: 'bg', tools: ['bg-remove', 'bg-refine', 'bg-replace'] },
  { id: 'hl', name: tr('Highlight & Outline'), icon: 'outline', tools: ['highlight', 'spotlight', 'outline'] },
  { id: 'paint', name: tr('Paint & Erase'), icon: 'paint', tools: ['brush', 'pencil', 'eraser', 'fill', 'gradient', 'picker', 'clone', 'blur', 'sharpen', 'smudge'] },
  { id: 'adjust', name: tr('Adjustments'), icon: 'adjust', tools: ['adjust', 'levels', 'alpha'] },
  { id: 'ai', name: tr('AI Tools'), icon: 'ai', tools: ['ai-remove', 'ai-cleanup', 'ai-upscale', 'ai-enhance', 'ai-detect'] },
  { id: 'text', name: tr('Text & Annotations'), icon: 'text', tools: ['text', 'arrow', 'line', 'rect', 'ellipse', 'callout', 'label', 'marker'] },
  { id: 'view', name: tr('View'), icon: 'hand', tools: ['hand', 'zoom'] }
]

export const groupOf = (tool: string) => GROUPS.find(g => g.tools.includes(tool))
