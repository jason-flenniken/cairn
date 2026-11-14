import { describe, expect, test } from 'claude-code/testing'
import { resetLedger } from '../mod/ledger.ts'
import { resetContextThrottle } from '../mod/usage.ts'
import { MAIN, mount, mountAs, plan, row, start, world, WT } from './world.tsx'

type El = { type: string; props: Record<string, unknown>; children: (El | string)[] }
type Limit = { kind: string; percentUsed: number; resetsAt?: string }

const textOf = (n: El | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''))
const width = (text: string) => [...text].reduce((n, ch) => n + (/\p{Emoji_Presentation}/u.test(ch) ? 2 : 1), 0)

/** Every row of the bar, as drawn. */
async function allRows(ui: any): Promise<string[]> {
  const bar = (await ui.find({ type: 'Box', key: 'statusbar' })) as El | undefined
  return bar === undefined ? [] : bar.children.map(textOf).map(r => r.trimEnd())
}

/** The bar's usage rows (model, then limits), apart from the git line and the stage steps around them. */
const barRows = async (ui: any): Promise<string[]> => (await allRows(ui)).filter(r => /^(🧠|⏳|📅|💰)/.test(r))
/** The plan line (💰). */
const planRow = async (ui: any): Promise<string | undefined> => (await barRows(ui)).find(r => r.startsWith('💰'))
/** The model line (🧠). */
const modelRow = async (ui: any): Promise<string | undefined> => (await barRows(ui)).find(r => r.startsWith('🧠'))

const BUILD = plan({ stage: 'execute' })
const measure = (cost: number | undefined, over: { percent?: number; tokens?: number; rateLimits?: Limit[] } = {}) => ({
  context: { tokens: over.tokens ?? 24_000, window: 200_000, percent: over.percent ?? 12 },
  rateLimits: over.rateLimits ?? [],
  cost: cost === undefined ? undefined : { usd: cost },
  changed: ['context', 'rateLimits', 'cost'],
})

/** The session reports `now` as its usage; the tests move it between calls. */
function session(on: any, initial: ReturnType<typeof measure>, id = 's1') {
  resetLedger()
  const s = { usage: initial, id }
  on('session.id', () => ({ value: s.id as never }))
  on('session.usage', () => ({ value: { startedAt: 0, ...s.usage } as never }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.model', () => ({ value: 'claude-opus-5-5' as never }))
  return s
}

const LEDGER = '/repo/.git/cairn/usage/shop'
const week = (pct: number, resetsAt = '2026-03-05T09:00:00.000Z'): Limit[] => [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: pct, resetsAt }]
/** The last write of this session's ledger file for shop. */
const ledgerFile = (w: { written: { path: string; text: string }[] }, id = 's1') => {
  const last = w.written.filter(x => x.path === `${LEDGER}/${id}.json`).at(-1)
  return last === undefined ? undefined : JSON.parse(last.text)
}
/** One model step (the main thread's unless `agentId`). */
async function runStep($: any, agentId?: string): Promise<void> {
  for await (const _chunk of $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId })) void _chunk
}
/** Answers every step as the engine would, reporting this usage. */
function stepUsage(on: any, model: string, u: { input: number; output: number; cacheRead: number; cacheWrite: number }) {
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model, input_tokens: u.input, output_tokens: u.output, cache_read_input_tokens: u.cacheRead, cache_creation_input_tokens: u.cacheWrite } }
  })
}
/** Moves the plan's files so the next poll reads the rows again. */
const touchPlan = (w: { mtimes: Map<string, number> }, n: number) => {
  w.mtimes.set('/repo/.git/refs/heads/sdlc', n)
  w.mtimes.set('/repo/.git/worktrees', n)
  w.mtimes.set(['/repo/.claude/worktrees/sdlc-shop/docs/sdlc/plans/shop', 'state.json'].join('/'), n)
}

describe('model line (FR-03)', () => {
  test('model, context bar and percent, and the context tokens; no cost', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    const line = (await modelRow(ui))!
    expect(line).toContain('🧠 Opus 5.5')
    expect(line).toMatch(/⛁ █░░░░░ 12%/)
    expect(line).toContain('24k tok')
    expect(line).not.toContain('$')
    await $.session.measure(measure(11, { percent: 60 }) as never)
    expect(await modelRow(ui)).toContain('60%')
    await ui.unmount()
  })
})

