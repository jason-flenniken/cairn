// The plan's usage ledger: what each plan cost in dollars, tokens and share of the weekly limit, across every session.
// Each session adds what changed since its last reading to the plan it works on, and keeps its own file at
// <git common dir>/cairn/usage/<slug>/<sessionId>.json; the totals are the sum of those files. One writer per file.
import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import type { CairnLedgerEntry, CairnView } from '../../types/index.d.ts'
import { commonDir } from './heartbeat.ts'

/** At most one write of this session's files per this long while figures change between measurements. */
export const FLUSH_EVERY_MS = 30_000
/** Other sessions' files are read again at most this often. */
export const READ_EVERY_MS = 10_000
/** A 7-day reset time that moved by more than this means a new window. */
const NEW_WINDOW_MS = 60 * 60_000

type Ledger = {
  sessionId: string
  /** The session cost at the last reading; undefined before the first. */
  lastUsd?: number
  /** The 7-day percent at the last reading, with its reset time; used when the repo-wide reading can't be read. */
  lastWeek?: { pct: number; resetsAt?: string }
  /** This session's totals per plan. */
  plans: Record<string, CairnLedgerEntry>
}

const ledger = atom({ plugin: 'cairn', key: 'ledger' } as const, null as Ledger | null)
const planUsage = atom({ plugin: 'cairn', key: 'planUsage' } as const, null as { slug: string; others: CairnLedgerEntry } | null)
// The pane's view atom (same key as pane.tsx's), read for the plan this session works on.
const view = atom({ plugin: 'cairn', key: 'view' } as const, null as CairnView | null)

// Bookkeeping, not drawn: plans with figures not yet written, folders made, last write and read times.
const dirty = new Set<string>()
const madeDirs = new Set<string>()
let flushedAt = 0
let readAt: { slug: string; at: number } | undefined
// A model step ran since the last measurement: the session was working, even where the host reports no cost.
let hasStepped = false

/** Forgets the bookkeeping (tests). */
export function resetLedger(): void {
  dirty.clear()
  madeDirs.clear()
  flushedAt = 0
  readAt = undefined
  hasStepped = false
}

/**
 * The plan this session belongs to: the one it is in, or at the repo root (where execute runs) the only plan not
 * closed. Undefined when that is ambiguous.
 */
export function sessionPlan(v: CairnView | null): string | undefined {
  if (v === null) return undefined
  const sole = v.isFallback && v.plans.filter(r => r.state.stage !== 'closed').length === 1
  return v.isFallback && !sole ? undefined : v.here
}

/** The plan this session's spend goes to, with its stage: `sessionPlan`'s, while it is open and not paused. */
async function credited($: EngineInterface): Promise<{ slug: string; stage: string } | undefined> {
  const v = await read($, view)
  const slug = sessionPlan(v)
  const row = v?.plans.find(r => r.state.slug === slug)
  if (slug === undefined || row === undefined || row.state.stage === 'closed' || row.state.paused) return undefined
  return { slug, stage: row.state.stage }
}

export const emptyEntry = (): CairnLedgerEntry => ({ usd: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tokensByModel: {}, weekPct: 0, byStage: {} })

/** All four token counts together. */
export const tokenTotal = (e: CairnLedgerEntry) => e.tokens.input + e.tokens.output + e.tokens.cacheRead + e.tokens.cacheWrite

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places

/** a + b, field by field. */
export function addEntries(a: CairnLedgerEntry, b: CairnLedgerEntry): CairnLedgerEntry {
  const byModel = { ...a.tokensByModel }
  for (const [m, n] of Object.entries(b.tokensByModel)) byModel[m] = (byModel[m] ?? 0) + n
  const byStage = { ...a.byStage }
  for (const [s, x] of Object.entries(b.byStage)) {
    const was = byStage[s] ?? { usd: 0, tokens: 0, weekPct: 0 }
    byStage[s] = { usd: was.usd + x.usd, tokens: was.tokens + x.tokens, weekPct: round(was.weekPct + x.weekPct, 2) }
  }
  return {
    usd: a.usd + b.usd,
    tokens: { input: a.tokens.input + b.tokens.input, output: a.tokens.output + b.tokens.output, cacheRead: a.tokens.cacheRead + b.tokens.cacheRead, cacheWrite: a.tokens.cacheWrite + b.tokens.cacheWrite },
    tokensByModel: byModel,
    weekPct: round(a.weekPct + b.weekPct, 2),
    byStage,
  }
}

