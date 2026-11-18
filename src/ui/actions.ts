import type { App, ActionDef } from '../app'
import { describe, playAction, startRecording, stopRecording, STARTER_ACTIONS } from '../core/actions'
import { uid } from '../core/util'
import { confirmBox, h, icon, modal, tip, toast } from './dom'
import { hint, sec } from './controls'
import { tr, tn } from '../i18n'

/** The Actions window: record a list of steps, play it on this image or on every open image. */
export function actionsDialog(app: App) {
  const body = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', minWidth: 'min(560px, 90vw)' } })
  const open = new Set<string>()
  const save = () => app.saveSettings()
  const play = (a: ActionDef, all: boolean) => { close(); setTimeout(() => playAction(app, a, all), 50) }
  const row = (a: ActionDef, mine: boolean) => {
    const expanded = open.has(a.id)
    const name = h('input', { type: 'text', value: a.name, class: 'grow', readOnly: !mine, 'aria-label': tr('Action name'), 'data-noenter': '' }) as HTMLInputElement
    name.addEventListener('keydown', e => { if (e.key === 'Enter') name.blur() })
    name.addEventListener('change', () => { a.name = name.value.trim() || a.name; name.value = a.name; save() })
    const many = app.docs.length > 1
    return h('div', { class: 'act' },
      h('div', { class: 'fr' },
        tip(h('button', { class: 'ic', onclick: () => { if (expanded) open.delete(a.id); else open.add(a.id); draw() } }, icon('chev')), expanded ? tr('Hide steps') : tr('Show steps')),
        name,
        h('span', { class: 'mute', style: { fontSize: '12px', whiteSpace: 'nowrap' } }, tn(a.steps.length, '{0} step', '{0} steps')),
        h('button', { class: 'pri', disabled: !app.doc, onclick: () => play(a, false) }, tr('Play')),
        many ? h('button', { onclick: () => play(a, true) }, tr('Play on all {0}', app.docs.length)) : null,
        mine
          ? tip(h('button', { class: 'ic', onclick: async () => {
              if ((await confirmBox(tr('Delete {0}?', a.name), tr('The action is removed. Images it changed stay as they are.'), tr('Delete'))) !== 'yes') return
              app.settings.actions = app.settings.actions.filter(x => x !== a); save(); draw()
            } }, icon('trash')), tr('Delete action'))
          : tip(h('button', { class: 'ic', onclick: () => { app.settings.actions = [...app.settings.actions, { ...a, id: uid(), steps: a.steps.map(s => JSON.parse(JSON.stringify(s))) }]; save(); toast(tr('Added {0} to your actions', a.name)); draw() } }, icon('plus')), tr('Add to my actions'))),
      expanded ? h('ol', { class: 'steps' }, a.steps.map((s, i) => h('li', {}, h('span', { class: 'grow' }, describe(s)),
        mine ? tip(h('button', { class: 'ic', onclick: () => { a.steps.splice(i, 1); save(); draw() } }, icon('x')), tr('Remove step')) : null))) : null)
  }
  const draw = () => {
    body.innerHTML = ''
    const recName = h('input', { type: 'text', placeholder: tr('Name, for example Instagram post'), class: 'grow' }) as HTMLInputElement
    const rec = app.recording
    body.append(
      h('div', { class: 'fr' }, h('h2', tr('Actions')), h('span', { class: 'sp' }), h('button', { class: 'ic', 'aria-label': tr('Close'), onclick: () => close() }, icon('x'))),
      hint(tr('An action repeats a series of edits: resize, crop, filters, adjustments, background removal, redaction, export and more. Record one while you edit, then play it on other images.')),
      rec
        ? h('div', { class: 'job' }, h('div', { class: 'fr' }, h('i', { class: 'dot rec' }), h('span', { class: 'grow' }, tr('Recording {0}', rec.name) + ', ' + tn(rec.steps.length, '{0} step', '{0} steps')), h('button', { class: 'pri', onclick: () => { stopRecording(app); draw() } }, tr('Stop and save'))))
        : h('div', { class: 'fr' }, recName, h('button', { class: 'pri', onclick: () => {
            startRecording(app, recName.value)
            close()
            toast(tr('Recording. Edit the image as usual, then press Stop in the top bar.'))
          } }, h('i', { class: 'dot rec' }), tr('Record'))),
      sec(tr('My actions')),
      ...(app.settings.actions.length ? app.settings.actions.map(a => row(a, true)) : [hint(tr('No actions yet. Record one, or add a ready-made one below.'))]),
      sec(tr('Ready-made')),
      ...STARTER_ACTIONS().map(a => row(a, false)))
  }
  draw()
  const close = modal(() => body, true)
}
