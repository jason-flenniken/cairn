// The bar's usage lines (FR-03..FR-06): model, context and tokens; the 5-hour and weekly limits; then the plan's
// cost, tokens and share of the week from the ledger (ledger.ts).
// `session.measure` pushes the figures into $.state; the pane only reads them (NFR-02: no timer of its own).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, On, PluginState } from 'claude-code'
import { BAR_COLUMNS, type BarLine, type BarSeg } from './bar.tsx'
import type { CairnLedgerEntry, CairnView } from '../../types/index.d.ts'
import { commonDir } from './heartbeat.ts'
import { ledgerMeasure, sessionPlan, tokenTotal } from './ledger.ts'
import { firstFit, fmtDuration, lineCells } from './util.ts'

/** The session's usage as `session.measure` last reported it, and the model in use. */
export type CairnUsage = NonNullable<PluginState['cairn']['usage']>

// What the bar draws lives in $.state, so a hot reload keeps it. A restart starts both over.
const usage = atom({ plugin: 'cairn', key: 'usage' } as const, null as CairnUsage | null)

// The pane's view atom (same key as pane.tsx's; importing pane here would be circular), read for the shown plan's slug.
const view = atom({ plugin: 'cairn', key: 'view' } as const, null as CairnView | null)

/** At most one context-file write per this long. */
export const CONTEXT_EVERY_MS = 30_000
// Bookkeeping, not drawn: the last context write's slug, time and figures.
let lastContext: { slug: string; at: number; pct: number; tokens: number } | undefined
// The context folder has been created (once per session).
let contextDirMade = false

/** Forgets the last context write (tests). */
export function resetContextThrottle(): void {
  lastContext = undefined
  contextDirMade = false
}

/**
 * Writes <git common dir>/cairn/context/<slug>.json = { pct, tokens, at } for the plan the pane shows, so the CLI
 * can tell how full this session's context is. A rise is throttled to one write per 30 s; a drop in pct (after /clear or compaction) writes at once; unchanged figures are skipped.
 */
async function writeContext($: EngineInterface, context: { percent?: number; tokens?: number }): Promise<void> {
  // A session at the repo root (where execute runs) has no plan by location; it is still unambiguous with one active plan.
  const slug = sessionPlan(await read($, view))
  if (slug === undefined || context.percent === undefined || context.tokens === undefined) return
  const now = await $.clock.now()
  const pct = Math.round(context.percent * 10) / 10
  const tokens = context.tokens
  const last = lastContext
  if (last?.slug === slug) {
    if (last.pct === pct && last.tokens === tokens) return
    if (pct >= last.pct && now - last.at < CONTEXT_EVERY_MS) return
  }
  const dir = await commonDir($)
  if (!contextDirMade) {
    await $.process.run(['mkdir', '-p', `${dir}/cairn/context`], { timeoutMs: 5_000 })
    contextDirMade = true
  }
  await $.fs.write(`${dir}/cairn/context/${slug}.json`, `${JSON.stringify({ pct, tokens, at: new Date(now).toISOString() })}\n`)
  lastContext = { slug, at: now, pct, tokens }
}

const GAP = '  '
const WARN_AT = 80
const ERROR_AT = 95
const BAR_FULL = 6
const BAR_SHORT = 3
const MODEL_CELLS = 12

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

/** Line 2: 🧠 model, ⛁ context bar and percent, tokens. Parts drop from the right, then the bar shrinks, to fit. */
export function modelLine(usage: CairnUsage | null, columns = BAR_COLUMNS): BarLine {
  if (usage === null) return []
  const name = modelName(usage.model)
  const { percent, tokens } = usage.context
  const build = (barWidth: number, withTokens: boolean, nameCells: number): BarSeg[] => {
    const parts: BarSeg[][] = []
    if (name !== undefined) {
      const shown = [...name].length > nameCells ? `${[...name].slice(0, nameCells - 1).join('')}…` : name
      parts.push([{ text: `🧠 ${shown}`, bold: true }])
    }
    if (percent !== undefined) {
      const color = percent >= ERROR_AT ? 'error' : percent >= WARN_AT ? 'warning' : undefined
      parts.push([{ text: `⛁ ${barWidth > 0 ? `${meter(percent, barWidth)} ` : ''}${Math.round(percent)}%`, color }])
    }
    if (withTokens && tokens !== undefined) parts.push([{ text: `${tokensText(tokens)} tok`, dim: true }])
    return parts.flatMap((p, i) => (i === 0 ? p : [{ text: GAP }, ...p]))
  }
  return firstFit([build(BAR_FULL, true, MODEL_CELLS), build(BAR_SHORT, true, MODEL_CELLS), build(BAR_SHORT, false, MODEL_CELLS), build(0, false, 8)], columns)
}