/** Reads a ledger file; undefined when it is missing or not one. */
function parse(text: string): CairnLedgerEntry | undefined {
  try {
    const j = JSON.parse(text) as Partial<CairnLedgerEntry>
    if (typeof j.usd !== 'number' || typeof j.weekPct !== 'number' || typeof j.tokens !== 'object' || j.tokens === null) return undefined
    return addEntries(emptyEntry(), { ...emptyEntry(), ...j } as CairnLedgerEntry)
  } catch {
    return undefined
  }
}

function sessionIdOf($: EngineInterface): Promise<string> {
  return $.session.id().catch(() => 'session')
}
const folder = (dir: string, slug: string) => `${dir}/cairn/usage/${slug}`

/** The ledger, started from what the session has spent so far, so only spend after this counts. */
async function held($: EngineInterface): Promise<Ledger> {
  const was = await read($, ledger)
  if (was !== null) return was
  const u = await $.session.usage().catch(() => undefined)
  const week = u?.rateLimits.find(l => l.kind === 'seven_day')
  const next: Ledger = { sessionId: await sessionIdOf($), lastUsd: u?.cost?.usd, lastWeek: week === undefined ? undefined : { pct: week.percentUsed, resetsAt: week.resetsAt }, plans: {} }
  await update($, ledger, () => next)
  return next
}

/** Starts the ledger at session start, before any turn spends. */
export async function primeLedger($: EngineInterface): Promise<void> {
  await held($).catch(() => undefined)
}

/** Adds `add` to this session's entry for `slug`; a plan this process has not touched yet starts from its file, so a resumed session id keeps its total. */
async function credit($: EngineInterface, slug: string, add: CairnLedgerEntry): Promise<void> {
  const l = await held($)
  let base = l.plans[slug]
  if (base === undefined) {
    const dir = await commonDir($)
    const text = await $.fs.read(`${folder(dir, slug)}/${l.sessionId}.json`).catch(() => undefined)
    base = (text === undefined ? undefined : parse(text)) ?? emptyEntry()
  }
  const sum = addEntries(base, add)
  await update($, ledger, x => (x === null ? x : { ...x, plans: { ...x.plans, [slug]: sum } }))
  dirty.add(slug)
}

/** One entry holding only these figures, under `stage`. */
function entryOf(stage: string, usd: number, tokens: CairnLedgerEntry['tokens'], model: string | undefined, weekPct: number): CairnLedgerEntry {
  const n = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  return { usd, tokens, tokensByModel: model === undefined || n === 0 ? {} : { [model]: n }, weekPct, byStage: { [stage]: { usd, tokens: n, weekPct } } }
}

/** What the 7-day window rose by since the repo's last reading (any session's): a drop or a moved reset is a new window, counted from zero. */
async function weekRise($: EngineInterface, l: Ledger, pct: number, resetsAt: string | undefined): Promise<number> {
  const dir = await commonDir($)
  const file = `${dir}/cairn/usage/week.json`
  const shared = await $.fs.read(file).then(t => JSON.parse(t) as { pct: number; resetsAt?: string }, () => undefined)
  const prev = shared !== undefined && typeof shared.pct === 'number' ? shared : l.lastWeek
  const moved = prev?.resetsAt !== undefined && resetsAt !== undefined && Math.abs(Date.parse(resetsAt) - Date.parse(prev.resetsAt)) > NEW_WINDOW_MS
  const rise = prev === undefined ? 0 : moved || pct < prev.pct ? pct : pct - prev.pct
  if (prev?.pct !== pct || moved) {
    await mkdir($, `${dir}/cairn/usage`)
    await $.fs.write(file, `${JSON.stringify({ pct, resetsAt })}\n`)
  }
  return rise
}

async function mkdir($: EngineInterface, path: string): Promise<void> {
  if (madeDirs.has(path)) return
  await $.process.run(['mkdir', '-p', path], { timeoutMs: 5_000 })
  madeDirs.add(path)
}

/** A measurement: the cost and the 7-day percent that moved since the last one go to the credited plan. */
async function measured($: EngineInterface, cost: number | undefined, week: { pct: number; resetsAt?: string } | undefined): Promise<void> {
  const l = await held($)
  const id = await sessionIdOf($)
  // After /clear the session goes on under a new id: its spend from here goes to a new file.
  if (id !== l.sessionId) {
    await flush($, true)
    await update($, ledger, x => (x === null ? x : { ...x, sessionId: id, plans: {} }))
  }
  const usd = cost === undefined || l.lastUsd === undefined ? 0 : cost >= l.lastUsd ? cost - l.lastUsd : cost
  const to = await credited($)
  // The weekly rise counts only while this session spent, so idle time and other use while away stay out.
  const rise = week === undefined ? 0 : await weekRise($, l, week.pct, week.resetsAt)
  const pct = usd > 0 || hasStepped ? rise : 0
  hasStepped = false
  await update($, ledger, x => (x === null ? x : { ...x, lastUsd: cost ?? x.lastUsd, lastWeek: week ?? x.lastWeek }))
  if (to !== undefined && (usd > 0 || pct > 0)) await credit($, to.slug, entryOf(to.stage, usd, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, undefined, round(pct, 2)))
  await flush($, true)
}

type StepUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; model?: string }

/** A model step, the main thread's or an agent's: its tokens go to the credited plan. */
async function stepped($: EngineInterface, u: StepUsage): Promise<void> {
  hasStepped = true
  const to = await credited($)
  if (to === undefined) return
  const tokens = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }
  await credit($, to.slug, entryOf(to.stage, 0, tokens, u.model, 0))
}

/** Writes this session's changed plan files; unless `now`, at most once per FLUSH_EVERY_MS. */
export async function flush($: EngineInterface, now = false): Promise<void> {
  if (dirty.size === 0) return
  const t = await $.clock.now()
  if (!now && t - flushedAt < FLUSH_EVERY_MS) return
  const l = await read($, ledger)
  if (l === null) return
  const dir = await commonDir($)
  for (const slug of [...dirty]) {
    const e = l.plans[slug]
    dirty.delete(slug)
    if (e === undefined) continue
    await mkdir($, folder(dir, slug))
    await $.fs.write(`${folder(dir, slug)}/${l.sessionId}.json`, `${JSON.stringify({ sessionId: l.sessionId, ...e, updatedAt: new Date(t).toISOString() })}\n`)
  }
  flushedAt = t
}

/** Reads the other sessions' files for the plan this session works on, at most once per READ_EVERY_MS. */
async function readOthers($: EngineInterface): Promise<void> {
  const slug = sessionPlan(await read($, view))
  if (slug === undefined) return
  const t = await $.clock.now()
  if (readAt?.slug === slug && t - readAt.at < READ_EVERY_MS) return
  readAt = { slug, at: t }
  const dir = await commonDir($)
  const own = `${(await read($, ledger))?.sessionId ?? ''}.json`
  const entries = await $.fs.list(folder(dir, slug)).catch(() => [])
  let others: CairnLedgerEntry | undefined
  for (const f of entries) {
    if (f.kind !== 'file' || !f.name.endsWith('.json') || f.name === own) continue
    const e = await $.fs.read(`${folder(dir, slug)}/${f.name}`).then(parse, () => undefined)
    if (e !== undefined) others = addEntries(others ?? emptyEntry(), e)
  }
  // No other session has a file: nothing to add, and nothing to show until this one spends.
  await update($, planUsage, () => (others === undefined ? null : { slug, others }))
}

/** From the pane's poll: writes what changed (throttled) and reads the other sessions' files (throttled). */
export async function trackLedger($: EngineInterface): Promise<void> {
  await flush($)
  await readOthers($)
}

/** The plan's totals across every session, for the plan this session works on; undefined when there is none. */
export async function readPlanUsage($: EngineInterface): Promise<{ slug: string; total: CairnLedgerEntry } | undefined> {
  const slug = sessionPlan(await read($, view))
  if (slug === undefined) return undefined
  const own = (await read($, ledger))?.plans[slug]
  const held = await read($, planUsage)
  const others = held?.slug === slug ? held.others : undefined
  if (own === undefined && others === undefined) return undefined
  return { slug, total: addEntries(own ?? emptyEntry(), others ?? emptyEntry()) }
}

// Bookkeeping must never reach the session (NFR-07).
const safe = (work: () => Promise<void>) => work().catch(() => undefined)

/** From usage.ts's `session.measure` hook (one hook per event): the cost and 7-day percent that moved. */
export function ledgerMeasure($: EngineInterface, e: { cost?: { usd: number }; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }): Promise<void> {
  const week = e.rateLimits.find(l => l.kind === 'seven_day')
  return safe(() => measured($, e.cost?.usd, week === undefined ? undefined : { pct: week.percentUsed, resetsAt: week.resetsAt }))
}

/** From activity.ts's `turn.step` hook: a model step's tokens. */
export function ledgerStep($: EngineInterface, usage: StepUsage | null): Promise<void> {
  return usage === null ? Promise.resolve() : safe(() => stepped($, usage))
}

/** At session end: writes what is not written yet. */
export function ledgerEnd($: EngineInterface): Promise<void> {
  return safe(() => flush($, true))
}
