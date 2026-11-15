import './styles/app.css'
import { App } from './app'
import { buildShell } from './ui/shell'
import { selectTools } from './tools/select'
import { cropTools } from './tools/crop'
import { bgTools } from './tools/background'
import { highlightTools } from './tools/highlight'
import { paintTools } from './tools/paint'
import { adjustTool, alphaTool, levelsTool } from './tools/adjust'
import { aiTools } from './tools/ai'
import { annotateTools } from './tools/annotate'
import { native } from './native'
import { checkForUpdates } from './ui/update'

const app = new App()
for (const t of [...selectTools(app), ...cropTools(app), ...bgTools(app), ...highlightTools(app), ...paintTools(app), adjustTool(app), levelsTool(app), alphaTool(app), ...aiTools(app), ...annotateTools(app)]) app.tools.set(t.id, t)
buildShell(app, document.getElementById('app')!)
app.setTool('move')
if (native && !app.settings.gpu) native.ai('setGpu', { on: false })
if (native && app.settings.checkUpdates) setTimeout(() => checkForUpdates(app, true), 5000)
;(window as any).cocoashot = app
