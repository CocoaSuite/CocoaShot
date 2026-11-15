export interface OpenedFile { name: string; path?: string; data: ArrayBuffer }

interface Native {
  platform: string
  openDialog(kind?: string): Promise<OpenedFile | null>
  readPath(p: string): Promise<OpenedFile | null>
  saveDialog(name: string, filters: { name: string; extensions: string[] }[], dir?: string): Promise<string | null>
  pickFolder(dir?: string): Promise<string | null>
  writePath(p: string, data: Uint8Array): Promise<string>
  joinPath(a: string, b: string): Promise<string>
  defaultFolder(): Promise<string>
  showInFolder(p: string): Promise<void>
  recent(): Promise<RecentItem[]>
  addRecent(i: RecentItem): Promise<RecentItem[]>
  saveRecovery(d: Uint8Array): Promise<void>
  loadRecovery(): Promise<ArrayBuffer | null>
  clearRecovery(): Promise<void>
  clipboardImage(): Promise<ArrayBuffer | null>
  copyImage(png: Uint8Array): Promise<void>
  modelsSize(): Promise<number>
  modelsFolder(): Promise<void>
  dataFolder(): Promise<void>
  ai(op: string, args?: any, onProgress?: (p: any) => void): Promise<any>
  aiCancel(): Promise<void>
  onOpenFile(cb: (f: OpenedFile) => void): void
  onWantClose(cb: () => void): void
  closeNow(): void
  setTitle(t: string): void
  toggleFullScreen(): Promise<boolean>
  onFullScreen(cb: (on: boolean) => void): void
  setTitleBar(color: string, symbolColor: string, height?: number): void
  appVersion(): Promise<string>
  updateCheck(): Promise<UpdateInfo>
  updateDownload(onProgress?: (p: { loaded: number; total: number }) => void): Promise<{ name: string }>
  updateInstall(): Promise<'quitting' | 'restarting' | 'opened'>
  openReleases(): Promise<void>
}

export interface UpdateInfo {
  current: string; latest: string | null; newer: boolean; page: string
  name?: string; notes?: string; date?: string; asset?: { name: string; size: number } | null
}

export interface RecentItem { name: string; path: string; at: number; thumb?: string }

export const native: Native | null = (window as any).cocoaNative || null
export const isDesktop = !!native
export const isMac = (native?.platform || navigator.platform).toLowerCase().includes('mac')

export function pickLocal(accept: string): Promise<OpenedFile | null> {
  return new Promise(res => {
    const i = document.createElement('input')
    i.type = 'file'
    i.accept = accept
    i.onchange = async () => { const f = i.files?.[0]; res(f ? { name: f.name, data: await f.arrayBuffer() } : null) }
    i.click()
  })
}

export function downloadLocal(name: string, data: Uint8Array) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([data as any]))
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