describe('plan usage ledger', () => {
  test('the plan cost counts what the session spent after it started: $10.00 then $14.10 shows $4.10 plan', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD, WT)] })
    const s = session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    s.usage = measure(14.1)
    await $.session.measure(measure(14.1) as never)
    expect(await planRow(ui)).toMatch(/^💰 \$4\.10 plan/)
    expect(ledgerFile(w)).toMatchObject({ sessionId: 's1', byStage: { execute: {} } })
    expect(Math.round(ledgerFile(w).usd * 100)).toBe(410)
    await $.session.measure(measure(15.6) as never)
    expect(await planRow(ui)).toMatch(/^💰 \$5\.60 plan/)
    await ui.unmount()
  })

  test('with no plan the line carries the session total, labelled session, and nothing is written', async ($, on) => {
    const { w } = world(on, { rows: [] })
    session(on, measure(22.12))
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    await $.session.measure(measure(23) as never)
    expect(await planRow(ui)).toBe('💰 $23.00 session')
    expect(w.written.filter(x => x.path.includes('/cairn/usage/'))).toEqual([])
    await ui.unmount()
  })

  test('spend while the plan is paused is left out; after the resume it counts again', async ($, on) => {
    const { w, clock } = world(on, { rows: [row(plan({ stage: 'execute', paused: { at: 'x' } }), WT)] })
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.session.measure(measure(12) as never)
    expect(ledgerFile(w)).toBeUndefined()
    w.rows = [row(BUILD, WT)]
    touchPlan(w, 2)
    await clock.advance(2_000)
    await $.session.measure(measure(13) as never)
    expect(await planRow(ui)).toMatch(/^💰 \$1\.00 plan/)
    await ui.unmount()
  })

  test('a cost that falls (after /clear) counts from zero, under the new session id', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD, WT)] })
    const s = session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.session.measure(measure(12) as never)
    s.id = 's2'
    await $.session.measure(measure(0.5) as never)
    expect(ledgerFile(w, 's1')).toMatchObject({ usd: 2 })
    expect(ledgerFile(w, 's2')).toMatchObject({ usd: 0.5 })
    await ui.unmount()
  })

  test('tokens from the main thread and agents add up, all four kinds, by model', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10))
    stepUsage(on, 'claude-sonnet-5-5', { input: 100, output: 200, cacheRead: 1_000_000, cacheWrite: 50_000 })
    await start($, WT)
    const ui = await mount($, 'terminal')
    await runStep($)
    await runStep($, 'agent-1')
    await $.session.measure(measure(11) as never)
    const f = ledgerFile(w)
    expect(f.tokens).toEqual({ input: 200, output: 400, cacheRead: 2_000_000, cacheWrite: 100_000 })
    expect(f.tokensByModel).toEqual({ 'claude-sonnet-5-5': 2_100_600 })
    expect(await planRow(ui)).toContain('Σ 2.1M tok')
    await ui.unmount()
  })

  test('the 7-day rise while the plan spends is its share of the week; a drop is a new window counted from zero', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { rateLimits: week(40) }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await $.session.measure(measure(11, { rateLimits: week(42.5) }) as never)
    expect(ledgerFile(w).weekPct).toBe(2.5)
    expect(await planRow(ui)).toContain('≈2.5% of week')
    // Idle here: the percent rose with no spend in this session, so it is not this plan's.
    await $.session.measure(measure(11, { rateLimits: week(45) }) as never)
    expect(ledgerFile(w).weekPct).toBe(2.5)
    // A new window: 45 falls to 3.
    await $.session.measure(measure(12, { rateLimits: week(3, '2026-03-12T09:00:00.000Z') }) as never)
    expect(ledgerFile(w).weekPct).toBe(5.5)
    await ui.unmount()
  })

  test('the 7-day reading is shared by the repo: a rise another session already counted is not counted again', async ($, on) => {
    const { w } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { rateLimits: week(40) }))
    await start($, WT)
    const ui = await mount($, 'terminal')
    w.files.set('/repo/.git/cairn/usage/week.json', JSON.stringify({ pct: 42, resetsAt: '2026-03-05T09:00:00.000Z' }))
    await $.session.measure(measure(11, { rateLimits: week(43) }) as never)
    expect(ledgerFile(w).weekPct).toBe(1)
    await ui.unmount()
  })

  test("other sessions' files for the plan add to the total; a bad one is skipped", async ($, on) => {
    const { w, clock } = world(on, { rows: [row(BUILD, WT)] })
    w.files.set(`${LEDGER}/old.json`, JSON.stringify({ sessionId: 'old', usd: 20, tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }, tokensByModel: {}, weekPct: 6, byStage: {} }))
    w.files.set(`${LEDGER}/bad.json`, 'not json')
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await clock.advance(2_000)
    await $.session.measure(measure(12) as never)
    const line = (await planRow(ui))!
    expect(line).toMatch(/^💰 \$22\.00 plan/)
    expect(line).toContain('≈6% of week')
    await ui.unmount()
  })

  test('no cost reported: no dollar figure anywhere', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(undefined))
    await start($, WT)
    const ui = await mount($, 'terminal')
    expect((await barRows(ui)).join(' ')).not.toContain('$')
    await ui.unmount()
  })
})

