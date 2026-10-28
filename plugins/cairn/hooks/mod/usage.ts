// The bar's usage lines (FR-03..FR-06): model, plan cost, context and tokens; then the 5-hour and weekly limits.
// `session.measure` pushes the figures into $.state; the pane only reads them (NFR-02: no timer of its own).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginState } from 'claude-code'
import { BAR_COLUMNS, type BarLine, type BarSeg } from './bar.tsx'
import { firstFit, fmtDuration, lineCells } from './util.ts'

/** The session's usage as `session.measure` last reported it, and the model in use. */
export type CairnUsage = NonNullable<PluginState['cairn']['usage']>

// What the bar draws lives in $.state, so a hot reload keeps it. A restart starts both over.
const usage = atom({ plugin: 'cairn', key: 'usage' } as const, null as CairnUsage | null)
const planBaseline = atom({ plugin: 'cairn', key: 'planBaseline' } as const, null as { slug: string; usd: number } | null)

const GAP = '  '
const WARN_AT = 80
const ERROR_AT = 95
const BAR_FULL = 6
const BAR_SHORT = 3
const MODEL_CELLS = 12

// Set when the plan was seen paused, so its resume starts the cost over. Bookkeeping, not drawn.
let wasPaused = false

/** The session's model as /model names it, in words: claude-opus-5-5 becomes "Opus 5.5". */
export function modelName(id: string | undefined): string | undefined {
  if (id === undefined || id === '') return undefined
  const m = /^(?:claude-)?(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(id)
  if (m === null) return id.replace(/^claude-/, '')
  return `${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] === undefined ? '' : `.${m[3]}`}`
}

/** The usage as the last `session.measure` left it; before one, what the session reports right now (null when it reports none). */
export async function readUsage($: EngineInterface): Promise<CairnUsage | null> {
  const held = await read($, usage)
  if (held !== null) return held
  try {
    const u = await $.session.usage()
    const model = await $.session.model().catch(() => undefined)
    return { cost: u.cost, context: u.context, rateLimits: u.rateLimits, model }
  } catch {
    return null
  }
}

/** The plan's starting cost, or null when none is recorded. */
export function readBaseline($: EngineInterface): Promise<{ slug: string; usd: number } | null> {
  return read($, planBaseline)
}

/**
 * Records the cost the session had when the plan was first seen active, and again when it is resumed
 * after a pause or the shown plan changes. `slug` is undefined when no plan is active.
 */
export async function syncBaseline($: EngineInterface, slug: string | undefined, isPaused: boolean): Promise<void> {
  if (slug === undefined) return
  if (isPaused) {
    wasPaused = true
    return
  }
  const held = await read($, planBaseline)
  if (held?.slug === slug && !wasPaused) return
  const usd = (await readUsage($))?.cost?.usd
  if (usd === undefined) return
  wasPaused = false
  await update($, planBaseline, () => ({ slug, usd }))
}

const money = (usd: number) => `$${usd.toFixed(2)}`

/** 850 tokens, 45k, 1.2M. */
export function tokensText(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${n < 10_000 ? (n / 1_000).toFixed(1).replace(/\.0$/, '') : Math.round(n / 1_000)}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
}

const meter = (percent: number, width: number) => {
  const filled = Math.min(width, Math.max(0, Math.round((percent / 100) * width)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** The cost the bar shows and its label: the plan's since its baseline, else the session's total; undefined when there is none. */
export function costShown(
  usage: CairnUsage | null,
  baseline: { slug: string; usd: number } | null,
  slug: string | undefined,
): { usd: number; label: 'plan' | 'session' } | undefined {
  const usd = usage?.cost?.usd
  if (usd === undefined) return undefined
  if (slug !== undefined && baseline?.slug === slug) return { usd: Math.max(0, usd - baseline.usd), label: 'plan' }
  return { usd, label: 'session' }
}

/** Line 2: 🧠 model, 💰 cost, ⛁ context bar and percent, tokens. Parts drop from the right, then the bar shrinks, to fit. */
export function modelLine(
  usage: CairnUsage | null,
  baseline: { slug: string; usd: number } | null,
  slug: string | undefined,
  columns = BAR_COLUMNS,
): BarLine {
  if (usage === null) return []
  const name = modelName(usage.model)
  const cost = costShown(usage, baseline, slug)
  const { percent, tokens } = usage.context
  const build = (barWidth: number, withTokens: boolean, withLabel: boolean, nameCells: number): BarSeg[] => {
    const parts: BarSeg[][] = []
    if (name !== undefined) {
      const shown = [...name].length > nameCells ? `${[...name].slice(0, nameCells - 1).join('')}…` : name
      parts.push([{ text: `🧠 ${shown}`, bold: true }])
    }
    if (cost !== undefined) parts.push([{ text: `💰 ${money(cost.usd)}` }, ...(withLabel ? [{ text: ` ${cost.label}`, dim: true }] : [])])
    if (percent !== undefined) {
      const color = percent >= ERROR_AT ? 'error' : percent >= WARN_AT ? 'warning' : undefined
      parts.push([{ text: `⛁ ${barWidth > 0 ? `${meter(percent, barWidth)} ` : ''}${Math.round(percent)}%`, color }])
    }
    if (withTokens && tokens !== undefined) parts.push([{ text: `${tokensText(tokens)} tok`, dim: true }])
    return parts.flatMap((p, i) => (i === 0 ? p : [{ text: GAP }, ...p]))
  }
  return firstFit([
    build(BAR_FULL, true, true, MODEL_CELLS),
    build(BAR_SHORT, true, true, MODEL_CELLS),
    build(BAR_SHORT, true, false, MODEL_CELLS),
    build(BAR_SHORT, false, false, MODEL_CELLS),
    build(0, false, false, 8),
  ], columns)
}

const WINDOWS: Record<string, { icon: string; label: string }> = {
  five_hour: { icon: '⏳', label: '5h' },
  seven_day: { icon: '📅', label: '7d' },
}

const colorOf = (percent: number) => (percent >= ERROR_AT ? 'error' : percent >= WARN_AT ? 'warning' : undefined)

const clock = (iso: string, nowMs: number): string | undefined => {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return undefined
  const hm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  return at.toDateString() === new Date(nowMs).toDateString() ? hm : `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][at.getDay()]} ${hm}`
}

/** Line 3: each limit window with a small bar and percent; past 80% warning with its reset time, past 95% error. Empty with no rate limits. */
export function limitsLine(usage: CairnUsage | null, nowMs: number, columns = BAR_COLUMNS): BarLine {
  const limits = usage?.rateLimits ?? []
  if (limits.length === 0) return []
  const build = (barWidth: number, withReset: boolean): BarSeg[] =>
    limits.flatMap((l, i) => {
      const w = WINDOWS[l.kind] ?? { icon: '◔', label: l.kind.replace(/_.*$/, '') }
      const at = withReset && l.percentUsed >= WARN_AT && l.resetsAt !== undefined ? clock(l.resetsAt, nowMs) : undefined
      const text = `${w.icon} ${w.label} ${barWidth > 0 ? `${meter(l.percentUsed, barWidth)} ` : ''}${Math.round(l.percentUsed)}%${at === undefined ? '' : ` ↻${at}`}`
      return [...(i === 0 ? [] : [{ text: GAP }]), { text, color: colorOf(l.percentUsed) }]
    })
  return firstFit([build(BAR_SHORT + 2, true), build(BAR_SHORT, true), build(BAR_SHORT, false), build(0, false)], columns)
}

/** The inline pane's one usage run: the plan cost, the active time and the limit percents, to follow the active step. */
export function inlineUsage(
  usage: CairnUsage | null,
  baseline: { slug: string; usd: number } | null,
  slug: string | undefined,
  activeMs: number | undefined,
  room: number,
): BarSeg[] {
  const cost = costShown(usage, baseline, slug)
  const timer = activeMs !== undefined && activeMs > 0 ? [{ text: `⏱ ${fmtDuration(activeMs, true)}`, dim: true }] : []
  const limits = (usage?.rateLimits ?? []).flatMap(l => {
    const w = WINDOWS[l.kind]
    return w === undefined ? [] : [{ text: `${w.label} ${Math.round(l.percentUsed)}%`, color: colorOf(l.percentUsed) }]
  })
  const all = [...(cost === undefined ? [] : [{ text: money(cost.usd) }]), ...timer, ...limits]
  // Drop from the right until the run fits the room left after the step.
  while (all.length > 0 && lineCells(all.flatMap(s => [{ text: GAP }, s])) > room) all.pop()
  return all.flatMap(s => [{ text: GAP }, s])
}

export function install(on: On): void {
  // After each main turn and when a limit moves: keep the figures the bar draws.
  on('session.measure', async ($, e, next) => {
    try {
      const model = await $.session.model().catch(() => undefined)
      await update($, usage, () => ({ cost: e.cost, context: e.context, rateLimits: e.rateLimits, model }))
    } catch {
      // Bookkeeping must never reach the session (NFR-07).
    }
    return next(e)
  })
}