/** A share of the week: 4.2%, 18%. */
export const weekText = (pct: number) => `${pct < 10 ? pct.toFixed(1).replace(/\.0$/, '') : Math.round(pct)}%`

/**
 * Line 4: the plan's totals across every session, 💰 cost, Σ tokens and ≈ its share of the weekly limit; with no plan,
 * the session's cost. Labels drop first to fit.
 */
export function planLine(usage: CairnUsage | null, total: CairnLedgerEntry | undefined, columns = BAR_COLUMNS): BarLine {
  if (total === undefined) {
    const usd = usage?.cost?.usd
    return usd === undefined ? [] : [{ text: `💰 ${money(usd)}` }, { text: ' session', dim: true }]
  }
  const tok = tokenTotal(total)
  // Where the host keeps no cost, a plan that has none shows no dollar figure.
  const withCost = usage?.cost !== undefined || total.usd > 0
  const build = (withLabel: boolean, long: boolean): BarSeg[] => {
    const parts: BarSeg[][] = [
      ...(withCost ? [[{ text: `💰 ${money(total.usd)}` }, ...(withLabel ? [{ text: ' plan', dim: true }] : [])]] : []),
      ...(tok > 0 ? [[{ text: `Σ ${tokensText(tok)} tok` }]] : []),
      ...(total.weekPct > 0 ? [[{ text: `≈${weekText(total.weekPct)}${long ? ' of week' : ' wk'}` }]] : []),
    ]
    return parts.flatMap((p, i) => (i === 0 ? p : [{ text: GAP }, ...p]))
  }
  return firstFit([build(true, true), build(false, true), build(false, false)], columns)
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

/**
 * Line 3: each limit window with a small bar and percent; past 80% warning with its reset time, past 95% error. The 7-day
 * window also says how much is left and when it resets; the reset time drops first, then the bars shrink. Empty with no rate limits.
 */
export function limitsLine(usage: CairnUsage | null, nowMs: number, columns = BAR_COLUMNS): BarLine {
  const limits = usage?.rateLimits ?? []
  if (limits.length === 0) return []
  const build = (barWidth: number, withReset: boolean, withLeft: boolean): BarSeg[] =>
    limits.flatMap((l, i) => {
      const w = WINDOWS[l.kind] ?? { icon: '◔', label: l.kind.replace(/_.*$/, '') }
      const isWeek = l.kind === 'seven_day'
      const at = withReset && (isWeek || l.percentUsed >= WARN_AT) && l.resetsAt !== undefined ? clock(l.resetsAt, nowMs) : undefined
      const left = withLeft && isWeek ? ` · ${Math.max(0, Math.round(100 - l.percentUsed))}% left` : ''
      const text = `${w.icon} ${w.label} ${barWidth > 0 ? `${meter(l.percentUsed, barWidth)} ` : ''}${Math.round(l.percentUsed)}%${left}${at === undefined ? '' : ` ↻${at}`}`
      return [...(i === 0 ? [] : [{ text: GAP }]), { text, color: colorOf(l.percentUsed) }]
    })
  return firstFit([
    build(BAR_SHORT + 2, true, true), build(BAR_SHORT, true, true), build(BAR_SHORT, false, true),
    build(0, false, true), build(0, false, false),
  ], columns)
}

/** The inline pane's one usage run: the plan cost, the active time, the 5h percent, the 7d left and the plan's share of the week, to follow the active step. */
export function inlineUsage(usage: CairnUsage | null, total: CairnLedgerEntry | undefined, activeMs: number | undefined, room: number): BarSeg[] {
  const usd = total !== undefined && (usage?.cost !== undefined || total.usd > 0) ? total.usd : usage?.cost?.usd
  const timer = activeMs !== undefined && activeMs > 0 ? [{ text: `⏱ ${fmtDuration(activeMs, true)}`, dim: true }] : []
  const limits = (usage?.rateLimits ?? []).flatMap(l => {
    const w = WINDOWS[l.kind]
    if (w === undefined) return []
    const text = l.kind === 'seven_day' ? `${w.label} ${Math.max(0, Math.round(100 - l.percentUsed))}% left` : `${w.label} ${Math.round(l.percentUsed)}%`
    return [{ text, color: colorOf(l.percentUsed) }]
  })
  const share = total !== undefined && total.weekPct > 0 ? [{ text: `≈${weekText(total.weekPct)} wk` }] : []
  const all = [...(usd === undefined ? [] : [{ text: money(usd) }]), ...timer, ...limits, ...share]
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
      await writeContext($, e.context)
      await ledgerMeasure($, e)
    } catch {
      // Bookkeeping must never reach the session (NFR-07).
    }
    return next(e)
  })
}