describe('limits line (FR-04, NFR-01)', () => {
  const RESET = new Date(2026, 2, 1, 14, 30).toISOString()
  const at = async ($: any, on: any, limits: Limit[]) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { rateLimits: limits }))
    await start($, WT)
    return mountAs($, { bodyColumns: 48 })
  }

  test('5%: plain entries for both windows, no reset time', async ($, on) => {
    const ui = await at($, on, [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: 39 }])
    const rows = await barRows(ui)
    expect(rows.find(r => r.startsWith('⏳'))).toBe('⏳ 5h ░░░░░ 5%  📅 7d ██░░░ 39% · 61% left')
    expect(rows.join(' ')).not.toContain('↻')
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.find((t: any) => t.text === '⏳ 5h ░░░░░ 5%')?.props.color).toBeUndefined()
    await ui.unmount()
  })

  test('85%: warning color and the reset time; 97%: error color', async ($, on) => {
    const ui = await at($, on, [{ kind: 'five_hour', percentUsed: 85, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 97 }])
    const rows = await barRows(ui)
    expect(rows.find(r => r.startsWith('⏳'))).toContain('↻14:30')
    const texts = (await ui.findAll({ type: 'Text' })) as any[]
    expect(texts.find(t => t.text.startsWith('⏳ 5h') && !t.text.includes('📅'))?.props.color).toBe('warning')
    expect(texts.find(t => t.text.startsWith('📅 7d') && !t.text.includes('⏳'))?.props.color).toBe('error')
    await ui.unmount()
  })

  test('no rate limits: the line is left out', async ($, on) => {
    const ui = await at($, on, [])
    const rows = await barRows(ui)
    expect(rows.some(r => r.includes('⏳') || r.includes('📅'))).toBe(false)
    expect(rows.some(r => r.startsWith('🧠'))).toBe(true)
    await ui.unmount()
  })

  test('every bar line fits 46 columns with the worst case', async ($, on) => {
    const ui = await at($, on, [{ kind: 'five_hour', percentUsed: 100, resetsAt: RESET }, { kind: 'seven_day', percentUsed: 99.5, resetsAt: new Date(2026, 2, 5, 9, 5).toISOString() }])
    for (const r of await barRows(ui)) expect([r, width(r)]).toEqual([r, expect.any(Number)]), expect(width(r)).toBeLessThanOrEqual(46)
    await ui.unmount()
  })
})

describe('inline (FR-06)', () => {
  test('one line: the active stage, the plan cost, and the 5h and 7d percents, within 7 rows', async ($, on) => {
    world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10, { rateLimits: [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: 39 }] }))
    await start($, WT)
    const ui = await mountAs($, { placement: 'inline' })
    await $.session.measure(measure(14.1, { rateLimits: [{ kind: 'five_hour', percentUsed: 5 }, { kind: 'seven_day', percentUsed: 39 }] }) as never)
    const rows = await allRows(ui)
    expect(rows).toEqual(['● Build  $4.10  5h 5%  7d 61% left'])
    const rowsOf = (n: El): number => n.type === 'Box' && n.props.flexDirection === 'column' ? n.children.reduce((k: number, c) => k + (typeof c === 'string' ? 1 : rowsOf(c)), 0) : 1
    expect(rowsOf((await ui.findAll({ type: 'Box' }))[0] as El)).toBeLessThanOrEqual(7)
    await ui.unmount()
  })
})

