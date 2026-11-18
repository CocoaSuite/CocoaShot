import './styles/app.css'
import { App } from './app'
import { buildShell } from './ui/shell'
import { selectTools } from './tools/select'
import { cropTools } from './tools/crop'
import { bgTools } from './tools/background'
import { highlightTools } from './tools/highlight'
import { paintTools } from './tools/paint'
import { adjustTool, alphaTool, curvesTool, gradientMapTool, levelsTool } from './tools/adjust'
import { redactTools } from './tools/redact'
import { expandTools } from './tools/expand'
import { aiTools } from './tools/ai'
import { annotateTools } from './tools/annotate'
import { viewTools } from './tools/view'
import { filterTool } from './tools/filters'
import { effectsTool } from './tools/effects'
import { transformTool } from './tools/transform'
import { gradientTool } from './tools/gradient'
import { native } from './native'
import { checkForUpdates } from './ui/update'
import { firstLaunch } from './ui/onboard'

const app = new App()
for (const t of [...selectTools(app), ...cropTools(app), ...expandTools(app), ...bgTools(app), ...highlightTools(app), ...paintTools(app), adjustTool(app), levelsTool(app), curvesTool(app), gradientMapTool(app), alphaTool(app), ...redactTools(app), ...aiTools(app), ...annotateTools(app), ...viewTools(app), filterTool(app), effectsTool(app), transformTool(app), gradientTool(app)]) app.tools.set(t.id, t)
buildShell(app, document.getElementById('app')!)
app.setTool('move')
firstLaunch(app)
if (native && !app.settings.gpu) native.ai('setGpu', { on: false })
// Tell the app the interface is up (this keeps a code-only update). Sent once the first frame is drawn,
// so closing CocoaShot right after starting it no longer rolls an update back.
requestAnimationFrame(() => setTimeout(() => native?.appStarted?.(), 300))
if (native && app.settings.checkUpdates) setTimeout(() => checkForUpdates(app, true), 5000)
;(window as any).cocoashot = app
