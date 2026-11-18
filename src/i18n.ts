import { RU } from './i18n/ru'

/**
 * Interface languages. Text in the code is written in English and passed through tr(), which looks the
 * English up in the chosen language's table and returns it unchanged when there is no translation, so a
 * missing entry shows English instead of breaking. {0}, {1} … in a text are filled from the arguments.
 *
 * The language is chosen once, when CocoaShot starts: the one picked under Settings, General, or else the
 * first of the computer's preferred languages that CocoaShot speaks. Changing it restarts the interface.
 */
export type Lang = 'en' | 'ru'
export type LangPref = 'auto' | Lang

/** Languages the interface is translated into, each named in itself. */
export const LANGS: [Lang, string][] = [['en', 'English'], ['ru', 'Русский']]

const TABLES: Record<Lang, Record<string, string> | null> = { en: null, ru: RU }

/** The first of the computer's preferred languages that CocoaShot speaks, else English. */
export function systemLang(): Lang {
  const nav = typeof navigator === 'undefined' ? null : navigator
  const prefs = [...(nav?.languages || []), nav?.language].filter(Boolean) as string[]
  for (const l of prefs) { const k = l.slice(0, 2).toLowerCase() as Lang; if (k in TABLES) return k }
  return 'en'
}

/** The language picked in Settings, read before the app loads its settings so module-level text is translated too. */
function savedPref(): LangPref {
  try { const p = JSON.parse(localStorage.getItem('cocoashot.settings') || '{}').lang; if (p === 'en' || p === 'ru') return p } catch {}
  return 'auto'
}

export const lang: Lang = (() => { const p = savedPref(); return p === 'auto' ? systemLang() : p })()
const table = TABLES[lang]
// Tests load this module in Node, where there is no page.
if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = lang

const fill = (s: string, a: (string | number)[]) => a.length ? s.replace(/\{(\d)\}/g, (m, i) => (a[+i] !== undefined ? String(a[+i]) : m)) : s

/** Translates an English interface text. */
export function tr(en: string, ...a: (string | number)[]): string {
  return fill((table && table[en]) || en, a)
}

/**
 * A count with its noun: tn(3, '{0} layer', '{0} layers'). The translation of the two English forms,
 * joined with |, gives the language's own forms (Russian has three: 1 слой, 2 слоя, 5 слоёв).
 */
export function tn(n: number, one: string, many: string, ...a: (string | number)[]): string {
  const key = one + '|' + many
  const found = table && table[key]
  if (!found) return fill(n === 1 ? one : many, [n, ...a])
  const f = found.split('|')
  return fill(f[pluralIndex(n, f.length)] ?? f[f.length - 1], [n, ...a])
}

function pluralIndex(n: number, forms: number) {
  if (lang === 'ru' && forms === 3) {
    const a = Math.abs(n), d = a % 10, h = a % 100
    if (!Number.isInteger(a)) return 1
    if (d === 1 && h !== 11) return 0
    if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 1
    return 2
  }
  return n === 1 ? 0 : 1
}

/** A number written the local way (1,5 in Russian). */
export function num(n: number, digits = 0) {
  return n.toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/**
 * Translates a word that the interface uses in more than one sense, such as Light (the theme) and
 * Light (the adjustments section): the table's "context:Text" entry wins over its plain one.
 */
export function tx(context: string, en: string, ...a: (string | number)[]): string {
  const k = context + ':' + en
  return table && table[k] ? fill(table[k], a) : tr(en, ...a)
}

let patterns: [RegExp, string][] | null = null
/**
 * Translates a message that arrives as finished English text, such as an error from the desktop app's own
 * process: an exact entry first, then any entry with {0} … whose fixed words match, its parts translated too.
 */
export function trMessage(msg: string): string {
  if (!table || !msg) return msg
  if (table[msg]) return table[msg]
  if (!patterns) {
    const esc = (s: string) => s.replace(/[.*+?^$()[\]\\]/g, '\\$&')
    patterns = Object.keys(table).filter(k => /\{\d\}/.test(k) && !k.includes('|')).map(k => [new RegExp('^' + k.split(/\{\d\}/).map(esc).join('(.+?)') + '$', 's'), k] as [RegExp, string])
  }
  for (const [re, k] of patterns) {
    const m = re.exec(msg)
    if (m) {
      const order = [...k.matchAll(/\{(\d)\}/g)].map(x => +x[1])
      const args: string[] = []
      order.forEach((n, i) => (args[n] = trMessage(m[i + 1])))
      return fill(table[k], args)
    }
  }
  return msg
}