describe('context file for the fresh start', () => {
  const CONTEXT = '/repo/.git/cairn/context/shop.json'
  const ctxWrites = (w: { written: { path: string; text: string }[] }) => w.written.filter(x => x.path.includes('/cairn/context/'))
  const first = ($: any) => $.session.measure(measure(1, { percent: 40, tokens: 80_000 }) as never)

  test('a measure writes pct, tokens and a time for the shown plan', async ($, on) => {
    resetContextThrottle()
    const { w, clock } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await first($)
    const writes = ctxWrites(w)
    expect(writes.map(x => x.path)).toEqual([CONTEXT])
    expect(JSON.parse(writes[0]!.text)).toEqual({ pct: 40, tokens: 80_000, at: '2026-03-01T12:00:00.000Z' })
    await ui.unmount()
  })

  test('a second measure within 30 s does not write; after 30 s with new figures it does; unchanged figures never do', async ($, on) => {
    resetContextThrottle()
    const { w, clock } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await first($)
    await $.session.measure(measure(1, { percent: 45, tokens: 90_000 }) as never)
    expect(ctxWrites(w)).toHaveLength(1)
    await clock.advance(31_000)
    await $.session.measure(measure(1, { percent: 45, tokens: 90_000 }) as never)
    expect(ctxWrites(w)).toHaveLength(2)
    await clock.advance(31_000)
    await $.session.measure(measure(1, { percent: 45, tokens: 90_000 }) as never)
    expect(ctxWrites(w)).toHaveLength(2)
    await ui.unmount()
  })

  test('a drop in pct writes at once, inside the 30 s; a rise inside it does not', async ($, on) => {
    resetContextThrottle()
    const { w } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await first($)
    // After /clear or a compaction the context falls: the CLI must see it now, not 30 s later.
    await $.session.measure(measure(1, { percent: 5, tokens: 10_000 }) as never)
    expect(ctxWrites(w)).toHaveLength(2)
    expect(JSON.parse(ctxWrites(w)[1]!.text)).toMatchObject({ pct: 5, tokens: 10_000 })
    await $.session.measure(measure(1, { percent: 9, tokens: 18_000 }) as never)
    expect(ctxWrites(w)).toHaveLength(2)
    await ui.unmount()
  })

  test('the context folder is made once with mkdir -p, before the first write', async ($, on) => {
    resetContextThrottle()
    const { w, clock } = world(on, { rows: [row(BUILD, WT)] })
    session(on, measure(10))
    await start($, WT)
    const ui = await mount($, 'terminal')
    await first($)
    expect(w.mkdirs.filter(d => d.includes('/context'))).toEqual(['/repo/.git/cairn/context'])
    await clock.advance(31_000)
    await $.session.measure(measure(1, { percent: 50, tokens: 100_000 }) as never)
    expect(ctxWrites(w)).toHaveLength(2)
    expect(w.mkdirs.filter(d => d.includes('/context'))).toHaveLength(1)
    await ui.unmount()
  })

  test('with no plan nothing is written', async ($, on) => {
    resetContextThrottle()
    const { w, clock } = world(on, { rows: [] })
    session(on, measure(10))
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    await first($)
    expect(ctxWrites(w)).toEqual([])
    await ui.unmount()
  })

  test('a session at the repo root writes for the one active plan', async ($, on) => {
    resetContextThrottle()
    const one = world(on, { cwd: MAIN, rows: [row(BUILD, WT)] })
    session(on, measure(10))
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    await first($)
    expect(ctxWrites(one.w).map(x => x.path)).toEqual([CONTEXT])
    await ui.unmount()
  })

  test('at the repo root with two active plans nothing is written', async ($, on) => {
    resetContextThrottle()
    const { w } = world(on, { cwd: MAIN, rows: [row(BUILD, WT), row(plan({ slug: 'cart', stage: 'plan' }), '/repo/.worktrees/cart')] })
    session(on, measure(10))
    await start($, MAIN)
    const ui = await mount($, 'terminal')
    await first($)
    expect(ctxWrites(w)).toEqual([])
    await ui.unmount()
  })
})
